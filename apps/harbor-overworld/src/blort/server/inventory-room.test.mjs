import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInventoryRoom, STARTER_KIT } from './inventory-room.ts';

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

function socket() {
  const sent = [];
  return {
    sent,
    send(data) {
      sent.push(JSON.parse(data));
    },
    get last() {
      return sent.at(-1);
    },
  };
}

const hello = (key) => ({ type: 'blort-inventory-hello', key });
const move = (fromBag, fromIndex, toBag, toIndex) => ({
  type: 'blort-inventory-move',
  from: { bag: fromBag, index: fromIndex },
  to: { bag: toBag, index: toIndex },
});
const grant = (itemId, quantity) => ({
  type: 'blort-inventory-grant',
  itemId,
  quantity,
});

function count(state, itemId) {
  return [...state.hotbar, ...state.backpack]
    .filter((slot) => slot?.itemId === itemId)
    .reduce((sum, slot) => sum + slot.quantity, 0);
}

test('ignores messages that are not for the inventory', () => {
  const room = createInventoryRoom();
  const ws = socket();
  assert.equal(room.receive(ws, { x: 1, y: 2, z: 3, yaw: 0 }), false);
  assert.equal(room.receive(ws, { type: 'shoot' }), false);
  assert.equal(room.receive(ws, null), false);
  assert.equal(ws.sent.length, 0);
});

test('hello gives a new key the starter kit', () => {
  const room = createInventoryRoom();
  const ws = socket();
  assert.equal(room.receive(ws, hello(KEY_A)), true);
  assert.equal(ws.last.type, 'blort-inventory');
  assert.equal(ws.last.hotbar.length, 6);
  assert.equal(ws.last.backpack.length, 24);
  for (const { itemId } of STARTER_KIT) {
    const expected = STARTER_KIT.filter((k) => k.itemId === itemId).reduce(
      (sum, k) => sum + k.quantity,
      0,
    );
    assert.equal(count(ws.last, itemId), expected, itemId);
  }
});

test('a bad key is claimed as an inventory message but refused', () => {
  const room = createInventoryRoom();
  const ws = socket();
  assert.equal(room.receive(ws, hello('NOT-A-KEY')), true);
  assert.equal(room.receive(ws, move('hotbar', 0, 'hotbar', 5)), true);
  assert.equal(ws.sent.length, 0);
});

test('moves before hello change nothing', () => {
  const room = createInventoryRoom();
  const ws = socket();
  room.receive(ws, move('hotbar', 0, 'hotbar', 5));
  assert.equal(ws.sent.length, 0);
  room.receive(ws, hello(KEY_A));
  assert.equal(ws.last.hotbar[0].itemId, 'lantern');
  assert.equal(ws.last.hotbar[5], null);
});

test('a move is applied and sent to every socket on the key', () => {
  const room = createInventoryRoom();
  const tab1 = socket();
  const tab2 = socket();
  room.receive(tab1, hello(KEY_A));
  room.receive(tab2, hello(KEY_A));
  room.receive(tab1, move('hotbar', 0, 'backpack', 23));
  for (const tab of [tab1, tab2]) {
    assert.equal(tab.last.hotbar[0], null);
    assert.deepEqual(tab.last.backpack[23], { itemId: 'lantern', quantity: 1 });
  }
});

test('invalid moves leave the slots alone', () => {
  const room = createInventoryRoom();
  const ws = socket();
  room.receive(ws, hello(KEY_A));
  const before = ws.last;
  room.receive(ws, move('hotbar', 0, 'hotbar', 6)); // out of range
  room.receive(ws, move('pocket', 0, 'hotbar', 1)); // unknown bag
  room.receive(ws, move('hotbar', 5, 'hotbar', 1)); // empty source
  assert.deepEqual(ws.last.hotbar, before.hotbar);
  assert.deepEqual(ws.last.backpack, before.backpack);
});

test('keys cannot see or change each other', () => {
  const room = createInventoryRoom();
  const a = socket();
  const b = socket();
  room.receive(a, hello(KEY_A));
  room.receive(b, hello(KEY_B));
  const bSent = b.sent.length;
  room.receive(a, move('hotbar', 0, 'hotbar', 5));
  assert.equal(b.sent.length, bSent);
  assert.equal(b.last.hotbar[0].itemId, 'lantern');
});

test('grant only works when allowed', () => {
  const closed = createInventoryRoom();
  const ws = socket();
  closed.receive(ws, hello(KEY_A));
  const sent = ws.sent.length;
  closed.receive(ws, grant('rope', 5));
  assert.equal(ws.sent.length, sent);

  const playground = createInventoryRoom({ allowGrants: true });
  const dev = socket();
  playground.receive(dev, hello(KEY_A));
  const before = count(dev.last, 'rope');
  playground.receive(dev, grant('rope', 5));
  assert.equal(count(dev.last, 'rope'), before + 5);
  playground.receive(dev, grant('gold', 5));
  playground.receive(dev, grant('rope', 100000));
  assert.equal(count(dev.last, 'rope'), before + 5);
});

test('messages past the rate limit are dropped', () => {
  let time = 0;
  const room = createInventoryRoom({ messagesPerSecond: 3, now: () => time });
  const ws = socket();
  room.receive(ws, hello(KEY_A));
  room.receive(ws, move('hotbar', 0, 'hotbar', 5));
  room.receive(ws, move('hotbar', 5, 'hotbar', 0));
  room.receive(ws, move('hotbar', 0, 'hotbar', 4)); // 4th this second
  assert.equal(ws.last.hotbar[0].itemId, 'lantern');
  time = 1000;
  room.receive(ws, move('hotbar', 0, 'hotbar', 4));
  assert.equal(ws.last.hotbar[4].itemId, 'lantern');
});

test('inventories survive a restart through the save file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'blort-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'inventories.json');

  const first = createInventoryRoom({ file, saveDelayMs: 10 });
  const ws = socket();
  first.receive(ws, hello(KEY_A));
  first.receive(ws, move('hotbar', 0, 'backpack', 20));
  await first.close();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(saved.players[KEY_A]);

  const second = createInventoryRoom({ file });
  const again = socket();
  second.receive(again, hello(KEY_A));
  assert.equal(again.last.hotbar[0], null);
  assert.deepEqual(again.last.backpack[20], { itemId: 'lantern', quantity: 1 });
});

test('keys past the save cap work but are not saved', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'blort-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'inventories.json');
  const room = createInventoryRoom({ file, maxSaved: 1 });
  const a = socket();
  const b = socket();
  room.receive(a, hello(KEY_A));
  room.receive(b, hello(KEY_B));
  assert.equal(b.last.type, 'blort-inventory');
  await room.close();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(saved.players), [KEY_A]);
});

test('a corrupt save file starts fresh instead of crashing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'blort-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'inventories.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, '{ not json');
  const room = createInventoryRoom({ file });
  const ws = socket();
  room.receive(ws, hello(KEY_A));
  assert.equal(ws.last.hotbar[0].itemId, 'lantern');
});
