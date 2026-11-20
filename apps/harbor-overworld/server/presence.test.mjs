import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const origin = 'http://127.0.0.1:8080';

test('standalone bundle serves health and relays movement between players', {
  timeout: 15000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'overworld-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await copyFile(
    new URL('../dist-presence/server.mjs', import.meta.url),
    join(dir, 'server.mjs'),
  );
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: { ...process.env, OVERWORLD_PLOTS_FILE: join(dir, 'plots.json') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(server, 'exit');
  t.after(async () => {
    server.kill();
    await exited;
  });
  await Promise.race([
    once(server.stdout, 'data'),
    exited.then(([code]) => {
      throw Error(`Server exited: ${code}`);
    }),
  ]);
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);

  function connect() {
    const session = randomBytes(16).toString('hex');
    const ws = new WebSocket(
      `ws://127.0.0.1:8080/presence?session=${session}`,
      { origin },
    );
    t.after(() => ws.terminate());
    return ws;
  }
  async function until(ws, predicate) {
    const signal = AbortSignal.timeout(3000);
    for (;;) {
      const [data] = await once(ws, 'message', { signal });
      const message = JSON.parse(data);
      if (predicate(message)) return message;
    }
  }
  const [a, b] = [connect(), connect()];
  const [first, second] = await Promise.all(
    [a, b].map((ws) => until(ws, (m) => m.type === 'welcome')),
  );
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.slot, second.slot);
  const pose = { x: 1, y: 2, z: 3, yaw: 0 };
  a.send(JSON.stringify(pose));
  b.send(JSON.stringify({ ...pose, x: 4 }));
  const snapshot = await until(
    b,
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
  a.send(JSON.stringify({ ...pose, x: 5 }));
  await until(
    b,
    (m) =>
      m.type === 'players' &&
      m.players.some((p) => p.id === first.id && p.x === 5),
  );
});
