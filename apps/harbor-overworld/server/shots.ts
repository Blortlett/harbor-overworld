import { EYE_HEIGHT } from '../src/world/movement.ts';
import type {
  Player,
  Pose,
  Shoot,
  ShotPath,
  ShotPoint,
} from '../src/world/presence-protocol.ts';
import {
  ground,
  type Obstacle,
  STATION_TOP,
  STATIONS,
  stationPenetration,
  WATER,
} from '../src/world/terrain.ts';

const RANGE = 65;
const BODY_HALF_WIDTH = 0.38;
const BODY_HEIGHT = 1.52;

function rayBox(
  origin: ShotPoint,
  direction: ShotPoint,
  minimum: ShotPoint,
  maximum: ShotPoint,
  limit: number,
) {
  let entry = 0;
  let exit = limit;
  for (let axis = 0; axis < 3; axis++) {
    const component = direction[axis];
    if (Math.abs(component) < 1e-8) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis])
        return undefined;
      continue;
    }
    const a = (minimum[axis] - origin[axis]) / component;
    const b = (maximum[axis] - origin[axis]) / component;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return undefined;
  }
  return entry;
}

export function traceShot(
  shooter: Pose & { id: number },
  aim: Shoot,
  players: readonly Player[],
  obstacles: readonly Obstacle[],
  stationCount: number,
): { path: ShotPath; target?: number } {
  const level = Math.cos(aim.pitch);
  const origin: ShotPoint = [
    shooter.x,
    shooter.y + EYE_HEIGHT * aim.kingScale,
    shooter.z,
  ];
  const direction: ShotPoint = [
    level * Math.sin(aim.yaw),
    Math.sin(aim.pitch),
    -level * Math.cos(aim.yaw),
  ];
  const arm = aim.kingScale;
  const sin = Math.sin(aim.yaw);
  const cos = Math.cos(aim.yaw);
  const muzzle: ShotPoint = [
    shooter.x + arm * (cos * 0.31 + sin * 0.42),
    shooter.y + arm * 0.81,
    shooter.z + arm * (sin * 0.31 - cos * 0.42),
  ];
  const pointAt = (distance: number): ShotPoint => [
    origin[0] + distance * direction[0],
    origin[1] + distance * direction[1],
    origin[2] + distance * direction[2],
  ];
  let nearest = RANGE;
  let hit: Player | undefined;
  for (const player of players) {
    if (player.id === shooter.id) continue;
    const { x, y, z } = player;
    const distance = rayBox(
      origin,
      direction,
      [x - BODY_HALF_WIDTH, y, z - BODY_HALF_WIDTH],
      [x + BODY_HALF_WIDTH, y + BODY_HEIGHT, z + BODY_HALF_WIDTH],
      nearest,
    );
    if (distance !== undefined && distance < nearest) {
      nearest = distance;
      hit = player;
    }
  }
  function blocked([x, y, z]: ShotPoint) {
    if (y < Math.max(WATER, ground(x, z))) return true;
    for (const obstacle of obstacles) {
      if (y < obstacle.bottom || y > obstacle.top) continue;
      const dx = Math.abs(x - obstacle.x);
      const dz = Math.abs(z - obstacle.z);
      const inside =
        'radius' in obstacle
          ? Math.hypot(dx, dz) < obstacle.radius
          : dx < obstacle.halfWidth && dz < obstacle.halfDepth;
      if (inside) return true;
    }
    for (let index = 0; index < stationCount; index++) {
      const station = STATIONS[index];
      if (stationPenetration(station, x, z) <= 0) continue;
      const bottom = ground(station[0], station[1]);
      if (y >= bottom && y <= bottom + STATION_TOP) return true;
    }
    return false;
  }

  for (let distance = 0; distance < nearest; distance += 0.15) {
    const point = pointAt(distance);
    if (blocked(point)) {
      const end = pointAt(Math.max(0, distance - 0.1));
      return { path: { start: muzzle, end, impact: true } };
    }
  }
  return {
    path: { start: muzzle, end: pointAt(nearest), impact: !!hit },
    target: hit?.id,
  };
}
