import type { SharkPose } from './land-shark.ts';
import type { ShotPoint } from './presence-protocol.ts';
import { WATER } from './terrain.ts';

export const GAME_SHOT_RANGE = 65;

export function rayBox(
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

export function sharkHitDepth(
  origin: ShotPoint,
  direction: ShotPoint,
  shark: SharkPose,
  limit: number,
) {
  if (shark.dying) return undefined;
  const { x, y, z, yaw } = shark;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const transform = ([x, y, z]: ShotPoint): ShotPoint => [
    cos * x + sin * z,
    y,
    cos * z - sin * x,
  ];
  return rayBox(
    transform([origin[0] - x, origin[1] - y, origin[2] - z]),
    transform(direction),
    [-0.52, shark.inWater ? WATER - y : 0, -1.36],
    [0.52, 2.22, 1.75],
    limit,
  );
}
