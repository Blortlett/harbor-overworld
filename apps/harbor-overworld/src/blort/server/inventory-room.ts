// Server-side inventories, keyed by each browser's player key. The presence
// server hands us every inventory message from its sockets (see the hook in
// server/presence.ts); everything else about inventories lives here.

import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Inventory, moveSlot } from '../inventory/inventory.ts';
import {
  BACKPACK_SLOTS,
  type Bag,
  HOTBAR_SLOTS,
  type InventoryState,
  isInventoryMessage,
  PLAYER_KEY_PATTERN,
  readRequest,
  readSlots,
} from '../inventory/protocol.ts';

/** The part of a WebSocket the room uses. */
export type InventorySocket = { send(data: string): void };

type Bags = Record<Bag, Inventory>;
type Player = { bags: Bags; sockets: Set<InventorySocket>; saved: boolean };
type Connection = { key?: string; windowStart: number; count: number };

export type InventoryRoomOptions = {
  /** JSON file to load from and save to. Memory only when unset. */
  file?: string;
  /** Accept 'grant' requests. Playground only. */
  allowGrants?: boolean;
  /** Most inventories kept in the save file. Later keys aren't saved. */
  maxSaved?: number;
  saveDelayMs?: number;
  messagesPerSecond?: number;
  now?: () => number;
};

export const STARTER_KIT: { bag: Bag; itemId: string; quantity: number }[] = [
  { bag: 'hotbar', itemId: 'lantern', quantity: 1 },
  { bag: 'hotbar', itemId: 'rope', quantity: 3 },
  { bag: 'backpack', itemId: 'driftwood', quantity: 26 },
  { bag: 'backpack', itemId: 'rope', quantity: 6 },
];

function newBags(): Bags {
  return {
    hotbar: new Inventory(HOTBAR_SLOTS),
    backpack: new Inventory(BACKPACK_SLOTS),
  };
}

function loadFile(file: string | undefined) {
  const players = new Map<string, Bags>();
  if (!file) return players;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return players; // Missing or unreadable: start fresh.
  }
  const saved =
    data && typeof data === 'object' && 'players' in data
      ? (data.players as Record<string, unknown>)
      : undefined;
  if (!saved || typeof saved !== 'object') return players;
  for (const [key, value] of Object.entries(saved)) {
    if (!PLAYER_KEY_PATTERN.test(key) || !value || typeof value !== 'object')
      continue;
    const hotbar = readSlots(
      (value as Record<string, unknown>).hotbar,
      HOTBAR_SLOTS,
    );
    const backpack = readSlots(
      (value as Record<string, unknown>).backpack,
      BACKPACK_SLOTS,
    );
    if (!hotbar || !backpack) continue;
    const bags = newBags();
    bags.hotbar.replaceAll(hotbar);
    bags.backpack.replaceAll(backpack);
    players.set(key, bags);
  }
  return players;
}

export function createInventoryRoom({
  file,
  allowGrants = false,
  maxSaved = 10_000,
  saveDelayMs = 1000,
  messagesPerSecond = 20,
  now = Date.now,
}: InventoryRoomOptions = {}) {
  const players = new Map<string, Player>();
  for (const [key, bags] of loadFile(file))
    players.set(key, { bags, sockets: new Set(), saved: true });
  let savedCount = players.size;
  const connections = new Map<InventorySocket, Connection>();

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving = Promise.resolve();

  function state({ bags }: Player): string {
    const message: InventoryState = {
      type: 'blort-inventory',
      hotbar: bags.hotbar.snapshot(),
      backpack: bags.backpack.snapshot(),
    };
    return JSON.stringify(message);
  }

  function send(socket: InventorySocket, data: string) {
    try {
      socket.send(data);
    } catch {
      // A closing socket; presence will tell us when it's gone.
    }
  }

  function publish(player: Player) {
    const data = state(player);
    for (const socket of player.sockets) send(socket, data);
  }

  function write() {
    if (!file) return Promise.resolve();
    const target = file;
    const saved: Record<string, { hotbar: unknown; backpack: unknown }> = {};
    for (const [key, { bags, saved: keep }] of players) {
      if (keep)
        saved[key] = {
          hotbar: bags.hotbar.snapshot(),
          backpack: bags.backpack.snapshot(),
        };
    }
    const temp = `${target}.tmp`;
    saving = saving
      .then(async () => {
        await writeFile(temp, JSON.stringify({ version: 1, players: saved }));
        await rename(temp, target);
      })
      .catch((error) => console.error('Inventory save failed', error));
    return saving;
  }

  function scheduleSave(player: Player) {
    if (!file || !player.saved || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void write();
    }, saveDelayMs);
    saveTimer.unref?.();
  }

  function playerFor(key: string): Player {
    let player = players.get(key);
    if (player) return player;
    const bags = newBags();
    for (const { bag, itemId, quantity } of STARTER_KIT)
      bags[bag].addItem(itemId, quantity);
    const saved = savedCount < maxSaved;
    if (saved) savedCount++;
    player = { bags, sockets: new Set(), saved };
    players.set(key, player);
    scheduleSave(player);
    return player;
  }

  function detach(socket: InventorySocket, connection: Connection) {
    const { key } = connection;
    if (!key) return;
    connection.key = undefined;
    const player = players.get(key);
    if (!player) return;
    player.sockets.delete(socket);
    // Unsaved inventories only live while someone is using them.
    if (!player.saved && !player.sockets.size) players.delete(key);
  }

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      await write();
    }
    await saving;
  }

  return {
    /**
     * Handles one parsed presence message. Returns true when it was an
     * inventory message (valid or not), so presence can stop handling it.
     */
    receive(socket: InventorySocket, message: unknown): boolean {
      if (!isInventoryMessage(message)) return false;
      let connection = connections.get(socket);
      if (!connection) {
        connection = { windowStart: now(), count: 0 };
        connections.set(socket, connection);
      }
      const time = now();
      if (time - connection.windowStart >= 1000) {
        connection.windowStart = time;
        connection.count = 0;
      }
      if (++connection.count > messagesPerSecond) return true;

      const request = readRequest(message);
      if (!request) return true;

      if (request.type === 'blort-inventory-hello') {
        detach(socket, connection);
        const player = playerFor(request.key);
        connection.key = request.key;
        player.sockets.add(socket);
        send(socket, state(player));
        return true;
      }

      const player = connection.key ? players.get(connection.key) : undefined;
      if (!player) return true;

      if (request.type === 'blort-inventory-move') {
        const { from, to } = request;
        if (
          moveSlot(
            player.bags[from.bag],
            from.index,
            player.bags[to.bag],
            to.index,
          )
        ) {
          publish(player);
          scheduleSave(player);
        } else {
          send(socket, state(player));
        }
        return true;
      }

      if (request.type === 'blort-inventory-grant') {
        if (!allowGrants) return true;
        const left = player.bags.hotbar.addItem(
          request.itemId,
          request.quantity,
        );
        player.bags.backpack.addItem(request.itemId, left);
        publish(player);
        scheduleSave(player);
      }
      return true;
    },

    /** Forget a socket once presence has closed it. */
    disconnect(socket: InventorySocket) {
      const connection = connections.get(socket);
      if (!connection) return;
      detach(socket, connection);
      connections.delete(socket);
    },

    /** Write any pending changes now. */
    flush,

    /** Stop the room, saving whatever is pending. */
    close: flush,
  };
}

export type InventoryRoom = ReturnType<typeof createInventoryRoom>;

/**
 * The room as server/presence.ts creates it. Saves beside the plots file
 * (or to BLORT_INVENTORY_FILE) when presence has one, which the standalone
 * server always does. Vite's dev servers have none, so they keep inventories
 * in memory. Grants follow presence's playground (practice) flag.
 */
export function inventoryRoomForPresence(plotsFile?: string, practice = false) {
  const file =
    process.env.BLORT_INVENTORY_FILE ||
    (plotsFile
      ? join(dirname(plotsFile), 'blort-inventories.json')
      : undefined);
  return createInventoryRoom({ file, allowGrants: practice });
}
