import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlayerMovement } from './movement.ts';
import { replayScenario, scenarios, scenarioView } from './scenarios.ts';
import { ground, makeTerrain, WATER } from './terrain.ts';

const { obstacles } = makeTerrain();

function replay(scenario) {
  const player = createPlayerMovement(scenarioView(scenario));
  return Array.from(
    replayScenario(player, scenario, {
      obstacles,
      stationCount: scenario.stations ?? 0,
    }),
  );
}

test('king-jump clears a noticeboard that blocks walking', () => {
  const scene = scenarios['king-jump'];
  const frames = replay(scene);
  assert.equal(frames[11].z, frames[0].z);
  assert.ok(
    frames.at(-1).z < scene.z - 1,
    'jumping lets the player cross the board',
  );
});

test('lighthouse clears the lighthouse footprint with chained King jumps', () => {
  const scene = scenarios.lighthouse;
  const frames = replay(scene);
  assert.equal(frames[11].z, frames[0].z);
  assert.ok(
    frames.at(-1).z < scene.z - 1,
    'jumping lets the player cross the footprint',
  );
});

test('shoreline enters the sea and returns to the same beach', () => {
  const scene = scenarios.shoreline;
  const frames = replay(scene);
  const water = frames[119];
  const land = frames.at(-1);
  assert.ok(ground(water.x, water.z) < WATER);
  assert.ok(Math.abs(land.x - scene.x) < 0.01);
  assert.ok(ground(land.x, land.z) > WATER);
});

test('board lets a regular player walk out of a noticeboard that appeared around them', () => {
  const scene = scenarios.board;
  assert.ok(replay(scene).at(-1).z <= scene.z - 0.42);
});

test('ledge lets a regular player retreat when their footprint overlaps a steep ledge', () => {
  const scene = scenarios.ledge;
  assert.equal(ground(scene.x + 0.18, scene.z), ground(scene.x, scene.z) + 2);
  assert.ok(replay(scene).at(-1).x < -73.18);
});

test('tree lets a regular player walk away while the trunk stays solid', () => {
  const scene = scenarios.tree;
  const trunk = obstacles.find(
    (obstacle) =>
      obstacle.x === scene.x &&
      obstacle.z === scene.z &&
      obstacle.halfWidth === 0.21,
  );
  assert.ok(trunk);
  const frames = replay(scene);
  assert.ok(frames[11].x < trunk.x - trunk.halfWidth - 0.17);
  assert.ok(frames.at(-1).x <= trunk.x - trunk.halfWidth - 0.17);
});
