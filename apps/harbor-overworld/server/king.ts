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

export async function verifyKing(nonce: string, key: string, proof: string) {
  if (!verifyProof(Buffer.from(key, 'hex'), kingChallenge(nonce), proof))
    return false;

  const docs = await Promise.allSettled(
    servers.map(async (server) => {
      const response = await server.listEvents(
        {
          filters: { identity: KING_IDENTITY, collection: 1, heads: [] },
          size: 1,
        },
        { timeout: 6000 },
      ).response;
      const bundle = response.eventBundles[0];
      if (!bundle?.signedEvent || !bundle.serializedContent) return;
      const event = Event.fromBinary(bundle.signedEvent.eventBytes);
      const { contentBody } = Content.fromBinary(
        bundle.serializedContent.contentBytes,
      );
      if (
        event.key?.identity !== KING_IDENTITY ||
        contentBody.oneofKind !== 'identity'
      )
        return;
      return { sequence: event.key.sequence, identity: contentBody.identity };
    }),
  );
  let latest: { sequence: bigint; identity: Identity } | undefined;
  for (const doc of docs) {
    if (
      doc.status === 'fulfilled' &&
      doc.value &&
      (!latest || doc.value.sequence > latest.sequence)
    )
      latest = doc.value;
  }
  return (
    !!latest &&
    [...latest.identity.rotationKeys, ...latest.identity.signingKeys].some(
      (signer) =>
        signer.keyType === KeyType.ED25519 &&
        Buffer.from(signer.key).toString('hex') === key,
    )
  );
}
