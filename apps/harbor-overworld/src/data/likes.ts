import { COLLECTION, type PolycentricClient, v2 } from '@polycentric/js-core';
import { decodeBundle, eventKeyFromId, eventKeyId } from './posts';

const LIKE = '👍';

export function findLike(client: PolycentricClient, postId: string) {
  const identity = client.activeIdentityKey;
  if (!identity) return undefined;

  let latest: v2.EventKey | undefined;
  for (const bundle of client.listValidEvents(
    identity,
    COLLECTION.INTERACTIONS,
  )) {
    const decoded = decodeBundle(bundle, 'reaction');
    if (decoded?.content.oneofKind !== 'reaction' || !decoded.event.key)
      continue;
    const { eventKey, emoji, positive } = decoded.content.reaction;
    if (
      !eventKey ||
      emoji !== LIKE ||
      !positive ||
      eventKeyId(eventKey) !== postId
    )
      continue;
    if (!latest || BigInt(decoded.event.key.sequence) > BigInt(latest.sequence))
      latest = decoded.event.key;
  }
  return latest;
}

export function setLike(
  client: PolycentricClient,
  postId: string,
  existing: v2.EventKey | undefined,
) {
  return client.createEvent({
    collection: COLLECTION.INTERACTIONS,
    content: v2.Content.create({
      contentBody: existing
        ? { oneofKind: 'delete', delete: { eventKey: existing } }
        : {
            oneofKind: 'reaction',
            reaction: {
              eventKey: eventKeyFromId(postId),
              emoji: LIKE,
              positive: true,
            },
          },
    }),
  });
}
