// Explore feed loader. Port of the query in
// apps/harbor/src/features/feed/hooks/useExploreFeed.ts, one page at a time.
// Load more with the previous page's endCursor.
import type { PolycentricClient } from '@polycentric/js-core';
import { COLLECTION, v2 } from '@polycentric/js-core';
import {
  FeedSort,
  Query,
  labelsFromFeedResponse,
} from '@polycentric/rs-core-wasm/web';
import { fetchOnce } from './query';
import {
  type PostData,
  decodeFeedItems,
  decodePostBundle,
  labelMapFromSets,
} from './posts';

export const FEED_PAGE_SIZE = 50;

export type ExploreSort = 'top' | 'latest';

export type FeedPage = {
  items: PostData[];
  cursor?: string;
  hasMore: boolean;
};

export async function loadExplorePage(
  client: PolycentricClient,
  sort: ExploreSort,
  cursor?: string,
  options: { servers?: string[]; includeLocal?: boolean } = {},
): Promise<FeedPage> {
  const identity = client.activeIdentityKey ?? undefined;
  const localPosts =
    options.includeLocal !== false && identity && sort === 'latest' && !cursor
      ? client.listValidEvents(identity, COLLECTION.FEED).flatMap((bundle) => {
          const post = decodePostBundle(bundle);
          return post && !post.reply ? [post] : [];
        })
      : [];
  const bytes = await fetchOnce(
    client,
    [
      'explore',
      identity ?? '',
      sort,
      cursor ?? 'first',
      ...(options.servers ?? []),
    ],
    new Query.GetExploreFeed({
      identity,
      sortBy: sort === 'top' ? FeedSort.Top : FeedSort.Latest,
      limit: FEED_PAGE_SIZE,
      forwardToken: cursor,
      // Harbor drops posts with labels set to "hide" in user settings. This
      // port has no settings yet, so nothing is hidden. Warn labels are kept.
      omitLabels: [],
    }),
    { servers: options.servers },
  );

  if (!bytes) {
    return {
      items: localPosts.sort((a, b) => b.createdAt - a.createdAt),
      hasMore: false,
    };
  }

  const response = v2.GetFeedResponse.fromBinary(new Uint8Array(bytes));
  const labelMap = labelMapFromSets(labelsFromFeedResponse(bytes));

  const items = decodeFeedItems(response, labelMap);
  if (localPosts.length > 0) {
    const seen = new Set(items.map((post) => post.id));
    const last = items.at(-1);
    const cutoff =
      last && response.pageInfo?.hasNextPage
        ? (last.repostedAt ?? last.createdAt)
        : 0;
    items.push(
      ...localPosts.filter(
        (post) => !seen.has(post.id) && post.createdAt >= cutoff,
      ),
    );
    items.sort(
      (a, b) => (b.repostedAt ?? b.createdAt) - (a.repostedAt ?? a.createdAt),
    );
  }
  return {
    items,
    cursor: response.pageInfo?.endCursor || undefined,
    hasMore: response.pageInfo?.hasNextPage ?? false,
  };
}
