import { type createPlayerMovement, EYE_HEIGHT } from './movement';
import {
  DOCK,
  ground,
  MAX_X,
  MAX_Z,
  Mesh,
  MIN_X,
  MIN_Z,
  WATER,
} from './terrain';
import './boat.css';

export type BoatPose = { x: number; z: number; yaw: number };

const BOAT_BERTH: BoatPose = {
  x: 13.5,
  z: DOCK.z + DOCK.halfWidth + 1.3,
  yaw: Math.PI / 2,
};
const DECK_HEIGHT = WATER + 0.29;
const BOARDING_RANGE = 2.6;
const HULL_HALF_WIDTH = 0.72;
const HULL_BOW = -1.65;
const HULL_STERN = 1.2;

export function boatMesh() {
  const mesh = new Mesh();
  for (const [z, width, length] of [
    [HULL_BOW, 0.42, 0.32],
    [-1.33, 0.92, 0.35],
    [-0.98, HULL_HALF_WIDTH * 2, HULL_STERN + 0.98],
  ]) {
    mesh.box(-width / 2, -0.12, z, width, 0.32, length, [0.11, 0.29, 0.32]);
    mesh.box(-width / 2, 0.2, z, width, 0.09, length, [0.85, 0.74, 0.51]);
  }
  const gunwale = [0.15, 0.36, 0.37] as const;
  for (const x of [-HULL_HALF_WIDTH, HULL_HALF_WIDTH - 0.12]) {
    mesh.box(x, 0.29, -0.98, 0.12, 0.24, 2.18, gunwale);
    mesh.box(x - 0.025, 0.49, -0.98, 0.17, 0.055, 2.18, [0.8, 0.67, 0.4]);
  }
  mesh.box(-0.46, 0.29, -1.33, 0.92, 0.26, 0.35, gunwale);
  mesh.box(-0.21, 0.29, HULL_BOW, 0.42, 0.32, 0.32, gunwale);
  mesh.box(
    -HULL_HALF_WIDTH,
    0.29,
    HULL_STERN - 0.17,
    1.44,
    0.23,
    0.17,
    gunwale,
  );
  for (let i = 0; i < 6; i++) {
    mesh.box(
      -0.6,
      0.29,
      -0.97 + i * 0.33,
      1.2,
      0.035,
      0.318,
      [0.56, 0.39, 0.23],
    );
  }
  mesh.box(-0.57, 0.33, 0.51, 1.14, 0.17, 0.26, [0.37, 0.24, 0.15]);
  mesh.box(0.22, 0.325, -0.74, 0.32, 0.49, 0.31, [0.68, 0.57, 0.36]);
  mesh.box(0.2, 0.75, -0.72, 0.37, 0.07, 0.34, [0.19, 0.24, 0.22]);
  mesh.box(-0.19, 0.09, HULL_STERN, 0.38, 0.51, 0.25, [0.22, 0.26, 0.25]);
  mesh.box(
    -0.12,
    0.55,
    HULL_STERN - 0.025,
    0.24,
    0.035,
    0.06,
    [0.76, 0.2, 0.14],
    3,
  );
  return new Float32Array(mesh.vertices);
}

function offset({ x, z, yaw }: BoatPose, right: number, back: number) {
  return {
    x: x + Math.cos(yaw) * right - Math.sin(yaw) * back,
    z: z + Math.sin(yaw) * right + Math.cos(yaw) * back,
  };
}

function onDock(x: number, z: number) {
  return (
    x >= DOCK.start && x <= DOCK.end && Math.abs(z - DOCK.z) < DOCK.halfWidth
  );
}

function inWorld(x: number, z: number) {
  return x >= MIN_X && x < MAX_X && z >= MIN_Z && z < MAX_Z;
}

function canFloat(pose: BoatPose) {
  for (const [right, back] of [
    [0, HULL_BOW],
    [-HULL_HALF_WIDTH, -0.98],
    [HULL_HALF_WIDTH, -0.98],
    [-HULL_HALF_WIDTH, 0],
    [0, 0],
    [HULL_HALF_WIDTH, 0],
    [-HULL_HALF_WIDTH, HULL_STERN],
    [HULL_HALF_WIDTH, HULL_STERN],
  ]) {
    const { x, z } = offset(pose, right, back);
    if (!inWorld(x, z) || onDock(x, z) || ground(x, z) >= WATER) return false;
  }
  return true;
}

export function bindBoat(
  player: ReturnType<typeof createPlayerMovement>,
  game: HTMLElement,
  canUse: () => boolean,
  onToggle: () => void,
) {
  const panel = document.createElement('div');
  panel.className = 'boat-controls';
  panel.hidden = true;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'plate';
  action.setAttribute('aria-keyshortcuts', 'F');
  const shortcut = document.createElement('kbd');
  shortcut.textContent = 'F';
  const label = document.createElement('span');
  label.textContent = 'Board boat';
  action.append(shortcut, label);
  action.addEventListener('click', onToggle);
  const hint = document.createElement('span');
  hint.className = 'boat-hint plate';
  hint.textContent = 'W accelerate · S reverse · A/D steer';
  hint.hidden = true;
  panel.append(action, hint);
  game.append(panel);

  const { view } = player;
  let pose = { ...BOAT_BERTH };
  let speed = 0;
  let aboard = false;

  function canBoard() {
    return (
      Math.hypot(view.x - pose.x, view.z - pose.z) <= BOARDING_RANGE &&
      Math.abs(view.y - EYE_HEIGHT - DECK_HEIGHT) <= 1.15
    );
  }

  function reset() {
    aboard = false;
    speed = 0;
  }

  function syncView(yaw: number) {
    player.reset({
      ...view,
      x: pose.x,
      z: pose.z,
      y: DECK_HEIGHT + EYE_HEIGHT,
      yaw,
    });
  }

  function leave() {
    const exit = [
      {
        x: Math.max(DOCK.start + 0.26, Math.min(DOCK.end - 0.26, pose.x)),
        z: DOCK.z + Math.sign(pose.z - DOCK.z) * (DOCK.halfWidth - 0.26),
      },
      offset(pose, 1.4, 0),
      offset(pose, -1.4, 0),
      offset(pose, 0, HULL_STERN + 0.55),
    ].find(
      ({ x, z }) =>
        inWorld(x, z) &&
        Math.hypot(x - pose.x, z - pose.z) <= BOARDING_RANGE &&
        ground(x, z) <= DECK_HEIGHT + 0.75,
    );
    if (!exit) return false;
    const floor = Math.max(
      ground(exit.x, exit.z),
      onDock(exit.x, exit.z) ? DOCK.deck : WATER - 0.5,
    );
    player.reset({ ...view, ...exit, y: floor + EYE_HEIGHT });
    reset();
    return true;
  }

  return {
    get pose() {
      return pose;
    },
    get aboard() {
      return aboard;
    },
    get available() {
      return canUse() && (aboard || canBoard());
    },
    reset,
    toggle() {
      if (!canUse()) return false;
      if (aboard) return leave();
      if (!canBoard()) return false;
      aboard = true;
      syncView(pose.yaw);
      return true;
    },
    step(
      dt: number,
      input:
        | { forward: number; sideways: number; turn: number; look: number }
        | undefined,
    ) {
      panel.hidden = !(canUse() && (aboard || canBoard()));
      hint.hidden = !aboard;
      const actionLabel = aboard ? 'Leave boat' : 'Board boat';
      if (label.textContent !== actionLabel) label.textContent = actionLabel;
      if (!aboard) return false;
      if (!input) return true;

      const throttle = Math.max(-1, Math.min(1, input.forward));
      const steering = Math.max(-1, Math.min(1, input.sideways + input.turn));
      speed = throttle
        ? speed + throttle * (throttle < 0 ? 12 : 9) * dt
        : speed * Math.exp(-2 * dt);
      const turn = steering * dt * 1.75;
      const yaw = pose.yaw + turn;
      const steps = Math.max(1, Math.ceil((Math.abs(speed) * dt) / 0.2));
      const stride = (speed * dt) / steps;
      const dx = Math.sin(yaw) * stride;
      const dz = -Math.cos(yaw) * stride;
      const previousYaw = pose.yaw;
      for (let step = 0; step < steps; step++) {
        const next = { x: pose.x + dx, z: pose.z + dz, yaw };
        if (!canFloat(next)) {
          speed = 0;
          if (canFloat({ ...pose, yaw })) pose = { ...pose, yaw };
          break;
        }
        pose = next;
      }
      player.look(0, input.look * dt);
      syncView(view.yaw + pose.yaw - previousYaw);
      return true;
    },
  };
}
