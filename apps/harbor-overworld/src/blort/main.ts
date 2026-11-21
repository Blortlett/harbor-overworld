// Entry point for Blort's additions. Loaded by its own <script> tag in
// index.html after the game's main.ts, so the game doesn't import anything
// from here. The inventory itself lives on the server; these Inventory
// objects only mirror what it sends.

import { mountInventoryHud } from './inventory/hud.ts';
import { Inventory } from './inventory/inventory.ts';
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
  });

  inventoryLink.onState((state) => {
    hotbar.replaceAll(state.hotbar);
    backpack.replaceAll(state.backpack);
  });
  inventoryLink.onOnline(hud.setOnline);
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
