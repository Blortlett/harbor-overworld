import { SEAPLANE_BOARDING } from './flight.ts';
import {
  type CollisionScene,
  type createPlayerMovement,
  EYE_HEIGHT,
} from './movement.ts';
import { DOCK, ground, SOUTH_ARCH, SPAWN, STATIONS } from './terrain.ts';

type Segment = {
  frames: number;
  forward?: number;
  sideways?: number;
  jump?: boolean;
  ascend?: boolean;
  sprint?: boolean;
};
type Scenario = {
  label: string;
  x: number;
  z: number;
  floor?: number;
  yaw?: number;
  stations?: number;
  king?: boolean;
  segments: readonly Segment[];
};

const [boardX, boardZ] = STATIONS[0];

export const scenarios = {
  shooting: {
    label: 'Practice King Mode',
    ...SPAWN,
    segments: [],
  },
  dock: {
    label: 'Visit the harbor dock',
    x: DOCK.start - 0.5,
    z: DOCK.z,
    yaw: Math.PI / 2,
    segments: [],
  },
  seaplane: {
    label: 'Fly the harbor seaplane',
    ...SEAPLANE_BOARDING,
    segments: [],
  },
  noticeboard: {
    label: 'Read a noticeboard',
    x: boardX,
    z: boardZ + 2.5,
    stations: 1,
    segments: [],
  },
  'south-arch': {
    label: 'Walk through the southern stone arch',
    x: SOUTH_ARCH.x,
    z: SOUTH_ARCH.z - 3,
    yaw: Math.PI,
    segments: [{ frames: 90, forward: 1 }],
  },
  'open-water': {
    label: 'Explore far offshore',
    x: 300,
    z: -300,
    yaw: Math.PI / 2,
    segments: [{ frames: 60, forward: 1 }],
  },
  shoreline: {
    label: 'Shoreline round trip',
    x: 6.5,
    z: 17.5,
    segments: [
      { frames: 120, sideways: 1 },
      { frames: 120, sideways: -1 },
    ],
  },
  ledge: {
    label: 'Back away from a steep ledge',
    x: -73.04,
    z: -96.5,
    segments: [{ frames: 4, sideways: -1 }],
  },
  'ledge-drop': {
    label: 'Walk off a three-block ledge',
    x: -70.5,
    z: -93.5,
    segments: [{ frames: 13, sideways: 1 }, { frames: 42 }],
  },
  'king-ascent': {
    label: 'Hold King ascent, then release',
    ...SPAWN,
    king: true,
    segments: [{ frames: 120, ascend: true }, { frames: 100 }],
  },
  sprint: {
    label: 'Sprint toward the noticeboard',
    x: boardX,
    z: boardZ + 5,
    stations: 1,
    segments: [{ frames: 90, forward: 1, sprint: true }],
  },
  tree: {
    label: 'Escape a tree and walk back into it',
    x: -5.5,
    z: 0.5,
    segments: [
      { frames: 12, sideways: -1 },
      { frames: 24, sideways: 1 },
    ],
  },
  board: {
    label: 'Walk out of an overlapping noticeboard',
    x: boardX,
    z: boardZ,
    stations: 1,
    segments: [{ frames: 12, forward: 1 }],
  },
  'king-jump': {
    label: 'Jump over the noticeboard as King',
    x: boardX,
    z: boardZ + 0.5,
    stations: 1,
    king: true,
    segments: [
      { frames: 12, forward: 1 },
      { frames: 20, jump: true },
      { frames: 20, jump: true },
      { frames: 24, jump: true, forward: 1 },
      { frames: 60, forward: 1 },
    ],
  },
  lighthouse: {
    label: 'Jump over the lighthouse base as King',
    x: 26.5,
    z: -35,
    king: true,
    segments: [
      { frames: 12, forward: 1 },
      { frames: 21, jump: true },
      { frames: 21, jump: true },
      { frames: 21, jump: true },
      { frames: 21, jump: true },
      { frames: 21, jump: true },
      { frames: 21, jump: true },
      { frames: 24, jump: true, forward: 1 },
      { frames: 30, forward: 1 },
    ],
  },
} satisfies Record<string, Scenario>;

export function scenarioByName(name: string): Scenario | undefined {
  return Object.hasOwn(scenarios, name)
    ? scenarios[name as keyof typeof scenarios]
    : undefined;
}

export function scenarioView({
  x,
  z,
  floor = ground(x, z),
  yaw = 0,
}: Scenario) {
  return { x, y: floor + EYE_HEIGHT, z, yaw, pitch: 0 };
}

export function* replayScenario(
  player: ReturnType<typeof createPlayerMovement>,
  scenario: Scenario,
  scene: CollisionScene,
  startTime = 0,
) {
  const dt = 1 / 60;
  let frame = 0;
  for (const segment of scenario.segments) {
    if (segment.jump)
      player.jump(startTime + frame * dt * 1000, !!scenario.king);
    for (let i = 0; i < segment.frames; i++) {
      player.step(
        startTime + ++frame * dt * 1000,
        dt,
        {
          forward: segment.forward ?? 0,
          sideways: segment.sideways ?? 0,
          ascend: scenario.king && segment.ascend,
          sprint: segment.sprint,
        },
        scene,
      );
      yield { ...player.view };
    }
  }
}
