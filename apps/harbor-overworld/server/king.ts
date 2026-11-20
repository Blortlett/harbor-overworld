import { createHash } from 'node:crypto';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { Content } from '../../../packages/js-core/src/proto/polycentric/v2/content.ts';
import { Event } from '../../../packages/js-core/src/proto/polycentric/v2/events.ts';
import { EventSyncServiceClient } from '../../../packages/js-core/src/proto/polycentric/v2/events.client.ts';
import type { Identity } from '../../../packages/js-core/src/proto/polycentric/v2/identity.ts';
import { KeyType } from '../../../packages/js-core/src/proto/polycentric/v2/keypair.ts';
import {
  KING_IDENTITY,
  kingChallenge,
} from '../src/world/presence-protocol.ts';
import { verifyProof } from './signature.ts';

const servers = ['https://srv.harbor.social', 'https://srv.polycentric.io'].map(
  (baseUrl) =>
    new EventSyncServiceClient(
      new GrpcWebFetchTransport({ baseUrl, format: 'binary' }),
    ),
);

// SHA-256 fingerprints of the active device keys in the King's identity
// document 21, confirmed on both Harbor production servers.
const knownDevices = new Set([
  '0aeeff7f720545653229fa08e8bf560732cbb5a5b4d1d86d9d6456788b92f45b',
  '138567b0e2b8e69e72b79de36f44588b5cfd10fc0f040c9568bef64c7629d00a',
  '62f59012b1e54eca4115676e82c83a3a3adf55a250fda3f437c776766cb442c5',
  '9b039ee204b3e0069847e4b641a9b57f5cefe0c42d3fa37ff24ee971f7537176',
  'd61211f622bfdbaa444f43338d939f8af506e6c8af217d75dc9888f57799ae78',
  'eaa1e4bd5f55b5e8cbec2c4fe376b4113bbd5922880537dac48ee02d941a1406',
  'f3f59e57d064f9c19681d3a658a5f1b3351602261d4dc05d9f0850ac035bff76',
  'f4ac4ff6cbdcb495ad8dc9a647a6650da67f48e70b96d6113dae47aea7b40449',
]);
const LOOKUP_MS = 1800;
type IdentityHead = { sequence: bigint; identity: Identity };

export async function verifyKing(
  nonce: string,
  key: string,
  proof: string,
  fallback: ReadonlySet<string> = knownDevices,
) {
  const deviceKey = Buffer.from(key, 'hex');
  if (!verifyProof(deviceKey, kingChallenge(nonce), proof)) return false;

  const abort = new AbortController();
  const docs: IdentityHead[] = [];
  const requests = servers.map(async (server) => {
    const response = await server.listEvents(
      {
        filters: { identity: KING_IDENTITY, collection: 1, heads: [] },
        size: 1,
      },
      { timeout: LOOKUP_MS, abort: abort.signal },
    ).response;
    const bundle = response.eventBundles[0];
    if (!bundle?.signedEvent || !bundle.serializedContent) return;
    const event = Event.fromBinary(bundle.signedEvent.eventBytes);
    const { contentBody } = Content.fromBinary(
      bundle.serializedContent.contentBytes,
    );
    if (
      event.key?.identity === KING_IDENTITY &&
      contentBody.oneofKind === 'identity'
    )
      docs.push({
        sequence: event.key.sequence,
        identity: contentBody.identity,
      });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, LOOKUP_MS);
    });
    await Promise.race([deadline, Promise.allSettled(requests)]);
  } finally {
    clearTimeout(timer);
    abort.abort();
  }

  const latest = docs.reduce<IdentityHead | undefined>(
    (current, doc) =>
      !current || doc.sequence > current.sequence ? doc : current,
    undefined,
  );
  if (!latest)
    return fallback.has(createHash('sha256').update(deviceKey).digest('hex'));
  return [...latest.identity.rotationKeys, ...latest.identity.signingKeys].some(
    (signer) =>
      signer.keyType === KeyType.ED25519 && deviceKey.equals(signer.key),
  );
}
