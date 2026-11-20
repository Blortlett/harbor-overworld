import { ground, MAX_X, MAX_Z, MIN_X, MIN_Z } from './terrain.ts';

export const PRESENCE_PATH = '/presence';
export const PRESENCE_INTERVAL = 100;
export const ROOM_CAPACITY = 24;
export const KING_IDENTITY =
  'cc8ce89f64566ee9efce26d559d50dfd1ef63bb787c5e4d57f1473a0e94d6727';
export const OVERWORLD_APPLICATION = 'how.justin.harbor-overworld';

export function kingChallenge(nonce: string) {
  return new TextEncoder().encode(`Harbor Overworld King Mode\n${nonce}`);
}

export type Pose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export type ChatPost = { id: string; text: string };
export type NamedPose = Pose & { name?: string; chat?: ChatPost };

export function readChat(value: unknown): ChatPost | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    !('text' in value)
  )
    return undefined;
  const { id, text } = value;
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{2,400}$/.test(id) ||
    typeof text !== 'string'
  )
    return undefined;
  const preview = Array.from(text.replace(/\s+/gu, ' ').trim());
  return {
    id,
    text:
      preview.length > 140
        ? `${preview.slice(0, 139).join('')}…`
        : preview.join(''),
  };
}
export type Player = NamedPose & { id: number; king?: true };

export function displayName(value: unknown) {
  if (typeof value !== 'string') return undefined;
  return (
    Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, 50).join('') ||
    undefined
  );
}

export type PlotSnapshot = { type: 'plots'; day: string; papers: string[] };
export type PostLocation = { x: number; z: number };
export type PlacedPost = PostLocation & {
  id: string;
  paper: string;
  landedAt: number;
};
export type Placement = PostLocation & {
  type: 'place';
  id: string;
  proof: string;
};
export type PlacementUpdate = {
  type: 'placements';
  day: string;
  posts: PlacedPost[];
  live?: boolean;
};

export type PresenceMessage =
  | PlotSnapshot
  | PlacementUpdate
  | { type: 'welcome'; id: number; slot: number; nonce: string }
  | { type: 'king'; enabled: boolean }
  | { type: 'players'; players: Player[] };

const resetClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  hourCycle: 'h23',
});

export function plotDay(time: number) {
  const parts = resetClock.formatToParts(time);
  const value = (key: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(({ type }) => type === key)?.value);
  return new Date(
    Date.UTC(
      value('year'),
      value('month') - 1,
      value('day') - Number(value('hour') < 3),
    ),
  )
    .toISOString()
    .slice(0, 10);
}

export function placementChallenge(id: string, x: number, z: number) {
  return new TextEncoder().encode(
    `Harbor Overworld post location\n${JSON.stringify([id, x, z])}`,
  );
}

export function isProof(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{128}$/.test(value);
}

function isPostLocation(
  value: unknown,
): value is PostLocation & { id: string } {
  if (!value || typeof value !== 'object') return false;
  const { id, x, z } = value as Partial<Placement>;
  return (
    typeof id === 'string' &&
    /^(?:[a-f0-9]{2}){1,200}$/.test(id) &&
    typeof x === 'number' &&
    x >= MIN_X &&
    x < MAX_X &&
    typeof z === 'number' &&
    z >= MIN_Z &&
    z < MAX_Z &&
    ground(x, z) >= 2
  );
}

export function isPlacement(value: unknown): value is Placement {
  return (
    isPostLocation(value) &&
    'type' in value &&
    value.type === 'place' &&
    'proof' in value &&
    isProof(value.proof)
  );
}

export function isPlacedPost(value: unknown): value is PlacedPost {
  if (!isPostLocation(value)) return false;
  const { paper, landedAt } = value as Partial<PlacedPost>;
  return (
    typeof paper === 'string' &&
    paper.length > 0 &&
    paper.length <= 16 * 1024 &&
    typeof landedAt === 'number' &&
    Number.isFinite(landedAt)
  );
}

export function parseMessage(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isPose(value: unknown): value is Pose {
  if (!value || typeof value !== 'object') return false;
  const { x, y, z, yaw } = value as Partial<Pose>;
  return (
    typeof x === 'number' &&
    x >= MIN_X &&
    x < MAX_X &&
    typeof y === 'number' &&
    y >= 0 &&
    y <= 80 &&
    typeof z === 'number' &&
    z >= MIN_Z &&
    z < MAX_Z &&
    typeof yaw === 'number' &&
    Math.abs(yaw) <= Math.PI
  );
}
