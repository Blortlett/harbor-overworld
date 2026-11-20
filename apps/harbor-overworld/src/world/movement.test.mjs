import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: {
    contents: "export * from './renderer'; export * from './terrain';",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true,
  format: 'esm',
  write: false,
});
const { EYE_HEIGHT, STATIONS, WATER, ground, makeTerrain, walk } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const { obstacles } = makeTerrain();
const forward = new Set(['KeyW']);
const east = new Set(['KeyD']);
const west = new Set(['KeyA']);
const dt = 0.05;

function viewAt(x, z) {
  return { x, y: ground(x, z) + EYE_HEIGHT, z, yaw: 0, pitch: 0 };
}

test('a high jump clears a noticeboard that blocks walking', () => {
  const [x, z] = STATIONS[0];
  const view = viewAt(x, z + 0.5);
  walk(view, forward, dt, obstacles, 1);
  assert.equal(view.z, z + 0.5);
  walk(view, forward, dt, obstacles, 1, undefined, ground(x, z) + 5);
  assert.ok(view.z < z + 0.42, 'the board should stop blocking above its top');
});

test('a high jump clears the lighthouse footprint', () => {
  const view = viewAt(26.5, -35);
  walk(view, forward, dt, obstacles, 0);
  assert.equal(view.z, -35);
  walk(view, forward, dt, obstacles, 0, undefined, 30);
  assert.ok(view.z < -35);
});

test('walk into the sea and back onto the same beach', () => {
  const view = viewAt(6.5, 17.5);
  const start = view.x;
  assert.ok(ground(view.x, view.z) > WATER);
  for (let i = 0; i < 40; i++) walk(view, east, dt, obstacles, 0);
  assert.ok(ground(view.x, view.z) < WATER, 'the shoreline should be passable');
  for (let i = 0; i < 40; i++) walk(view, west, dt, obstacles, 0);
  assert.ok(view.x <= start + 0.01);
  assert.ok(ground(view.x, view.z) > WATER);
});
