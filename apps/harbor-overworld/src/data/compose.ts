// Port of the submit path in apps/harbor/src/features/composer/hooks/useComposer.ts
// (handlePost). Builds the post, signs it, and commits it locally, then syncs
// in the background.
import type { PolycentricClient } from '@polycentric/js-core';
import { COLLECTION, v2 } from '@polycentric/js-core';
import { version } from '../../package.json';
import { OVERWORLD_APPLICATION } from '../world/presence-protocol';
import { type PostData, decodePostBundle, eventKeyFromId } from './posts';

export const MAX_POST_LENGTH = 2000;

export type NewPostInput = {
  text: string;
  images: v2.ImageSet[];
  /** Hex event key of the post being replied to. */
  replyTo?: PostData;
};

/**
 * Create, sign, and store a post. Returns the post as a PostData so the UI
 * can show it right away, before the servers have it.
 */
export async function createPost(
  client: PolycentricClient,
  input: NewPostInput,
) {
  if (!client.activeIdentityKey) {
    throw new Error('Choose an identity before you post.');
  }

  const post: v2.Post = {
    text: input.text.trim(),
    images: input.images,
    links: [],
    labels: [],
    attributedTo: [],
  };

  if (input.replyTo) {
    // A reply to a reply keeps the original root. Otherwise the parent is the root.
    const rootId = input.replyTo.reply?.rootId ?? input.replyTo.id;
    post.reply = {
      root: eventKeyFromId(rootId),
      parent: eventKeyFromId(input.replyTo.id),
    };
  }

  const { signedEvent, contentBytes } = await client.createEvent({
    collection: COLLECTION.FEED,
    application: {
      name: 'Harbor Overworld',
      id: OVERWORLD_APPLICATION,
      version,
      url: 'https://github.com/SomewhatJustin/harbor-overworld',
    },
    content: v2.Content.create({ contentBody: { oneofKind: 'post', post } }),
  });

  const bundle = v2.EventBundle.create({
    signedEvent,
    serializedContent: { contentBytes },
  });
  const decoded = decodePostBundle(bundle);
  if (!decoded) {
    throw new Error('The new post could not be read back.');
  }
  const paper = btoa(
    Array.from(v2.EventBundle.toBinary(bundle), (byte) =>
      String.fromCharCode(byte),
    ).join(''),
  );
  return { post: decoded, paper };
}
