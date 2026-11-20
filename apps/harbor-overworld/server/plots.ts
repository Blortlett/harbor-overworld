import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { Content } from '../../../packages/js-core/src/proto/polycentric/v2/content.ts';
import {
  Event,
  EventBundle,
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
  return posts.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function createPlots(
  file: string | undefined,
  broadcast: (snapshot: PlotSnapshot) => void,
  placed: (day: string, post: PlacedPost) => void,
) {
  let day = plotDay(Date.now());
  let plots = new Map<string, string>();
  const placements = new Map<string, PlacedPost>();
  const checking = new Set<string>();
  let ready = false;
  if (file) {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (state.day === day && Array.isArray(state.plots)) {
        plots = new Map(state.plots.slice(0, capacity));
        ready = true;
      }
      if (state.day === day && Array.isArray(state.placements)) {
        for (const post of state.placements)
          if (isPlacedPost(post)) placements.set(post.id, post);
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
      placements.clear();
      save();
      broadcast({ type: 'plots', day, papers: [] });
    }
  }

  async function place({ id, x, z, proof }: Placement) {
    const now = Date.now();
    reset(now);
    const existing = placements.get(id);
    if (existing) return existing;
    if (checking.has(id) || checking.size >= 24) return;
    checking.add(id);
    const current = day;
    try {
      const key = EventKey.fromBinary(Buffer.from(id, 'hex'));
      if (
        key.signedBy?.keyType !== KeyType.ED25519 ||
        !verifyProof(key.signedBy.key, placementChallenge(id, x, z), proof)
      )
        return;
      const post = await Promise.any(
        feeds.map(async (feed) => {
          const response = await feed.getPost(
            { identity: key.identity, sequence: key.sequence, omitLabels: [] },
            { timeout: 6000 },
          ).response;
          const candidate = readCandidates(
            response.candidates,
            current,
            Date.now(),
          ).find(
            (item) =>
              item.id === id && item.application === OVERWORLD_APPLICATION,
          );
          if (!candidate) throw new Error('Overworld post is not indexed yet.');
          return candidate;
        }),
      );
      reset();
      if (day !== current) return;
      const placement = { id, x, z, paper: post.paper, landedAt: Date.now() };
      placements.set(id, placement);
      save();
      placed(day, placement);
    } catch {
      // The publisher retries while the production servers index the post.
    } finally {
      checking.delete(id);
    }
  }

  let polling = false;
  async function poll() {
    reset();
    const current = day;
    if (polling || plots.size >= capacity) return;
    polling = true;
    try {
      const response = await Promise.any(
        feeds.map(
          (feed) =>
            feed.getExploreFeed(
              {
                pageParams: { limit: 50 },
                omitLabels: [],
                sortBy: SortPostsBy.LATEST,
              },
              { timeout: 6000 },
            ).response,
        ),
      );
      if (day !== current || plotDay(Date.now()) !== current) return;
      const before = plots.size;
      for (const post of readCandidates(
        response.eventBundles,
        day,
        Date.now(),
      )) {
        if (plots.size >= capacity) break;
        if (post.reply || post.application === OVERWORLD_APPLICATION) continue;
        if (!plots.has(post.id)) plots.set(post.id, post.paper);
      }
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
      reset();
      return { day, posts: placements.values() };
    },
    place,
    close: () => clearInterval(timer),
  };
}
