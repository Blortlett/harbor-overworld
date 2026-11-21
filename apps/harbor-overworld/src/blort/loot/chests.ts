// Chests in the browser: draws every container the server lists, swings lids
// open while someone is looking inside, and lists each chest as something E
// can use. The server decides what's inside; this only asks.

import {
  currentPlayerPose,
  type Prop,
  setPropSource,
} from '../../world/bridge.ts';
import type { ContainerPlacement } from '../inventory/protocol.ts';
import {
  CHEST_HINGE,
  CHEST_OPEN_ANGLE,
  chestBodyMesh,
  chestLidMesh,
} from './chest-mesh.ts';
import { addInteractables } from '../interact.ts';
import { withinReach } from './containers.ts';

/** Radians per second the lid swings. */
const LID_SPEED = 7;

type ChestOptions = {
  /** The chest this tab has open, if any. */
  openHere: () => string | null;
  /** The player pressed E at this chest. */
  onOpen: (id: string) => void;
  /** The open chest is out of reach now. */
  onLeave: () => void;
};

export function mountChests({ openHere, onOpen, onLeave }: ChestOptions) {
  const body = chestBodyMesh();
  const lid = chestLidMesh();
  let placements: ContainerPlacement[] = [];
  const lidAngles = new Map<string, number>();
  let last = performance.now();

  function props(): Prop[] {
    const now = performance.now();
    const step = Math.min(0.1, (now - last) / 1000) * LID_SPEED;
    last = now;
    return placements.flatMap((chest) => {
      const target =
        chest.open || openHere() === chest.id ? CHEST_OPEN_ANGLE : 0;
      const current = lidAngles.get(chest.id) ?? 0;
      const angle =
        current < target
          ? Math.min(target, current + step)
          : Math.max(target, current - step);
      lidAngles.set(chest.id, angle);
      const sin = Math.sin(chest.yaw);
      const cos = Math.cos(chest.yaw);
      return [
        { vertices: body, x: chest.x, y: chest.y, z: chest.z, yaw: chest.yaw },
        {
          vertices: lid,
          x: chest.x - sin * CHEST_HINGE.z,
          y: chest.y + CHEST_HINGE.y,
          z: chest.z + cos * CHEST_HINGE.z,
          yaw: chest.yaw,
          pitch: angle,
        },
      ];
    });
  }
  setPropSource(props);

  addInteractables(() =>
    placements.map((chest) => ({
      id: chest.id,
      x: chest.x,
      z: chest.z,
      inReach: (feet) => withinReach(chest, feet),
      interact: () => onOpen(chest.id),
    })),
  );

  // Close the panel if we end up out of reach, e.g. respawned elsewhere.
  function tick() {
    requestAnimationFrame(tick);
    const open = openHere();
    if (!open) return;
    const chest = placements.find((c) => c.id === open);
    const feet = currentPlayerPose();
    if (!chest || !feet || !withinReach(chest, feet)) onLeave();
  }
  requestAnimationFrame(tick);

  return {
    setPlacements(next: ContainerPlacement[]) {
      placements = next;
    },
  };
}
