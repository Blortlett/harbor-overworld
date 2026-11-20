import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fly, parkedPlane } from './flight.ts';
import { createLandShark, LAND_SHARK_SPEED } from './land-shark.ts';
import { createPlayerMovement, EYE_HEIGHT, WALK_SPEED } from './movement.ts';
import { replayScenario, scenarios, scenarioView } from './scenarios.ts';
import {
  ground,
  inWorld,
  ISLAND_BOUNDS,
  makeTerrain,
  MAX_X,
  WATER,
} from './terrain.ts';

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

test('king-ascent rises at 11 units per second while held and falls when released', () => {
  const scene = scenarios['king-ascent'];
  const frames = replay(scene);
  const start = ground(scene.x, scene.z) + EYE_HEIGHT;
  for (let frame = 1; frame < 120; frame++)
    assert.ok(frames[frame].y > frames[frame - 1].y);
  assert.ok(Math.abs(frames[119].y - start - 22) < 1e-9);
  assert.ok(frames[120].y < frames[119].y);
  assert.equal(frames.at(-1).y, start);
});

test('sprinting doubles walking speed for players and gives King an eightfold boost', () => {
  const scene = scenarios.sprint;
  const sprint = replay(scene);
  const king = replay(scenarios['king-sprint']);
  const walk = replay({
    ...scene,
    segments: scene.segments.map((segment) => ({ ...segment, sprint: false })),
  });
  assert.ok(Math.abs(scene.z - sprint[3].z - 2 * (scene.z - walk[3].z)) < 1e-9);
  assert.ok(Math.abs(scene.z - king[3].z - 8 * (scene.z - walk[3].z)) < 1e-9);
  assert.ok(sprint.at(-1).z > scene.z - 5);
  assert.equal(sprint.at(-1).z, sprint[60].z);
  assert.equal(king.at(-1).z, sprint.at(-1).z);
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

test('the southern path passes through the arch', () => {
  const scene = scenarios['south-arch'];
  const view = replay(scene).at(-1);
  assert.ok(view.z > scene.z + 6);
});

test('holding the yoke completes a loop and releasing it holds pitch', () => {
  const start = { x: 36, y: 21, z: 5, yaw: 0, pitch: 0 };
  let flight = { ...parkedPlane(start), speed: 16, airborne: true };
  let rotation = 0;
  let highest = start.y;
  for (let frame = 0; rotation < 2 * Math.PI && frame < 300; frame++) {
    const next = fly(
      flight,
      1 / 60,
      { forward: 0, steer: 0, climb: 1 },
      obstacles,
    );
    assert.ok(!('crash' in next));
    const delta = next.pose.pitch - flight.pose.pitch;
    rotation += Math.atan2(Math.sin(delta), Math.cos(delta));
    highest = Math.max(highest, next.pose.y);
    flight = next;
  }
  assert.ok(rotation >= 2 * Math.PI);
  assert.ok(highest > start.y + 14);
  assert.ok(Math.abs(flight.pose.y - start.y) < 1);
  assert.ok(Math.abs(flight.pose.z - start.z) < 1);
  const level = fly(
    flight,
    1 / 60,
    { forward: 0, steer: 0, climb: 0 },
    obstacles,
  );
  assert.ok(Math.abs(level.pose.pitch - flight.pose.pitch) < 1e-12);
});

test('open water surrounds the island and supports movement far from shore', () => {
  const { minX, maxX, minZ, maxZ } = ISLAND_BOUNDS;
  // Trace a rectangle wide enough to pass the complete island and its dock.
  for (let x = minX - 20; x <= maxX + 20; x++) {
    for (const z of [minZ - 20, maxZ + 20]) {
      assert.ok(inWorld(x, z) && ground(x, z) < WATER);
    }
  }
  for (let z = minZ - 20; z <= maxZ + 20; z++) {
    for (const x of [minX - 20, maxX + 20]) {
      assert.ok(inWorld(x, z) && ground(x, z) < WATER);
    }
  }
  const scene = scenarios['open-water'];
  assert.ok(replay(scene).at(-1).x > scene.x + 4);

  let plane = {
    ...parkedPlane({
      x: MAX_X - 10,
      y: 20,
      z: -300,
      yaw: Math.PI / 2,
      pitch: 0,
    }),
    speed: 30,
    airborne: true,
  };
  for (let frame = 0; frame < 60; frame++) {
    plane = fly(plane, 1 / 60, { forward: 0, steer: 0, climb: 0 }, obstacles);
    assert.ok(!('crash' in plane));
  }
  assert.equal(plane.pose.x, MAX_X - 4);
});

test('the land shark walks to sea, chases a swimmer, and kills on contact', () => {
  const shark = createLandShark();
  const start = shark.pose;
  assert.equal(LAND_SHARK_SPEED, (WALK_SPEED + WALK_SPEED * 2) / 2);
  shark.step(0.1, []);
  assert.equal(shark.pose.walking, true);
  assert.ok(Math.abs(shark.pose.x - start.x - LAND_SHARK_SPEED * 0.1) < 1e-9);

  const swimmer = { id: 1, x: 24.5, y: WATER - 0.5, z: 25.5 };
  const bystander = { id: 2, x: -6.5, y: ground(-6.5, 29.5), z: 29.5 };
  const driver = { id: 3, x: 13, y: WATER + 0.29, z: 25.5 };
  let bitten = [];
  for (let frame = 0; frame < 80 && !bitten.length; frame++)
    bitten = shark.step(0.1, [swimmer, bystander, driver]);
  assert.equal(shark.pose.walking, false);
  assert.equal(shark.pose.z, swimmer.z);
  assert.deepEqual(bitten, [swimmer.id]);
});
