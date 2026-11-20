import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { Content } from '../../../packages/js-core/src/proto/polycentric/v2/content.ts';
import {
  Event,
  EventBundle,
} from '../../../packages/js-core/src/proto/polycentric/v2/events.ts';
import { EventKey } from '../../../packages/js-core/src/proto/polycentric/v2/event_key.ts';
import { FeedsServiceClient } from '../../../packages/js-core/src/proto/polycentric/v2/feeds.client.ts';
import { SortPostsBy } from '../../../packages/js-core/src/proto/polycentric/v2/search.ts';
import type { PlotSnapshot } from '../src/world/presence-protocol.ts';
import { STATIONS } from '../src/world/terrain.ts';

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  hourCycle: 'h23',
});
const sources = ['https://srv.harbor.social', 'https://srv.polycentric.io'];
const capacity = STATIONS.length;

export function plotDay(time: number) {
  const parts = clock.formatToParts(time);
  const value = (key: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(({ type }) => type === key)?.value);
  return new Date(
    Date.UTC(
      value('year'),
      value('month') - 1,
      value('day') - Number(value('hour') < 3),
    ),
  )
    .toISOString()
    .slice(0, 10);
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
      if (contentBody.oneofKind !== 'post' || contentBody.post.reply) continue;
      const paper = EventBundle.toBinary(bundle);
      if (paper.byteLength > 12 * 1024) continue;
      posts.push({
        id: Buffer.from(EventKey.toBinary(event.key)).toString('hex'),
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
) {
  let day = plotDay(Date.now());
  let plots = new Map<string, string>();
  let ready = false;
  if (file) {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (state.day === day && Array.isArray(state.plots)) {
        plots = new Map(state.plots.slice(0, capacity));
        ready = true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('Could not restore plots:', error);
    }
  }

  function snapshot(): PlotSnapshot | undefined {
    if (ready) return { type: 'plots', day, papers: [...plots.values()] };
  }

  function changed() {
    if (file && ready) {
      try {
        writeFileSync(
          `${file}.tmp`,
          JSON.stringify({ day, plots: [...plots] }),
        );
        renameSync(`${file}.tmp`, file);
      } catch (error) {
        console.warn('Could not save Overworld plots:', error);
      }
    }
    const state = snapshot();
    if (state) broadcast(state);
  }

  let polling = false;
  async function poll() {
    const now = Date.now();
    const current = plotDay(now);
    if (day !== current) {
      day = current;
      plots.clear();
      changed();
    }
    if (polling || plots.size >= capacity) return;
    polling = true;
    try {
      const response = await Promise.any(
        sources.map(async (baseUrl) => {
          const feed = new FeedsServiceClient(
            new GrpcWebFetchTransport({ baseUrl, format: 'binary' }),
          );
          return feed.getExploreFeed(
            {
              pageParams: { limit: 50 },
              omitLabels: [],
              sortBy: SortPostsBy.LATEST,
            },
            { timeout: 6000 },
          ).response;
        }),
      );
      if (day !== current || plotDay(Date.now()) !== current) return;
      const before = plots.size;
      for (const post of readCandidates(
        response.eventBundles,
        day,
        Date.now(),
      )) {
        if (plots.size >= capacity) break;
        if (!plots.has(post.id)) plots.set(post.id, post.paper);
      }
      const first = !ready;
      ready = true;
      if (first || plots.size !== before) changed();
    } catch (error) {
      console.warn('Could not refresh Overworld plots:', error);
    } finally {
      polling = false;
    }
  }

  void poll();
  const timer = setInterval(() => void poll(), 12_000);
  timer.unref();
  return { snapshot, close: () => clearInterval(timer) };
}
