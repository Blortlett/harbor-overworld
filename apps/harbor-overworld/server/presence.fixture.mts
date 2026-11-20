import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Content } from '../../../packages/js-core/src/proto/polycentric/v2/content.ts';
import { EventKey } from '../../../packages/js-core/src/proto/polycentric/v2/event_key.ts';
import {
  Event,
  EventBundle,
  ListEventsRequest,
  ListEventsResponse,
} from '../../../packages/js-core/src/proto/polycentric/v2/events.ts';
import {
  GetFeedResponse,
  GetPostRequest,
  GetPostResponse,
} from '../../../packages/js-core/src/proto/polycentric/v2/feeds.ts';

const king = 'cc8ce89f64566ee9efce26d559d50dfd1ef63bb787c5e4d57f1473a0e94d6727';
const author = 'ab'.repeat(32);
export const resetTime = Date.parse('2026-11-20T09:00:00.000Z');

function makeBundle(
  key: EventKey,
  content: Content,
  application?: string,
): EventBundle {
  const event = Event.create({
    key,
    createdAt: BigInt(resetTime - 1000),
    application: application ? { id: application } : undefined,
  });
  return EventBundle.create({
    signedEvent: { eventBytes: Event.toBinary(event) },
    serializedContent: { contentBytes: Content.toBinary(content) },
  });
}

function makePost(signerKey: string, sequence: bigint, application: string) {
  const key = EventKey.create({
    identity: author,
    collection: 2,
    sequence,
    signedBy: { keyType: 1, key: Buffer.from(signerKey, 'hex') },
  });
  const content = Content.create({
    contentBody: { oneofKind: 'post', post: { text: 'A test post' } },
  });
  const bundle = makeBundle(key, content, application);
  return {
    sequence,
    bundle,
    id: Buffer.from(EventKey.toBinary(key)).toString('hex'),
    paper: Buffer.from(EventBundle.toBinary(bundle)).toString('base64'),
  };
}

export function postFixtures(signerKey: string) {
  return {
    worldPost: makePost(signerKey, 1n, 'how.justin.harbor-overworld'),
    regularPost: makePost(signerKey, 2n, 'org.futo.harbor'),
  };
}

function grpcFrame(flag: number, payload: Uint8Array) {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function grpcResponse(payload: Uint8Array) {
  return new Response(
    new Uint8Array(
      Buffer.concat([
        grpcFrame(0, payload),
        grpcFrame(128, Buffer.from('grpc-status: 0\r\n')),
      ]),
    ),
    { headers: { 'content-type': 'application/grpc-web+proto' } },
  );
}

export function mockHarbor(
  clockFile: string,
  authorizedKey: string,
  postSigner: string,
) {
  Date.now = () => Number(readFileSync(clockFile, 'utf8'));
  const { worldPost, regularPost } = postFixtures(postSigner);
  const document = makeBundle(
    EventKey.create({ identity: king, collection: 1, sequence: 1n }),
    Content.create({
      contentBody: {
        oneofKind: 'identity',
        identity: {
          signingKeys: [{ keyType: 1, key: Buffer.from(authorizedKey, 'hex') }],
        },
      },
    }),
  );
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.ok(
      ['srv.harbor.social', 'srv.polycentric.io'].includes(url.hostname),
    );
    assert.ok(init?.body instanceof Uint8Array);
    const payload = init.body.subarray(5);
    switch (url.pathname.split('/').pop()) {
      case 'GetExploreFeed':
        return grpcResponse(
          GetFeedResponse.toBinary(
            GetFeedResponse.create({
              eventBundles: [worldPost.bundle, regularPost.bundle],
            }),
          ),
        );
      case 'GetPost': {
        const request = GetPostRequest.fromBinary(payload);
        const post = [worldPost, regularPost].find(
          ({ sequence }) =>
            request.identity === author && sequence === request.sequence,
        );
        return grpcResponse(
          GetPostResponse.toBinary(
            GetPostResponse.create({ candidates: post ? [post.bundle] : [] }),
          ),
        );
      }
      case 'ListEvents': {
        const { filters } = ListEventsRequest.fromBinary(payload);
        return grpcResponse(
          ListEventsResponse.toBinary(
            ListEventsResponse.create({
              eventBundles:
                filters?.identity === king && filters.collection === 1
                  ? [document]
                  : [],
            }),
          ),
        );
      }
      default:
        throw new Error(`Unexpected test request: ${url}`);
    }
  };
}
