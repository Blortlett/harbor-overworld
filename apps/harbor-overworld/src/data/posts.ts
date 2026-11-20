// Port of apps/harbor/src/common/lib/polycentric-hooks/helpers.ts (post and feed
// decoding). Same rules: reposts resolve their target from event hints and are
// dropped when the target is missing.
import { bytesToHex, hexToBytes, v2 } from '@polycentric/js-core';
import type { LabelSet, PostLabel } from '@polycentric/rs-core-wasm/web';

export type { LabelSet, PostLabel };

export type PostData = {
  /** Hex of the EventKey bytes. Stable, and used to reply or quote. */
  id: string;
  identity: string;
  signedBy: v2.PublicKey;
  sequence: string;
  content: string;
  createdAt: number;
  images: v2.ImageSet[];
  links: v2.Link[];
  reply?: { rootId?: string; parentId?: string; parentIdentity?: string };
  quoteId?: string;
  quotePost?: PostData;
  replyCount?: number;
  totalReactionCount?: number;
  repostedBy?: string;
  repostId?: string;
  repostedAt?: number;
  labels?: PostLabel[];
  signedEvent: v2.SignedEvent;
};

export function eventKeyId(eventKey: v2.EventKey): string {
  return bytesToHex(v2.EventKey.toBinary(eventKey));
}

/** Inverse of `eventKeyId`. Throws on a malformed id. */
export function eventKeyFromId(id: string): v2.EventKey {
  const bytes = hexToBytes(id);
  if (!bytes) {
    throw new Error(`Not a valid post id: ${id}`);
  }
  return v2.EventKey.fromBinary(bytes);
}

type ContentKind = Exclude<v2.Content['contentBody']['oneofKind'], undefined>;

/** Decode a bundle as one content kind. Returns null for a different kind. */
export function decodeBundle(bundle: v2.EventBundle, kind: ContentKind) {
  if (!bundle.signedEvent || !bundle.serializedContent?.contentBytes) {
    return null;
  }
  try {
    const content = v2.Content.fromBinary(
      bundle.serializedContent.contentBytes,
    );
    const event = v2.Event.fromBinary(bundle.signedEvent.eventBytes);
    if (content.contentBody.oneofKind !== kind) return null;
    return {
      event,
      content: content.contentBody,
      signedEvent: bundle.signedEvent,
    };
  } catch {
    return null;
  }
}

export function decodePostBundle(bundle: v2.EventBundle): PostData | null {
  const decoded = decodeBundle(bundle, 'post');
  if (decoded?.content.oneofKind !== 'post') return null;
  const post = decoded.content.post;
  const { event, signedEvent } = decoded;
  const key = event.key;
  if (!key?.signedBy?.key) return null;

  return {
    id: eventKeyId(key),
    identity: key.identity,
    signedBy: key.signedBy,
    sequence: key.sequence.toString(),
    content: post.text,
    createdAt: Number(event.createdAt ?? 0),
    images: post.images,
    links: post.links,
    reply: post.reply
      ? {
          rootId: post.reply.root ? eventKeyId(post.reply.root) : undefined,
          parentIdentity:
            post.reply.parent?.identity || post.reply.root?.identity,
          parentId: post.reply.parent
            ? eventKeyId(post.reply.parent)
            : undefined,
        }
      : undefined,
    quoteId: post.quote ? eventKeyId(post.quote) : undefined,
    replyCount: bundle.meta?.replyCount,
    totalReactionCount: bundle.meta?.reactionCount,
    signedEvent,
  };
}

/** Turn rs-core label sets (from `labelsFromFeedResponse`) into a lookup by post id. */
export function labelMapFromSets(sets: LabelSet[]): Map<string, PostLabel[]> {
  const labelMap = new Map<string, PostLabel[]>();
  for (const set of sets) {
    const target = v2.EventKey.create({
      collection: set.target.collection,
      identity: set.target.identity,
      signedBy: v2.PublicKey.create({
        keyType: set.target.signedBy.keyType,
        key: new Uint8Array(set.target.signedBy.key),
      }),
      sequence: set.target.sequence,
    });
    labelMap.set(eventKeyId(target), set.labels);
  }
  return labelMap;
}

function decodeRepostBundle(bundle: v2.EventBundle) {
  const decoded = decodeBundle(bundle, 'repost');
  if (decoded?.content.oneofKind !== 'repost') return null;
  const key = decoded.event.key;
  const target = decoded.content.repost.post;
  if (!key?.signedBy?.key || !target) return null;
  return {
    repostedBy: key.identity,
    targetId: eventKeyId(target),
    repostId: eventKeyId(key),
    repostedAt: Number(decoded.event.createdAt ?? 0),
  };
}

/** Decode a feed response into renderable posts, resolving reposts from hints. */
export function decodeFeedItems(
  response: v2.GetFeedResponse,
  labelMap: Map<string, PostLabel[]>,
): PostData[] {
  const hintPosts = new Map<string, PostData>();
  for (const hint of response.eventHints) {
    if (!hint.eventBundle) continue;
    const post = decodePostBundle(hint.eventBundle);
    if (!post) continue;
    post.labels = labelMap.get(post.id);
    hintPosts.set(post.id, post);
  }

  const items: PostData[] = [];
  for (const bundle of response.eventBundles) {
    let post: PostData | null = decodePostBundle(bundle);
    if (post) {
      post.labels = labelMap.get(post.id);
    } else {
      const repost = decodeRepostBundle(bundle);
      if (!repost) continue;
      const target = hintPosts.get(repost.targetId);
      if (!target) continue;
      post = {
        ...target,
        repostedBy: repost.repostedBy,
        repostId: repost.repostId,
        repostedAt: repost.repostedAt,
      };
    }

    if (post.quoteId) {
      post.quotePost = hintPosts.get(post.quoteId);
    }
    items.push(post);
  }
  return items;
}

/** Smallest image variant at least `target` wide, or the largest if none is. */
export function pickImageVariant(
  imageSet: v2.ImageSet | null | undefined,
  target: number,
): v2.Image | null {
  if (!imageSet || imageSet.images.length === 0) return null;
  const sorted = [...imageSet.images].sort((a, b) => a.width - b.width);
  return (
    sorted.find((img) => img.width >= target) ??
    sorted[sorted.length - 1] ??
    null
  );
}

/** Short relative time: "now", "5m", "3h", "2d", or a date. */
export function timeAgo(unixMs: number): string {
  if (!unixMs) return '';
  const mins = Math.floor((Date.now() - unixMs) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(unixMs).toLocaleDateString();
}
