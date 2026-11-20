// Port of apps/harbor/src/features/profile/lib/decodeProfile.ts, trimmed to the
// fields the feed shows (name and avatar). Bio, banner, and follow counts can
// come later.
import type { PolycentricClient } from '@polycentric/js-core';
import { v2 } from '@polycentric/js-core';
import { Query } from '@polycentric/rs-core-wasm/web';
import { fetchOnce } from './query';

export type ProfileSummary = {
  name: string | null;
  avatar: v2.ImageSet | null;
};

const EMPTY: ProfileSummary = { name: null, avatar: null };

/** Keep the newest ProfileUpdate. Older updates are ignored. */
export function decodeProfile(bytes: ArrayBuffer): ProfileSummary {
  const response = v2.GetProfileResponse.fromBinary(new Uint8Array(bytes));

  let latest: { sequence: bigint; update: v2.ProfileUpdate } | null = null;
  for (const bundle of response.eventBundles) {
    if (!bundle.signedEvent || !bundle.serializedContent?.contentBytes) {
      continue;
    }
    try {
      const event = v2.Event.fromBinary(bundle.signedEvent.eventBytes);
      if (!event.key) continue;
      const content = v2.Content.fromBinary(
        bundle.serializedContent.contentBytes,
      );
      if (content.contentBody.oneofKind !== 'profileUpdate') continue;
      const sequence = event.key.sequence;
      if (!latest || sequence > latest.sequence) {
        latest = { sequence, update: content.contentBody.profileUpdate };
      }
    } catch {
      // Skip events that do not decode.
    }
  }

  return {
    name: latest?.update.name ? latest.update.name.slice(0, 50) : null,
    avatar: latest?.update.avatar ?? null,
  };
}

// One request per identity for the whole session. Many posts share an author.
const cache = new Map<string, Promise<ProfileSummary>>();

export function loadProfile(
  client: PolycentricClient,
  identity: string,
): Promise<ProfileSummary> {
  let entry = cache.get(identity);
  if (!entry) {
    entry = fetchOnce(
      client,
      ['profile', identity],
      new Query.GetProfile({ identity }),
    )
      .then((bytes) => (bytes ? decodeProfile(bytes) : EMPTY))
      .catch((error: unknown) => {
        // Forget the failure so the next render can retry.
        cache.delete(identity);
        throw error;
      });
    cache.set(identity, entry);
  }
  return entry;
}
