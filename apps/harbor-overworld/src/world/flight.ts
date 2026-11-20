import {
  DOCK,
  ground,
  MAX_X,
  MAX_Z,
  MIN_X,
  MIN_Z,
  type Obstacle,
  WATER,
} from './terrain.ts';

export type PlanePose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export const SEAPLANE_BERTH: PlanePose = {
  x: 16.1,
  y: WATER,
  z: DOCK.z - 4,
  yaw: 0,
  pitch: 0,
};
export const SEAPLANE_BOARDING = {
  x: SEAPLANE_BERTH.x,
  z: DOCK.z - 0.7,
  floor: DOCK.deck,
};

type Flight = {
  pose: PlanePose;
  throttle: number;
  speed: number;
  airborne: boolean;
};

const CONTACT_POINTS = [
  [0, -2.25, 0.47, 1.55],
  [-0.88, -1.85, -0.08, 0.31],
  [0.88, -1.85, -0.08, 0.31],
  [-3.3, -0.5, 1.86, 2.05],
  [3.3, -0.5, 1.86, 2.05],
  [0, 0, 0.65, 1.93],
  [-0.88, 1.7, -0.08, 0.31],
  [0.88, 1.7, -0.08, 0.31],
  [0, 2.6, 0.9, 1.9],
] as const;
const TAKEOFF_SPEED = 9;
const ACCELERATION = 13;
const BRAKING = 20;
const REVERSE_ACCELERATION = 8;
const PITCH_RATE = 1.65;
const LANDING_PITCH = 0.55;
const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function parkedPlane(pose: PlanePose = SEAPLANE_BERTH): Flight {
  return { pose: { ...pose }, throttle: 0, speed: 0, airborne: false };
}

export function planeOffset(
  { x, z, yaw }: PlanePose,
  right: number,
  back: number,
) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: x + cos * right - sin * back, z: z + sin * right + cos * back };
}

function clearOfTerrain(pose: PlanePose, obstacles: readonly Obstacle[]) {
  const sin = Math.sin(pose.pitch);
  const cos = Math.cos(pose.pitch);
  return CONTACT_POINTS.every(([right, back, bottom, top]) => {
    const { x, z } = planeOffset(pose, right, back * cos + bottom * sin);
    const bottomY = pose.y + bottom * cos - back * sin;
    const topY = pose.y + top * cos - back * sin;
    const low = Math.min(bottomY, topY);
    const high = Math.max(bottomY, topY);
    if (ground(x, z) > low) return false;
    return obstacles.every((obstacle) => {
      if (low >= obstacle.top || high <= obstacle.bottom) return true;
      const dx = Math.abs(x - obstacle.x);
      const dz = Math.abs(z - obstacle.z);
      return 'radius' in obstacle
        ? Math.hypot(dx, dz) >= obstacle.radius
        : dx >= obstacle.halfWidth || dz >= obstacle.halfDepth;
    });
  });
}

export function fly(
  state: Flight,
  dt: number,
  { forward, steer, climb }: { forward: number; steer: number; climb: number },
  obstacles: readonly Obstacle[],
): Flight | { crash: PlanePose } {
  const thrust = clamp(forward, -1, 1);
  const throttle = Math.max(0, thrust);
  const acceleration =
    thrust >= 0
      ? ACCELERATION
      : state.speed > 0
        ? BRAKING
        : REVERSE_ACCELERATION;
  const nextSpeed = state.speed + thrust * acceleration * dt;
  const speed = state.airborne ? Math.max(0, nextSpeed) : nextSpeed;
  const airborne = state.airborne || (climb > 0.2 && speed >= TAKEOFF_SPEED);
  const pitch = airborne
    ? state.pose.pitch + clamp(climb, -1, 1) * PITCH_RATE * dt
    : 0;
  const yaw =
    state.pose.yaw + clamp(steer, -1, 1) * dt * (airborne ? 1.65 : 1.15);
  const sink = Math.max(0, TAKEOFF_SPEED - speed) * 0.5;
  // At takeoff speed the floats still clear the surface before the plane levels.
  const climbSpeed = airborne ? Math.sin(pitch) * speed - sink : 0;
  const y = clamp(state.pose.y + climbSpeed * dt, WATER, 67);
  const travel = Math.cos(pitch) * speed * dt;
  const pose = {
    x: clamp(state.pose.x + Math.sin(yaw) * travel, MIN_X + 4, MAX_X - 4),
    y,
    z: clamp(state.pose.z - Math.cos(yaw) * travel, MIN_Z + 4, MAX_Z - 4),
    pitch,
    yaw,
  };

  const start = state.pose;
  const delta = {
    x: pose.x - start.x,
    y: pose.y - start.y,
    z: pose.z - start.z,
  };
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(delta.x, delta.y, delta.z) / 0.2),
  );
  let clear = start;
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    const point = {
      x: start.x + delta.x * fraction,
      y: start.y + delta.y * fraction,
      z: start.z + delta.z * fraction,
      yaw: start.yaw + (pose.yaw - start.yaw) * fraction,
      pitch: start.pitch + (pose.pitch - start.pitch) * fraction,
    };
    if (!clearOfTerrain(point, obstacles)) {
      if (state.airborne) return { crash: clear };
      const turned = { ...clear, yaw };
      return {
        pose: clearOfTerrain(turned, obstacles) ? turned : clear,
        throttle: 0,
        speed: 0,
        airborne: false,
      };
    }
    clear = point;
  }
  const attitude = wrapAngle(pose.pitch);
  if (state.airborne && y === WATER && Math.abs(attitude) > LANDING_PITCH)
    return { crash: pose };
  return {
    pose: { ...pose, pitch: y > WATER ? attitude : 0 },
    speed,
    throttle,
    airborne: y > WATER,
  };
}
