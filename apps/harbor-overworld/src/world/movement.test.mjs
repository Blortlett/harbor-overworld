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

test('a regular player can walk out of a noticeboard that appeared around them', () => {
  const [x, z] = STATIONS[0];
  const view = viewAt(x, z);
  for (let i = 0; i < 4; i++) walk(view, forward, dt, obstacles, 1);
  assert.ok(view.z <= z - 0.42, 'walking away should escape the new board');
});

test('a regular player can retreat when their footprint overlaps a steep ledge', () => {
  const view = viewAt(-73.04, -96.5);
  const y = ground(view.x, view.z);
  assert.equal(ground(view.x + 0.18, view.z), y + 2);
  for (let i = 0; i < 4; i++) walk(view, west, 1 / 60, obstacles, 0);
  assert.ok(view.x < -73.18, 'the footprint should be able to leave the ledge');
});

test('a regular player can move away from a tree while its trunk stays solid', () => {
  const trunk = obstacles.find(
    (obstacle) =>
      obstacle.x === -5.5 && obstacle.z === 0.5 && obstacle.halfWidth === 0.21,
  );
  assert.ok(trunk);
  const view = viewAt(trunk.x, trunk.z);
  for (let i = 0; i < 4; i++) walk(view, west, dt, obstacles, 0);
  assert.ok(view.x < trunk.x - trunk.halfWidth - 0.17);
  for (let i = 0; i < 8; i++) walk(view, east, dt, obstacles, 0);
  assert.ok(view.x <= trunk.x - trunk.halfWidth - 0.17);
});
