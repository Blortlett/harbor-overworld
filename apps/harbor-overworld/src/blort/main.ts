// Entry point for Blort's additions. Loaded by its own <script> tag in
// index.html after the game's main.ts, so the game doesn't import anything
// from here. The inventory itself lives on the server; these Inventory
// objects only mirror what it sends.

import { mountInventoryHud } from './inventory/hud.ts';
import { setArmed } from '../world/held-item.ts';
import { Inventory } from './inventory/inventory.ts';
import { GUN_ITEM_ID } from './inventory/items.ts';
import { inventoryLink } from './inventory/link.ts';
import {
  BACKPACK_COLUMNS,
  BACKPACK_SLOTS,
  HOTBAR_SLOTS,
} from './inventory/protocol.ts';

const game = document.getElementById('overworld');
const world = document.getElementById('world');

if (game && world instanceof HTMLCanvasElement) {
  const hotbar = new Inventory(HOTBAR_SLOTS);
  const backpack = new Inventory(BACKPACK_SLOTS);

  const hud = mountInventoryHud({
    game,
    world,
    hotbar,
    backpack,
    backpackColumns: BACKPACK_COLUMNS,
    onMove: (from, to) => inventoryLink.move(from, to),
    // The gun's key draws it; pressing it again, or any other slot's key,
    // holsters it. The server decides and replies with what's held.
    onHotbarKey: (index) => {
      if (!inventoryLink.online) return;
      if (held === index) inventoryLink.equip(null);
      else if (hotbar.getSlot(index)?.itemId === GUN_ITEM_ID)
        inventoryLink.equip(index);
      else if (held !== null) inventoryLink.equip(null);
    },
  });

  let held: number | null = null;
  function setHeld(next: number | null) {
    held = next;
    hud.setHeld(held);
    setArmed(held !== null);
  }

  inventoryLink.onState((state) => {
    hotbar.replaceAll(state.hotbar);
    backpack.replaceAll(state.backpack);
    setHeld(state.held);
  });
  inventoryLink.onOnline((online) => {
    hud.setOnline(online);
    if (!online) setHeld(null);
  });
  hud.setOnline(inventoryLink.online);

  // From the browser console while developing. grant only works in the
  // playground, where the server allows it: blortInventory.grant('rope', 5)
  if (import.meta.env.DEV)
    Object.assign(window, {
      blortInventory: {
        hotbar,
        backpack,
        hud,
        grant: inventoryLink.grant,
      },
    });
}
