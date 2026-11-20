import { ground, STATIONS, WATER } from './terrain.ts';

export const DROP_DURATION = 1.2;
export const DROP_HEIGHT = 1.75;
export const DROP_HALF_WIDTH = 1.25;
export const DROP_BASE = 0.025;
export const POST_MARK_LIMIT = 96;
export const MARKS_PER_FACE = 12;

type MarkPosition = { u: number; v: number };
export type PostMark = MarkPosition &
  (
    | { kind: 'board'; day: string; station: number; side: 1 | -1 }
    | { kind: 'drop'; id: string }
  );

export function isPostMark(value: unknown): value is PostMark {
  if (!value || typeof value !== 'object') return false;
  const mark = value as Partial<PostMark>;
  if (
    typeof mark.u !== 'number' ||
    !(mark.u >= 0 && mark.u <= 1) ||
    typeof mark.v !== 'number' ||
    !(mark.v >= 0 && mark.v <= 1)
  )
    return false;
  if (mark.kind === 'board') {
    return (
      typeof mark.day === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(mark.day) &&
      typeof mark.station === 'number' &&
      Number.isInteger(mark.station) &&
      mark.station >= 0 &&
      mark.station < STATIONS.length &&
      (mark.side === 1 || mark.side === -1)
    );
  }
  return (
    mark.kind === 'drop' &&
    typeof mark.id === 'string' &&
    /^(?:[a-f0-9]{2}){1,200}$/.test(mark.id)
  );
}

export function nextDropFloor(
  x: number,
  z: number,
  posts: Iterable<{ x: number; z: number; floor?: number }>,
) {
  let y = Math.max(WATER, ground(x, z));
  for (const post of posts) {
    if (post.x === x && post.z === z)
      y = Math.max(y, (post.floor ?? y) + DROP_HEIGHT + 0.08);
  }
  return y;
}
