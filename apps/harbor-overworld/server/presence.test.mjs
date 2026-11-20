import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import WebSocket from 'ws';

const origin = 'http://127.0.0.1:8080';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { privateKey, key: key.toString('hex') };
}

function kingProof({ key, privateKey }, nonce) {
  const challenge = Buffer.from(`Harbor Overworld King Mode\n${nonce}`);
  const proof = sign(null, challenge, privateKey).toString('hex');
  return { type: 'king', key, proof };
}

function placement({ privateKey }, id, { x, z }, signedEvent, publishedAt) {
  const challenge = Buffer.from(
    `Harbor Overworld post location\n${JSON.stringify([id, x, z, publishedAt])}`,
  );
  const proof = sign(null, challenge, privateKey).toString('hex');
  return { type: 'place', id, x, z, proof, signedEvent, publishedAt };
}

function connect(t) {
  const session = randomBytes(16).toString('hex');
  const ws = new WebSocket(`ws://127.0.0.1:8080/presence?session=${session}`, {
    origin,
  });
  t.after(() => ws.terminate());
  const received = [];
  ws.on('message', (data) => received.push(JSON.parse(data)));
  return {
    received,
    send(value) {
      ws.send(JSON.stringify(value));
    },
    async until(predicate, after = 0) {
      const signal = AbortSignal.timeout(4000);
      for (;;) {
        const match = received.slice(after).find(predicate);
        if (match) return match;
        await once(ws, 'message', { signal });
      }
    },
  };
}

test('standalone Overworld bundle', { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'overworld-test-'));
  const clock = join(dir, 'clock');
  const plots = join(dir, 'plots.json');
  const fixture = join(dir, 'fixture.mjs');
  const preload = join(dir, 'preload.mjs');
  const royalKey = keyPair();
  const authorKey = keyPair();
  let stopServer;
  t.after(async () => {
    await stopServer?.();
    await rm(dir, { recursive: true, force: true });
  });
  await build({
    entryPoints: [
      fileURLToPath(new URL('./presence.fixture.mts', import.meta.url)),
    ],
    outfile: fixture,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const { resetTime, postFixtures, signHeader, exploreFeedResponse } =
    await import(pathToFileURL(fixture));
  const { worldPost, regularPost } = postFixtures(authorKey.key);
  await Promise.all([
    copyFile(
      new URL('../dist-presence/server.mjs', import.meta.url),
      join(dir, 'server.mjs'),
    ),
    writeFile(clock, String(resetTime - 1)),
    writeFile(
      preload,
      `import { mockHarbor } from './fixture.mjs';\nmockHarbor(...${JSON.stringify([clock, royalKey.key, authorKey.key])});\n`,
    ),
  ]);

  async function startServer(plotsFile = plots, feedBaseUrls) {
    const server = spawn(
      process.execPath,
      ['--import', preload, 'server.mjs'],
      {
        cwd: dir,
        env: {
          ...process.env,
          OVERWORLD_PLOTS_FILE: plotsFile,
          OVERWORLD_FEED_BASE_URLS: feedBaseUrls,
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    const exited = once(server, 'exit');
    stopServer = async () => {
      server.kill();
      await exited;
    };
    await Promise.race([
      once(server.stdout, 'data'),
      exited.then(([code]) => {
        throw Error(`Server exited: ${code}`);
      }),
    ]);
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  }

  await t.test(
    'verifies a known device even when both identity lookups stall',
    async () => {
      const verifier = join(dir, 'king.mjs');
      await build({
        entryPoints: [fileURLToPath(new URL('./king.ts', import.meta.url))],
        outfile: verifier,
        bundle: true,
        platform: 'node',
        format: 'esm',
      });
      const { verifyKing } = await import(pathToFileURL(verifier));
      const known = new Set([
        createHash('sha256')
          .update(Buffer.from(royalKey.key, 'hex'))
          .digest('hex'),
      ]);
      const nonce = 'e'.repeat(64);
      const { key, proof } = kingProof(royalKey, nonce);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => new Promise(() => {});
      try {
        assert.equal(await verifyKing(nonce, key, proof, known), true);
        assert.equal(
          await verifyKing('a'.repeat(64), key, proof, known),
          false,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  await t.test(
    'loads daily papers through two root-scoped feed origins',
    async (t) => {
      const feeds = [createServer(), createServer()];
      const requests = feeds.map(async (feed, index) => {
        const seen = [];
        const signal = AbortSignal.timeout(4000);
        for (let page = 0; page < (index === 0 ? 1 : 2); page++) {
          const [request, response] = await once(feed, 'request', { signal });
          seen.push([request.method, request.url]);
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          if (index === 0) {
            response.writeHead(503).end();
            break;
          }
          const fixture = exploreFeedResponse(
            Buffer.concat(chunks).subarray(5),
            authorKey.key,
          );
          response.writeHead(200, {
            'content-type': fixture.headers.get('content-type'),
          });
          response.end(Buffer.from(await fixture.arrayBuffer()));
        }
        return seen;
      });
      const received = Promise.all(requests);
      void received.catch(() => {});
      await Promise.all(
        feeds.map(async (feed) => {
          feed.listen(0, '127.0.0.1');
          await once(feed, 'listening');
          t.after(() => new Promise((resolve) => feed.close(resolve)));
        }),
      );
      try {
        await startServer(
          join(dir, 'override-plots.json'),
          feeds
            .map((feed) => ` http://127.0.0.1:${feed.address().port} `)
            .join(','),
        );
        const viewer = connect(t);
        const [snapshot, feedRequests] = await Promise.all([
          viewer.until((m) => m.type === 'plots'),
          received,
        ]);
        const expectedRequest = [
          'POST',
          '/polycentric.v2.FeedsService/GetExploreFeed',
        ];
        assert.deepEqual(feedRequests, [
          [expectedRequest],
          [expectedRequest, expectedRequest],
        ]);
        assert.deepEqual(snapshot.papers, [regularPost.paper]);
      } finally {
        await stopServer?.();
        stopServer = undefined;
      }
    },
  );

  await startServer();
  const [a, b] = [connect(t), connect(t)];
  const [first, second] = await Promise.all(
    [a, b].map((connection) => connection.until((m) => m.type === 'welcome')),
  );

  await t.test(
    'loads noticeboard posts beyond an Overworld-only feed page',
    async () => {
      const { papers } = await a.until(
        (message) => message.type === 'plots' && message.papers.length > 0,
      );
      assert.deepEqual(papers, [regularPost.paper]);
    },
  );

  await t.test(
    'relays movement without trusting a client-supplied crown',
    async () => {
      assert.notEqual(first.id, second.id);
      assert.notEqual(first.slot, second.slot);
      assert.notEqual(first.nonce, second.nonce);
      const pose = { x: 1, y: 2, z: 3, yaw: 0 };
      a.send({ ...pose, king: true });
      b.send({ ...pose, x: 4 });
      const snapshot = await b.until(
        (m) => m.type === 'players' && m.players.length === 2,
      );
      assert.deepEqual(
        snapshot.players.find((p) => p.id === first.id),
        { id: first.id, ...pose },
      );
      assert.deepEqual(
        snapshot.players.find((p) => p.id === second.id),
        { id: second.id, ...pose, x: 4 },
      );
      await sleep(100); // The protocol rate-limits pose updates.
      a.send({ ...pose, x: 5 });
      await b.until(
        (m) =>
          m.type === 'players' &&
          m.players.some((p) => p.id === first.id && p.x === 5),
      );
    },
  );

  await t.test(
    'enables King Mode only with a current challenge signed by an authorized device',
    async () => {
      b.send(kingProof(keyPair(), second.nonce));
      assert.deepEqual(await b.until((m) => m.type === 'king'), {
        type: 'king',
        enabled: false,
      });

      const proof = kingProof(royalKey, first.nonce);
      a.send(proof);
      assert.deepEqual(await a.until((m) => m.type === 'king'), {
        type: 'king',
        enabled: true,
      });
      const crown = await b.until(
        (m) => m.type === 'players' && m.players.some((p) => p.king),
      );
      assert.deepEqual(
        crown.players.filter((p) => p.king).map((p) => p.id),
        [first.id],
      );

      const observer = connect(t);
      const another = await observer.until((m) => m.type === 'welcome');
      assert.notEqual(another.nonce, first.nonce);
      observer.send(proof);
      assert.deepEqual(await observer.until((m) => m.type === 'king'), {
        type: 'king',
        enabled: false,
      });

      const otherDevice = connect(t);
      const otherWelcome = await otherDevice.until((m) => m.type === 'welcome');
      const beforeTransfer = a.received.length;
      otherDevice.send({ x: 5, y: 2, z: 3, yaw: 0 });
      otherDevice.send(kingProof(royalKey, otherWelcome.nonce));
      assert.deepEqual(await otherDevice.until((m) => m.type === 'king'), {
        type: 'king',
        enabled: true,
      });
      assert.deepEqual(
        await a.until((m) => m.type === 'king', beforeTransfer),
        { type: 'king', enabled: false },
      );
      const newCrown = await b.until(
        (m) =>
          m.type === 'players' &&
          m.players.some((p) => p.id === otherWelcome.id && p.king),
      );
      assert.deepEqual(
        newCrown.players.filter((p) => p.king).map((p) => p.id),
        [otherWelcome.id],
      );
    },
  );

  await t.test(
    'shares the landing immediately and retains it for exactly one minute across restart and the daily reset',
    async () => {
      const location = { x: 0.75, z: 17.25 };
      const initialPlots = await b.until((m) => m.type === 'plots');
      assert.equal(initialPlots.day, '2026-11-19');
      assert.deepEqual(initialPlots.papers, [regularPost.paper]);

      const publicTime = resetTime - 1;
      const header = signHeader(worldPost, authorKey.privateKey);
      const place = (key, location) =>
        placement(key, worldPost.id, location, header, publicTime);
      const signedPlacement = place(authorKey, location);
      const otherLocation = { x: 3, z: 10 };
      const unsigned = { type: 'place', id: worldPost.id, ...otherLocation };
      const denied = [
        ['missing signature', unsigned],
        ['wrong signer', place(royalKey, otherLocation)],
        ['changed coordinates', { ...signedPlacement, ...otherLocation }],
        [
          'wrong application',
          placement(
            authorKey,
            regularPost.id,
            location,
            signHeader(regularPost, authorKey.privateKey),
            publicTime,
          ),
        ],
        [
          'wrong event header',
          {
            ...signedPlacement,
            signedEvent: signHeader(worldPost, royalKey.privateKey),
          },
        ],
      ];
      for (const [reason, message] of denied) {
        const sender = connect(t);
        const player = await sender.until((m) => m.type === 'welcome');
        sender.send(message);
        sender.send({ x: 1, y: 2, z: 3, yaw: 0 });
        await b.until(
          (m) =>
            m.type === 'players' && m.players.some((p) => p.id === player.id),
        );
        assert.equal(
          b.received.some((m) => m.type === 'placements'),
          false,
          reason,
        );
      }

      a.send(signedPlacement);
      const placed = (m) =>
        m.type === 'placements' &&
        m.posts.some((post) => post.id === worldPost.id);
      const expected = {
        id: worldPost.id,
        ...location,
        landedAt: resetTime - 1,
      };
      for (const connection of [a, b]) {
        const message = await connection.until(placed);
        assert.equal(message.day, '2026-11-19');
        assert.equal(message.live, true);
        assert.deepEqual(message.posts, [expected]);
      }

      await stopServer();
      await startServer();
      const viewer = connect(t);
      const restored = await viewer.until(placed);
      assert.equal(restored.live, false);
      assert.deepEqual(restored.posts, [expected]);

      const afterRestore = viewer.received.length;
      viewer.send(place(authorKey, otherLocation));
      const duplicate = await viewer.until(placed, afterRestore);
      assert.equal(duplicate.live, false);
      assert.deepEqual(duplicate.posts, [expected]);

      await writeFile(clock, String(resetTime));
      const nextDayViewer = connect(t);
      assert.deepEqual(
        await nextDayViewer.until(
          (m) => m.type === 'plots' && m.day === '2026-11-20',
        ),
        { type: 'plots', day: '2026-11-20', papers: [] },
      );
      assert.deepEqual((await nextDayViewer.until(placed)).posts, [expected]);

      await writeFile(clock, String(publicTime + 60_000));
      const expiredViewer = connect(t);
      await expiredViewer.until((m) => m.type === 'welcome');
      expiredViewer.send(signedPlacement);
      expiredViewer.send({ x: 1, y: 2, z: 3, yaw: 0 });
      await expiredViewer.until(
        (m) => m.type === 'players' && m.players.length > 0,
      );
      assert.equal(expiredViewer.received.some(placed), false);
    },
  );
});
