import {
  DROP_BASE,
  DROP_DURATION,
  DROP_HALF_WIDTH,
  DROP_HEIGHT,
  type PostMark,
} from './post-marks.ts';
import { GAME_SHOT_RANGE, rayBox, sharkHitDepth } from './shot-ray.ts';
import type { SharkPose } from './land-shark.ts';
import { EYE_HEIGHT } from './movement.ts';
import type {
  PlacedPost,
  Player,
  Pose,
  Shoot,
  ShotPath,
  ShotPoint,
} from './presence-protocol.ts';
import {
  ground,
  type Obstacle,
  NOTICE,
  STATION_TOP,
  STATIONS,
  stationPenetration,
  WATER,
} from './terrain.ts';

const BODY_HALF_WIDTH = 0.38;
const BODY_HEIGHT = 1.52;

export function traceShot(
  shooter: Pose & { id: number },
  aim: Shoot,
  players: readonly Player[],
  obstacles: readonly Obstacle[],
  {
    day,
    stationCount,
    drops,
    shark,
  }: {
    day?: string;
    stationCount: number;
    drops: Iterable<PlacedPost>;
    shark?: SharkPose;
  },
): { path: ShotPath; target?: number; sharkHit?: true } {
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
  let nearest = GAME_SHOT_RANGE;
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
  const sharkDistance = shark
    ? sharkHitDepth(origin, direction, shark, nearest)
    : undefined;
  if (sharkDistance !== undefined) {
    nearest = sharkDistance;
    hit = undefined;
  }

  let paper: PostMark | undefined;
  const now = Date.now();
  if (day) {
    for (let station = 0; station < stationCount; station++) {
      const [x, z, sideways] = STATIONS[station];
      const normal = sideways ? -direction[0] : direction[2];
      if (Math.abs(normal) < 1e-8) continue;
      const side = normal < 0 ? 1 : -1;
      const offset = sideways ? x - origin[0] : origin[2] - z;
      const distance = (side * NOTICE.face - offset) / normal;
      if (distance <= 0 || distance >= nearest) continue;
      const [px, y, pz] = pointAt(distance);
      const u = 0.5 + (side * (sideways ? pz - z : px - x)) / NOTICE.width;
      const v = 1 - (y - ground(x, z) - NOTICE.bottom) / NOTICE.height;
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
      nearest = distance;
      hit = undefined;
      paper = { kind: 'board', day, station, side, u, v };
    }
  }
  for (const drop of drops) {
    if (now - drop.landedAt < DROP_DURATION * 1000 || level <= 0) continue;
    const dx = drop.x - origin[0];
    const dz = drop.z - origin[2];
    const distance = (dx * sin - dz * cos) / level;
    if (distance <= 0 || distance >= nearest) continue;
    const u = 0.5 - (dx * cos + dz * sin) / (2 * DROP_HALF_WIDTH);
    const bottom =
      (drop.floor ?? Math.max(WATER, ground(drop.x, drop.z))) + DROP_BASE;
    const v = 1 - (pointAt(distance)[1] - bottom) / DROP_HEIGHT;
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
    nearest = distance;
    hit = undefined;
    paper = { kind: 'drop', id: drop.id, u, v };
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
      if (paper?.kind === 'board' && paper.station === index) continue;
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
  if (paper) {
    return {
      path: {
        start: muzzle,
        end: pointAt(nearest),
        impact: true,
        postMark: paper,
      },
    };
  }
  return {
    path: {
      start: muzzle,
      end: pointAt(nearest),
      impact: !!hit || sharkDistance !== undefined,
    },
    target: hit?.id,
    sharkHit: sharkDistance === undefined ? undefined : true,
  };
}
