import type { ShotPath, ShotPoint } from './presence-protocol';
import type { View } from './movement';
import { Mesh } from './terrain';

export type ShotEffect = { at: number; path?: ShotPath; ownShot: boolean };
export const SHOT_EFFECT_DURATION = 0.17;
export const MUZZLE_DURATION = 0.085;
const MUZZLE: ShotPoint = [0.23, -0.27, -0.96];

function flare(mesh: Mesh, [x, y, z]: ShotPoint, size: number) {
  const gold = [1, 0.57, 0.09] as const;
  const white = [1, 0.96, 0.68] as const;
  const thin = size * 0.28;
  mesh.box(x - size, y - thin, z - thin, size * 2, thin * 2, thin * 2, gold, 3);
  mesh.box(x - thin, y - size, z - thin, thin * 2, size * 2, thin * 2, gold, 3);
  mesh.box(x - thin, y - thin, z - size, thin * 2, thin * 2, size * 2, gold, 3);
  mesh.box(
    x - thin,
    y - thin,
    z - thin,
    thin * 2,
    thin * 2,
    thin * 2,
    white,
    3,
  );
}

export function firstPersonFlare() {
  const mesh = new Mesh();
  flare(mesh, MUZZLE, 0.15);
  return new Float32Array(mesh.vertices);
}

function firstPersonMuzzle(view: View): ShotPoint {
  const [right, up, back] = MUZZLE;
  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  const sinPitch = Math.sin(view.pitch);
  const level = Math.cos(view.pitch);
  const forward = -up * sinPitch - back * level;
  return [
    view.x + cos * right + sin * forward,
    view.y + up * level - back * sinPitch,
    view.z + sin * right - cos * forward,
  ];
}

export function shotEffectsMesh(
  shots: readonly ShotEffect[],
  view: View,
  time: number,
) {
  const mesh = new Mesh();
  for (const { at, ownShot, path } of shots) {
    if (!path) continue;
    const age = Math.max(0, time - at);
    const { end, impact } = path;
    const start = ownShot ? firstPersonMuzzle(view) : path.start;
    if (age < MUZZLE_DURATION && !ownShot) flare(mesh, start, 0.3);
    if (age < 0.1) {
      const width = 0.036 * (1 - age / 0.1);
      const x = Math.cos(view.yaw) * width;
      const z = Math.sin(view.yaw) * width;
      mesh.quad(
        [start[0] - x, start[1], start[2] - z],
        [start[0] + x, start[1], start[2] + z],
        [end[0] + x, end[1], end[2] + z],
        [end[0] - x, end[1], end[2] - z],
        [1, 0.81, 0.37],
        3,
      );
    }
    if (impact) flare(mesh, end, 0.16 * (1 - age / SHOT_EFFECT_DURATION));
  }
  return new Float32Array(mesh.vertices);
}
