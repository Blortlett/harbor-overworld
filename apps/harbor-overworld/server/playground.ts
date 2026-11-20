import {
  Content,
  Post,
} from '../../../packages/js-core/src/proto/polycentric/v2/content.ts';
import {
  Event,
  EventBundle,
} from '../../../packages/js-core/src/proto/polycentric/v2/events.ts';
import { GetFeedResponse } from '../../../packages/js-core/src/proto/polycentric/v2/feeds.ts';
import { OVERWORLD_APPLICATION } from '../src/world/presence-protocol.ts';
import type { PlotFeed } from './plots.ts';

const nextPage = 'noticeboard-post';

export const playgroundFeed: PlotFeed = async (cursor) => {
  const worldPost = cursor !== nextPage;
  return GetFeedResponse.create({
    pageInfo: worldPost
      ? { endCursor: nextPage, hasNextPage: true }
      : undefined,
    eventBundles: [
      EventBundle.create({
        signedEvent: {
          eventBytes: Event.toBinary(
            Event.create({
              key: {
                identity: 'ab'.repeat(32),
                collection: 2,
                sequence: worldPost ? 1n : 2n,
                signedBy: { keyType: 1, key: new Uint8Array(32).fill(1) },
              },
              createdAt: BigInt(Date.now()),
              application: worldPost
                ? { id: OVERWORLD_APPLICATION }
                : undefined,
            }),
          ),
        },
        serializedContent: {
          contentBytes: Content.toBinary(
            Content.create({
              contentBody: {
                oneofKind: 'post',
                post: Post.create({
                  text: worldPost
                    ? 'An Overworld post on the first page.'
                    : 'A sample Harbor post from the second page.',
                }),
              },
            }),
          ),
        },
      }),
    ],
  });
};
