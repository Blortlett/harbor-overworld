import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlayerMovement, EYE_HEIGHT } from './movement.ts';
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

test('king-ascent rises continuously while held and falls when released', () => {
  const scene = scenarios['king-ascent'];
  const frames = replay(scene);
  const start = ground(scene.x, scene.z) + EYE_HEIGHT;
  for (let frame = 1; frame < 120; frame++)
    assert.ok(frames[frame].y > frames[frame - 1].y);
  assert.ok(frames[119].y > start + 10);
  assert.ok(frames[120].y < frames[119].y);
  assert.equal(frames.at(-1).y, start);
});

test('king-sprint is eight times as fast and stops at a noticeboard', () => {
  const scene = scenarios['king-sprint'];
  const sprint = replay(scene);
  const walk = replay({ ...scene, king: false });
  assert.ok(Math.abs(scene.z - sprint[3].z - 8 * (scene.z - walk[3].z)) < 1e-9);
  assert.ok(sprint.at(-1).z > scene.z - 5);
  assert.equal(sprint.at(-1).z, sprint[30].z);
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

test('ledge-drop falls under gravity and lands three blocks down', () => {
  const scene = scenarios['ledge-drop'];
  const upper = ground(scene.x, scene.z);
  const lower = ground(scene.x + 1, scene.z);
  assert.equal(upper - lower, 3);
  const frames = replay(scene);
  assert.ok(frames[12].x > scene.x + 0.75, 'the player walks off the ledge');
  assert.ok(frames[12].y > lower + EYE_HEIGHT, 'the player is still falling');
  assert.equal(frames.at(-1).y, lower + EYE_HEIGHT);
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
