import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
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
    async close() {
      ws.close();
      await once(ws, 'close');
    },
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
  const otherKey = keyPair();
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
  const {
    resetTime,
    postFixtures,
    signHeader,
    exploreFeedResponse,
    createCrown,
    EYE_HEIGHT,
    spawnView,
    HIT_LINES,
    ground,
    WATER,
  } = await import(pathToFileURL(fixture));
  const { worldPost, regularPost } = postFixtures(authorKey.key);
  await Promise.all([
    copyFile(
      new URL('../dist-presence/server.mjs', import.meta.url),
      join(dir, 'server.mjs'),
    ),
    writeFile(clock, String(resetTime - 1)),
    writeFile(
      preload,
      `import { mockHarbor } from './fixture.mjs';\nmockHarbor(...${JSON.stringify([clock, authorKey.key])});\n`,
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

  await t.test('expires the crown after exactly one minute', () => {
    const crown = createCrown();
    const { location } = crown.state;
    assert.ok(ground(location.x, location.z) > WATER);
    const player = { id: 1, ...location, y: ground(location.x, location.z) };
    crown.update(100, [player]);
    assert.deepEqual(crown.state, { holder: 1, expiresAt: 60_100 });
    crown.update(60_099, [player]);
    assert.equal(crown.state.holder, 1);
    crown.update(60_100, [player]);
    assert.ok(ground(crown.state.location.x, crown.state.location.z) > WATER);
    assert.notDeepEqual(crown.state.location, location);
  });

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
      const pose = { x: 1, y: 2, z: 3, yaw: 0 };
      a.send({ ...pose, king: true, kingScale: 10 });
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
    'shares a single crown pickup and respawns it on departure',
    async () => {
      const [collector, rival] = [connect(t), connect(t)];
      const { id: rivalId } = await rival.until((m) => m.type === 'welcome');
      const { id } = await collector.until((m) => m.type === 'welcome');
      const initial = await collector.until((m) => m.type === 'players');
      const { crown: location } = initial;
      assert.ok(ground(location.x, location.z) > WATER);
      assert.equal(
        initial.players.some((p) => p.king),
        false,
      );
      assert.deepEqual(
        (await a.until((m) => m.type === 'players')).crown,
        location,
      );

      const pose = { ...location, y: ground(location.x, location.z), yaw: 0 };
      collector.send({ ...pose, y: pose.y + 2, king: true });
      const above = await b.until(
        (m) =>
          m.type === 'players' &&
          m.players.some((p) => p.id === id && p.y === pose.y + 2),
      );
      assert.deepEqual(above.crown, location);

      await sleep(100);
      collector.send(pose);
      rival.send(pose);
      const claimed = (m) =>
        m.type === 'players' && m.crown.holder !== undefined;
      const snapshots = await Promise.all(
        [a, collector, rival].map((client) => client.until(claimed)),
      );
      const { holder, remainingMs } = snapshots[0].crown;
      assert.ok(holder === id || holder === rivalId);
      assert.ok(remainingMs > 59_000 && remainingMs <= 60_000);
      assert.equal(
        snapshots.every((m) => m.crown.holder === holder),
        true,
      );
      for (const snapshot of snapshots)
        assert.deepEqual(
          snapshot.players.filter((p) => p.king).map((p) => p.id),
          [holder],
        );

      const winner = holder === id ? collector : rival;
      const observer = holder === id ? rival : collector;
      const cursor = observer.received.length;
      await winner.close();
      const respawn = await observer.until(
        (m) => m.type === 'players' && 'x' in m.crown,
        cursor,
      );
      assert.notDeepEqual(respawn.crown, location);
      assert.equal(
        respawn.players.some((p) => p.king),
        false,
      );

      const next = {
        ...respawn.crown,
        y: ground(respawn.crown.x, respawn.crown.z),
        yaw: 0,
      };
      observer.send({ ...next, kingScale: 5 });
      const nextClaim = await observer.until(claimed, cursor);
      assert.notEqual(nextClaim.crown.holder, holder);
      assert.equal(nextClaim.players.find((p) => p.king)?.kingScale, 5);
      await observer.close();
    },
  );

  await t.test(
    'only the King can shoot and the whole room receives the hit',
    async (t) => {
      const [shooter, victim] = [connect(t), connect(t)];
      const me = await shooter.until((m) => m.type === 'welcome');
      const other = await victim.until((m) => m.type === 'welcome');
      const start = await shooter.until((m) => m.type === 'players');
      const onCrown = {
        ...start.crown,
        y: ground(start.crown.x, start.crown.z),
        yaw: 0,
      };
      const from = { x: 0.5, y: 40, z: 17.5, yaw: 0 };
      const at = { ...from, z: 10.5 };
      const aim = {
        type: 'shoot',
        yaw: 0,
        pitch: Math.atan2(0.75 - 2 * EYE_HEIGHT, from.z - at.z),
        kingScale: 2,
      };
      const atHeight = (id, y) => (m) =>
        m.type === 'players' && m.players.some((p) => p.id === id && p.y === y);
      victim.send(aim);
      victim.send(at);
      await victim.until(atHeight(other.id, at.y));
      assert.equal(
        victim.received.some((m) => m.type === 'gunshot'),
        false,
      );

      shooter.send(onCrown);
      await shooter.until(
        (m) => m.type === 'players' && m.crown.holder === me.id,
      );
      await sleep(100);
      shooter.send(from);
      await shooter.until(atHeight(me.id, from.y));
      shooter.send(aim);
      shooter.send(aim);
      const [shot, heardByVictim, heardByObserver] = await Promise.all(
        [shooter, victim, a].map((peer) =>
          peer.until((m) => m.type === 'gunshot'),
        ),
      );
      assert.deepEqual(heardByVictim, shot);
      assert.deepEqual(heardByObserver, shot);
      assert.equal(shot.shooter, me.id);
      assert.equal(shot.path.impact, true);
      assert.ok(Math.abs(shot.path.end[2] - at.z) < 0.4);
      assert.equal(shot.hit.id, other.id);
      assert.ok(HIT_LINES[shot.hit.line]);
      assert.deepEqual(shot.hit.respawn, {
        id: other.id,
        slot: other.slot,
        spawnRevision: 1,
      });

      const spawn = spawnView(other.slot);
      const cursor = victim.received.length;
      victim.send(at);
      const afterHit = await victim.until((m) => m.type === 'players', cursor);
      const respawned = afterHit.players.find((p) => p.id === other.id);
      assert.equal(respawned.x, spawn.x);
      assert.equal(respawned.z, spawn.z);
      assert.equal(respawned.y, spawn.y - EYE_HEIGHT);
      assert.equal(
        victim.received.filter((m) => m.type === 'gunshot').length,
        1,
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
        ['wrong signer', place(otherKey, otherLocation)],
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
            signedEvent: signHeader(worldPost, otherKey.privateKey),
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
