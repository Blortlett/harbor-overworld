// Entry point for Blort's additions. Loaded by its own <script> tag in
// index.html after the game's main.ts, so the game doesn't import anything
// from here.

import { mountInventoryHud } from './inventory/hud.ts';
import { Inventory } from './inventory/inventory.ts';

const HOTBAR_SLOTS = 6;
const BACKPACK_COLUMNS = 6;
const BACKPACK_ROWS = 4;

const game = document.getElementById('overworld');
const world = document.getElementById('world');

if (game && world instanceof HTMLCanvasElement) {
  const hotbar = new Inventory(HOTBAR_SLOTS);
  const backpack = new Inventory(BACKPACK_COLUMNS * BACKPACK_ROWS);

  // Starter kit until the world has pickups. Resets on reload.
  hotbar.addItem('lantern', 1);
  hotbar.addItem('rope', 3);
  backpack.addItem('driftwood', 26);
  backpack.addItem('rope', 6);

  const hud = mountInventoryHud({
    game,
    world,
    hotbar,
    backpack,
    backpackColumns: BACKPACK_COLUMNS,
  });

  // Handy from the browser console while developing:
  // blortInventory.backpack.addItem('rope', 5)
  if (import.meta.env.DEV)
    Object.assign(window, { blortInventory: { hotbar, backpack, hud } });
}
