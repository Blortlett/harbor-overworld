import { spawnView } from './movement.ts';
import {
  CROWN_DURATION,
  type CrownLocation,
  ROOM_CAPACITY,
} from './presence-protocol.ts';
import {
  ground,
  LIGHTHOUSE,
  ISLAND_BOUNDS,
  SPAWN,
  STATIONS,
  trailDistance,
  WATER,
} from './terrain.ts';

type CrownPlayer = CrownLocation & { id: number; y: number };
type CrownState =
  | { location: CrownLocation }
  | { holder: number; expiresAt: number };

const sites: CrownLocation[] = [];
const roomSpawns = Array.from({ length: ROOM_CAPACITY }, (_, slot) =>
  spawnView(slot),
);
const { minX, maxX, minZ, maxZ } = ISLAND_BOUNDS;
for (let z = minZ + 0.5; z < maxZ; z++) {
  for (let x = minX + 0.5; x < maxX; x++) {
    if (
      ground(x, z) > WATER &&
      trailDistance(x, z) <= 0.5 &&
      Math.hypot(x - SPAWN.x, z - SPAWN.z) > 4 &&
      Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) > 3.5 &&
      STATIONS.every(([sx, sz]) => Math.hypot(x - sx, z - sz) > 2.5) &&
      roomSpawns.every((spawn) => Math.hypot(x - spawn.x, z - spawn.z) > 1.5)
    )
      sites.push({ x, z });
  }
}

export function createCrown(practiceSites?: readonly CrownLocation[]) {
  const candidates = practiceSites ?? sites;
  let last =
    practiceSites?.[0] ?? sites[Math.floor(Math.random() * sites.length)];
  let state: CrownState = { location: last };

  function respawn(players: readonly CrownPlayer[]) {
    const elsewhere = candidates.filter(
      ({ x, z }) => Math.hypot(x - last.x, z - last.z) > 4,
    );
    const clear = elsewhere.filter(({ x, z }) =>
      players.every((p) => Math.hypot(x - p.x, z - p.z) > 2),
    );
    const available = clear.length ? clear : elsewhere;
    last = available[Math.floor(Math.random() * available.length)];
    state = { location: last };
  }

  return {
    get state() {
      return state;
    },
    release(id: number, players: readonly CrownPlayer[]) {
      if ('holder' in state && state.holder === id) respawn(players);
    },
    update(now: number, players: readonly CrownPlayer[]) {
      if ('holder' in state) {
        if (now >= state.expiresAt) respawn(players);
        return;
      }
      const { x, z } = state.location;
      const y = ground(x, z);
      const collector = players.find(
        (p) =>
          Math.hypot(p.x - x, p.z - z) <= 0.85 && Math.abs(p.y - y) <= 0.75,
      );
      if (collector)
        state = { holder: collector.id, expiresAt: now + CROWN_DURATION };
    },
  };
}
