import { MAX_X, MAX_Z, MIN_X, MIN_Z } from './terrain.ts';

export const PRESENCE_PATH = '/presence';
export const PRESENCE_INTERVAL = 100;
export const ROOM_CAPACITY = 24;

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
        ? preview.slice(0, 139).join('') + '…'
        : preview.join(''),
  };
}
export type Player = NamedPose & { id: number };

export function displayName(value: unknown) {
  if (typeof value !== 'string') return undefined;
  return (
    Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, 50).join('') ||
    undefined
  );
}

export type PresenceMessage =
  | { type: 'welcome'; id: number; slot: number }
  | { type: 'players'; players: Player[] };

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
