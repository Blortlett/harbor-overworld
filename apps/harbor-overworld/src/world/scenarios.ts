import {
  type CollisionScene,
  type createPlayerMovement,
  EYE_HEIGHT,
} from './movement.ts';
import { ground, STATIONS } from './terrain.ts';

type Segment = {
  frames: number;
  forward?: number;
  sideways?: number;
  jump?: boolean;
};
type Scenario = {
  label: string;
  x: number;
  z: number;
  stations?: number;
  king?: boolean;
  segments: readonly Segment[];
};

const [boardX, boardZ] = STATIONS[0];

export const scenarios = {
  noticeboard: {
    label: 'Read a noticeboard',
    x: boardX,
    z: boardZ + 2.5,
    stations: 1,
    segments: [],
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

export function scenarioView({ x, z }: Scenario) {
  return { x, y: ground(x, z) + EYE_HEIGHT, z, yaw: 0, pitch: 0 };
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
        },
        scene,
      );
      yield { ...player.view };
    }
  }
}
