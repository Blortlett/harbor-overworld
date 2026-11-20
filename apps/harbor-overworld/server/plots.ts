import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { Content } from '../../../packages/js-core/src/proto/polycentric/v2/content.ts';
import {
  Event,
  EventBundle,
  SignedEvent,
} from '../../../packages/js-core/src/proto/polycentric/v2/events.ts';
import { EventKey } from '../../../packages/js-core/src/proto/polycentric/v2/event_key.ts';
import { FeedsServiceClient } from '../../../packages/js-core/src/proto/polycentric/v2/feeds.client.ts';
import { KeyType } from '../../../packages/js-core/src/proto/polycentric/v2/keypair.ts';
import { SortPostsBy } from '../../../packages/js-core/src/proto/polycentric/v2/search.ts';
import {
  isPlacedPost,
  OVERWORLD_APPLICATION,
  type PlacedPost,
  type Placement,
  placementChallenge,
  type PlotSnapshot,
  plotDay,
  postExpired,
} from '../src/world/presence-protocol.ts';
import { STATIONS } from '../src/world/terrain.ts';
import { verifyProof } from './signature.ts';

const feeds = ['https://srv.harbor.social', 'https://srv.polycentric.io'].map(
  (baseUrl) =>
    new FeedsServiceClient(
      new GrpcWebFetchTransport({ baseUrl, format: 'binary' }),
    ),
);
const capacity = STATIONS.length;
const FEED_PAGE_LIMIT = 5;

function loadFeed(feed: FeedsServiceClient, forwardToken?: string) {
  return feed.getExploreFeed(
    {
      pageParams: { limit: 50, forwardToken },
      omitLabels: [],
      sortBy: SortPostsBy.LATEST,
    },
    { timeout: 6000 },
  ).response;
}

function readCandidates(bundles: EventBundle[], day: string, now: number) {
  const posts = [];
  for (const bundle of bundles) {
    if (!bundle.signedEvent || !bundle.serializedContent) continue;
    try {
      const event = Event.fromBinary(bundle.signedEvent.eventBytes);
      const time = Number(event.createdAt ?? 0n);
      if (!event.key || time <= 0 || time > now || plotDay(time) !== day)
        continue;
      const { contentBody } = Content.fromBinary(
        bundle.serializedContent.contentBytes,
      );
      if (contentBody.oneofKind !== 'post') continue;
      const paper = EventBundle.toBinary(bundle);
      if (paper.byteLength > 12 * 1024) continue;
      posts.push({
        id: Buffer.from(EventKey.toBinary(event.key)).toString('hex'),
        application: event.application?.id,
        reply: !!contentBody.post.reply,
        time,
        paper: Buffer.from(paper).toString('base64'),
      });
    } catch {
      // Ignore entries the client cannot decode.
    }
  }
  return posts;
}

export function createPlots(
  file: string | undefined,
  broadcast: (snapshot: PlotSnapshot) => void,
  placed: (day: string, post: PlacedPost) => void,
) {
  let day = plotDay(Date.now());
  let plots = new Map<string, string>();
  const placements = new Map<string, PlacedPost>();
  let ready = false;
  if (file) {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (state.day === day && Array.isArray(state.plots)) {
        plots = new Map(state.plots.slice(0, capacity));
        ready = true;
      }
      if (Array.isArray(state.placements)) {
        for (const post of state.placements)
          if (isPlacedPost(post) && !postExpired(post.landedAt))
            placements.set(post.id, post);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('Could not restore plots:', error);
    }
  }

  function snapshot(): PlotSnapshot | undefined {
    if (ready) return { type: 'plots', day, papers: [...plots.values()] };
  }

  function save() {
    if (file) {
      try {
        writeFileSync(
          `${file}.tmp`,
          JSON.stringify({
            day,
            plots: [...plots],
            placements: [...placements.values()],
          }),
        );
        renameSync(`${file}.tmp`, file);
      } catch (error) {
        console.warn('Could not save Overworld plots:', error);
      }
    }
  }

  function reset(now = Date.now()) {
    const current = plotDay(now);
    if (day !== current) {
      day = current;
      plots.clear();
      save();
      broadcast({ type: 'plots', day, papers: [] });
    }
  }

  function prune(now = Date.now()) {
    for (const [id, post] of placements)
      if (postExpired(post.landedAt, now)) placements.delete(id);
  }

  function place({ id, x, z, proof, publishedAt, signedEvent }: Placement) {
    const now = Date.now();
    reset(now);
    prune(now);
    if (postExpired(publishedAt, now) || publishedAt > now + 5000) return;
    const existing = placements.get(id);
    if (existing) return existing;
    try {
      const signed = SignedEvent.fromBinary(Buffer.from(signedEvent, 'base64'));
      const event = Event.fromBinary(signed.eventBytes);
      const key = event.key;
      if (
        !key ||
        key.collection !== 2 ||
        !/^[a-f0-9]{64}$/.test(key.identity) ||
        Buffer.from(EventKey.toBinary(key)).toString('hex') !== id ||
        event.application?.id !== OVERWORLD_APPLICATION ||
        key.signedBy?.keyType !== KeyType.ED25519 ||
        !verifyProof(
          key.signedBy.key,
          signed.eventBytes,
          Buffer.from(signed.signature).toString('hex'),
        ) ||
        !verifyProof(
          key.signedBy.key,
          placementChallenge(id, x, z, publishedAt),
          proof,
        )
      )
        return;
      const placement = { id, x, z, landedAt: publishedAt };
      placements.set(id, placement);
      save();
      placed(day, placement);
    } catch {
      // Ignore malformed placement requests.
    }
  }

  let polling = false;
  async function poll() {
    prune();
    reset();
    const current = day;
    if (polling || plots.size >= capacity) return;
    polling = true;
    try {
      const firstPage = await Promise.any(
        feeds.map(async (feed) => ({ feed, page: await loadFeed(feed) })),
      );
      const { feed } = firstPage;
      let page = firstPage.page;
      let cursor: string | undefined;
      const candidates = new Map<
        string,
        ReturnType<typeof readCandidates>[number]
      >();
      for (let i = 0; i < FEED_PAGE_LIMIT; i++) {
        const now = Date.now();
        if (day !== current || plotDay(now) !== current) return;
        for (const post of readCandidates(page.eventBundles, day, now)) {
          if (post.reply || post.application === OVERWORLD_APPLICATION)
            continue;
          if (!plots.has(post.id)) candidates.set(post.id, post);
        }
        const next = page.pageInfo?.endCursor;
        if (
          plots.size + candidates.size >= capacity ||
          i + 1 === FEED_PAGE_LIMIT ||
          !page.pageInfo?.hasNextPage ||
          !next ||
          next === cursor
        )
          break;
        cursor = next;
        const following = await loadFeed(feed, cursor).catch(() => undefined);
        if (!following) break;
        page = following;
      }
      if (plotDay(Date.now()) !== current) return;
      const before = plots.size;
      const ordered = [...candidates.values()].sort(
        (a, b) => a.time - b.time || a.id.localeCompare(b.id),
      );
      for (const { id, paper } of ordered.slice(0, capacity - plots.size))
        plots.set(id, paper);
      const first = !ready;
      ready = true;
      if (first || plots.size !== before) {
        save();
        broadcast({ type: 'plots', day, papers: [...plots.values()] });
      }
    } catch (error) {
      console.warn('Could not refresh Overworld plots:', error);
    } finally {
      polling = false;
    }
  }

  void poll();
  const timer = setInterval(() => void poll(), 12_000);
  timer.unref();
  return {
    snapshot,
    placements() {
      prune();
      reset();
      return { day, posts: placements.values() };
    },
    place,
    close: () => clearInterval(timer),
  };
}
