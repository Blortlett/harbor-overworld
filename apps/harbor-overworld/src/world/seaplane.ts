import { fly, parkedPlane, planeOffset, SEAPLANE_BOARDING } from './flight';
import { type createPlayerMovement, EYE_HEIGHT, type View } from './movement';
import {
  type Color,
  DOCK,
  ground,
  MAX_X,
  MAX_Z,
  Mesh,
  MIN_X,
  MIN_Z,
  type Obstacle,
  WATER,
} from './terrain';
import './seaplane.css';

const CABIN_FLOOR = 0.77;
const BOARDING_RANGE = 3.65;

export function seaplaneMesh() {
  const mesh = new Mesh();
  const yellow: Color = [0.98, 0.65, 0.18];
  const ivory: Color = [0.82, 0.81, 0.68];
  const dark: Color = [0.22, 0.26, 0.24];
  const glass: Color = [0.27, 0.48, 0.5];
  mesh.box(-0.45, CABIN_FLOOR - 0.12, -1.46, 0.9, 0.63, 2.75, ivory);
  mesh.box(-0.36, 0.74, -2.08, 0.72, 0.51, 0.62, yellow);
  mesh.box(-0.31, 0.82, -2.21, 0.62, 0.38, 0.13, dark);
  mesh.box(-0.52, 0.96, -2.28, 1.04, 0.076, 0.06, dark);
  mesh.box(-0.038, 0.47, -2.28, 0.076, 1.06, 0.059, dark);
  mesh.box(-0.1, 0.9, -2.34, 0.2, 0.2, 0.11, yellow);
  mesh.box(-0.38, 1.26, -0.95, 0.76, 0.65, 1.39, yellow);
  mesh.box(-0.32, 1.37, -0.968, 0.64, 0.36, 0.022, glass);
  mesh.box(-0.31, 1.39, 0.433, 0.62, 0.34, 0.02, glass);
  for (const side of [-1, 1]) {
    const wingStart = side < 0 ? -3.27 : 0.3;
    const windowX = side * 0.383 - 0.013;
    for (const z of [-0.81, -0.2])
      mesh.box(windowX, 1.36, z, 0.026, 0.38, 0.49, glass);
    mesh.box(wingStart, 1.87, -0.89, 2.97, 0.15, 1.12, ivory);
    mesh.box(wingStart, 1.89, -0.96, 2.97, 0.11, 0.12, yellow);
    const tip = side < 0 ? -3.31 : 3.03;
    mesh.box(tip, 1.86, -0.89, 0.28, 0.17, 1.12, yellow);
    mesh.box(
      tip + 0.07,
      1.93,
      -0.93,
      0.12,
      0.08,
      0.08,
      side < 0 ? [1, 0.22, 0.17] : [0.28, 0.86, 0.4],
      3,
    );
    const floatX = side * 0.88 - 0.24;
    mesh.box(floatX, -0.12, -1.65, 0.48, 0.35, 3.32, ivory);
    mesh.box(floatX + 0.045, -0.02, -1.88, 0.39, 0.29, 0.24, yellow);
    mesh.box(floatX, 0.23, -1.49, 0.48, 0.08, 3.02, dark);
    for (const z of [-1.05, 0.75]) {
      mesh.box(side < 0 ? -1.03 : 0.39, 0.7, z, 0.64, 0.1, 0.11, dark);
      mesh.box(side * 0.88 - 0.053, 0.28, z, 0.106, 0.53, 0.11, dark);
    }
  }
  mesh.box(-0.24, 0.82, 1.22, 0.48, 0.39, 0.78, ivory);
  mesh.box(-0.16, 0.93, 1.94, 0.32, 0.27, 0.63, yellow);
  mesh.box(-1.12, 1.1, 1.91, 2.24, 0.11, 0.48, ivory);
  mesh.box(-0.057, 1.2, 1.92, 0.114, 0.72, 0.51, yellow);
  mesh.box(-0.059, 1.86, 2.08, 0.118, 0.15, 0.27, ivory);
  return new Float32Array(mesh.vertices);
}

function pitchButton(
  label: string,
  amount: number,
  onPitch: (amount: number) => void,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plate';
  button.textContent = label;
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    onPitch(amount);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    button.addEventListener(name, () => onPitch(0));
  window.addEventListener('blur', () => onPitch(0));
  return button;
}

export function bindSeaplane(
  player: ReturnType<typeof createPlayerMovement>,
  game: HTMLElement,
  canUse: () => boolean,
  onToggle: () => void,
  onPitch: (amount: number) => void,
  announce: (text: string) => void,
) {
  const panel = document.createElement('div');
  panel.className = 'plane-controls';
  panel.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plate';
  button.setAttribute('aria-keyshortcuts', 'G');
  button.addEventListener('click', onToggle);
  const shortcut = document.createElement('kbd');
  shortcut.textContent = 'G';
  const label = document.createElement('span');
  button.append(shortcut, label);
  const hint = document.createElement('span');
  hint.className = 'plane-hint plate';
  hint.textContent = 'W/S throttle · A/D steer · ↑/↓ climb or descend';
  const metrics = document.createElement('span');
  metrics.className = 'plane-metrics plate';
  const touchPitch = document.createElement('div');
  touchPitch.className = 'plane-pitch';
  touchPitch.append(
    pitchButton('Climb', 1, onPitch),
    pitchButton('Descend', -1, onPitch),
  );
  panel.append(button, touchPitch, metrics, hint);
  game.append(panel);

  let flight = parkedPlane();
  let aboard = false;
  let pitch = 0;
  const { view } = player;

  function canBoard() {
    const { x, y, z } = flight.pose;
    return (
      Math.hypot(view.x - x, view.z - z) <= BOARDING_RANGE &&
      Math.abs(view.y - EYE_HEIGHT - y - CABIN_FLOOR) <= 1.2
    );
  }

  function canLeave() {
    return !flight.airborne && flight.speed <= 0.9;
  }

  function reset() {
    if (!aboard) return;
    flight = parkedPlane(flight.airborne ? undefined : flight.pose);
    aboard = false;
    pitch = 0;
  }

  function syncView() {
    const { x, y, z, yaw, pitch } = flight.pose;
    player.reset({ x, z, y: y + CABIN_FLOOR + EYE_HEIGHT, yaw, pitch });
  }

  function leave() {
    const { x, z } = flight.pose;
    const ontoDock = {
      x: Math.max(DOCK.start + 0.25, Math.min(DOCK.end - 0.25, x)),
      z: DOCK.z + Math.sign(z - DOCK.z) * (DOCK.halfWidth - 0.25),
    };
    const exit = [
      ontoDock,
      planeOffset(flight.pose, 1.65, 0),
      planeOffset(flight.pose, -1.65, 0),
    ].find(
      (point) =>
        point.x >= MIN_X &&
        point.x < MAX_X &&
        point.z >= MIN_Z &&
        point.z < MAX_Z &&
        Math.hypot(point.x - x, point.z - z) <= BOARDING_RANGE &&
        ground(point.x, point.z) <= DOCK.deck,
    );
    if (!exit) return false;
    const floor =
      exit === ontoDock
        ? DOCK.deck
        : Math.max(WATER - 0.5, ground(exit.x, exit.z));
    player.reset({ ...view, ...exit, y: floor + EYE_HEIGHT, pitch: 0 });
    reset();
    return true;
  }

  function updatePanel() {
    panel.hidden = !(canUse() && (aboard || canBoard()));
    hint.hidden = !aboard;
    metrics.hidden = !aboard;
    touchPitch.hidden = !aboard;
    button.disabled = aboard && !canLeave();
    const action = !aboard
      ? 'Board seaplane'
      : button.disabled
        ? 'Land and slow to leave'
        : 'Leave seaplane';
    if (label.textContent !== action) label.textContent = action;
    if (aboard) {
      const altitude = Math.round(flight.pose.y - WATER);
      const summary = `Throttle ${Math.round(flight.throttle * 100)}% · Altitude ${altitude}`;
      if (metrics.textContent !== summary) metrics.textContent = summary;
    }
  }

  return {
    get pose() {
      return flight.pose;
    },
    get aboard() {
      return aboard;
    },
    get available() {
      return canUse() && (aboard ? canLeave() : canBoard());
    },
    get status() {
      return {
        ...flight.pose,
        throttle: flight.throttle,
        speed: flight.speed,
        airborne: flight.airborne,
      };
    },
    reset,
    toggle() {
      if (!canUse()) return false;
      if (aboard) return canLeave() && leave();
      if (!canBoard()) return false;
      aboard = true;
      syncView();
      return true;
    },
    pitch(amount: number) {
      if (!aboard) return false;
      pitch = amount;
      return true;
    },
    camera(): View {
      const { y, yaw, pitch } = flight.pose;
      return {
        ...planeOffset(flight.pose, 0, 6.2),
        y: y + 3.55,
        yaw,
        pitch: pitch * 0.6 - 0.31,
      };
    },
    step(
      dt: number,
      input:
        | { forward: number; sideways: number; turn: number; look: number }
        | undefined,
      obstacles: readonly Obstacle[],
    ) {
      updatePanel();
      game.classList.toggle('seaplane-aboard', aboard);
      if (!aboard) return false;
      if (!input) {
        pitch = 0;
        return true;
      }
      const next = fly(
        flight,
        dt,
        {
          forward: input.forward,
          steer: input.sideways + input.turn,
          climb: input.look + pitch,
        },
        obstacles,
      );
      if (!next) {
        reset();
        const { x, z, floor } = SEAPLANE_BOARDING;
        player.reset({ x, z, y: floor + EYE_HEIGHT, yaw: 0, pitch: 0 });
        announce('The seaplane is back at the dock.');
      } else {
        flight = next;
        syncView();
      }
      return true;
    },
  };
}
