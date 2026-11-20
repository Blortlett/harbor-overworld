import {
  bytesToHex,
  SyncStrategy,
  type PolycentricClient,
  type ServerPushResult,
} from '@polycentric/js-core';
import { getClient, HARBOR_PRODUCTION_SERVERS } from '../client/client';
import { createPost, MAX_POST_LENGTH } from '../data/compose';
import { loadExplorePage } from '../data/feed';
import { createIdentity, latestLocalProfile } from '../data/identity';
import { eventKeyFromId, type PostData } from '../data/posts';
import { coatIndex, COATS, nameplate } from './avatar';
import { bindIdentityDialog } from './connect';
import { PostNotice } from './notice';
import { type Avatar, createPresence } from './presence';
import { type ChatPost, displayName, readChat } from './presence-protocol';
import { loadProfile } from '../data/profile';
import {
  createRenderer,
  EYE_HEIGHT,
  type FallingPost,
  facingNotice,
  spawnView,
  walk,
} from './renderer';
import { ground, noise, SPAWN, STATIONS, trailDistance } from './terrain';
import './world.css';

function element<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing Overworld element ${id}`);
  return node as T;
}

const world = element<HTMLCanvasElement>('world');
const game = element('overworld');
const welcome = element('welcome');
const connectIdentity = element('connect-identity');
const interaction = element('interaction');
const pageButton = element<HTMLButtonElement>('turn-page');
const thread = element<HTMLAnchorElement>('thread');
const noticeDescription = element('notice-description');
const crosshair = element('crosshair');
const refresh = element<HTMLButtonElement>('refresh');
const chatPanel = element<HTMLDialogElement>('chat-panel');
const connectPanel = element<HTMLDialogElement>('connect-panel');
const chatForm = element<HTMLFormElement>('chat-form');
const identityForm = element<HTMLFormElement>('identity-form');
const identityName = element<HTMLInputElement>('identity-name');
const draft = element<HTMLTextAreaElement>('draft');
const send = element<HTMLButtonElement>('send');
const create = element<HTMLButtonElement>('create-identity');
const chatStatus = element('chat-status');
const toast = element('toast');
const keys = new Set<string>();
const movement = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
];
const view = spawnView();
const roomStatus = element('room-status');
const welcomeIdentity = element<HTMLFormElement>('welcome-identity');
const welcomeName = element<HTMLInputElement>('welcome-name');
const welcomeError = element('welcome-error');
const enterButton = element<HTMLButtonElement>('enter-world');
let jump = 0;
let jumpSpeed = 0;
let spoken: (ChatPost & { until: number }) | undefined;
let avatarName: string | undefined;
const presence = createPresence(
  () => ({
    ...view,
    y: view.y - EYE_HEIGHT + jump,
    name: avatarName,
    chat:
      spoken && performance.now() < spoken.until
        ? { id: spoken.id, text: spoken.text }
        : undefined,
  }),
  (slot) => {
    if (Math.hypot(view.x - SPAWN.x, view.z - SPAWN.z) > 0.25) return;
    const { x, y, z } = spawnView(slot);
    Object.assign(view, { x, y, z });
  },
  (label) => {
    roomStatus.hidden = false;
    roomStatus.textContent = label;
  },
);
let renderer: ReturnType<typeof createRenderer> | undefined;
let entered = false;
let dragging = false;
let busy = false;
let notices: PostNotice[] = [];
let focusedNotice: PostNotice | undefined;
let replyTo: PostData | undefined;
let pending: PostData | undefined;
let client: PolycentricClient | undefined;
let toastTimer = 0;
let resumePointer = false;
let resumeChat = false;
let haveFeed = false;
const feedStartedAt = Date.now();
const seenPosts = new Set<string>();
const drops: FallingPost[] = [];

function dropPost(
  id: string,
  paper: HTMLCanvasElement,
  x: number,
  z: number,
  delay = 0,
) {
  if (seenPosts.has(id)) return;
  seenPosts.add(id);
  if (seenPosts.size > 2000) {
    const oldest = seenPosts.values().next().value;
    if (oldest) seenPosts.delete(oldest);
  }
  drops.push({
    id,
    paper,
    x,
    z,
    y: Math.max(1.1, ground(x, z)),
    start: performance.now() / 1000 + delay,
  });
}

function dropNotice(post: PostData, delay = 0) {
  if (seenPosts.has(post.id)) return;
  const notice = new PostNotice(post, () => undefined);
  const side = Math.sin(drops.length * 2) * 2;
  dropPost(
    post.id,
    notice.canvas,
    view.x + Math.sin(view.yaw) * 6 + Math.cos(view.yaw) * side,
    view.z - Math.cos(view.yaw) * 6 + Math.sin(view.yaw) * side,
    delay,
  );
}

draft.maxLength = MAX_POST_LENGTH;

function updateAvatarName(activeClient: PolycentricClient) {
  const identity = activeClient.activeIdentityKey;
  welcomeIdentity.hidden = !!identity;
  avatarName = identity
    ? displayName(latestLocalProfile(activeClient, identity)?.name)
    : undefined;
  if (!identity || avatarName) return;
  void loadProfile(activeClient, identity)
    .then(({ name }) => {
      if (
        client === activeClient &&
        activeClient.activeIdentityKey === identity &&
        !avatarName
      ) {
        avatarName = displayName(name);
      }
    })
    .catch(() => undefined);
}

function announce(message: string) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 5500);
}

function report(message = '') {
  chatStatus.textContent = message;
  chatStatus.hidden = !message;
}

function markNetwork(state: string, name: string, detail: string) {
  element('network-lamp').dataset.state = state;
  element('network-name').textContent = name;
  element('network-detail').textContent = detail;
}

async function loadPosts() {
  if (refresh.disabled) return;
  refresh.disabled = true;
  markNetwork('loading', 'CONNECTING', 'Harbor feed');
  try {
    client = await getClient();
    updateAvatarName(client);
    connectIdentity.hidden = !!client.activeIdentityKey;
    const page = await loadExplorePage(client, 'latest', undefined, {
      servers: HARBOR_PRODUCTION_SERVERS,
      includeLocal: false,
    });
    const posts = [
      ...new Map(page.items.map((post) => [post.id, post])).values(),
    ].slice(0, STATIONS.length);
    const byId = new Map(notices.map((notice) => [notice.post.id, notice]));
    notices = posts.map(
      (post) => byId.get(post.id) ?? new PostNotice(post, updateNotice),
    );
    renderer?.setStations(notices.map((notice) => notice.canvas));
    if (haveFeed && entered) {
      const fresh = posts.filter(
        (post) => post.createdAt >= feedStartedAt && !seenPosts.has(post.id),
      );
      for (const [index, post] of fresh.slice(0, 5).entries())
        dropNotice(post, index * 0.23);
    }
    haveFeed = true;
    markNetwork(
      'live',
      'PRODUCTION',
      `${posts.length} live ${posts.length === 1 ? 'post' : 'posts'}`,
    );
  } catch (error) {
    console.error('Could not load the Harbor feed:', error);
    markNetwork(
      'error',
      'FEED UNAVAILABLE',
      notices.length ? 'Showing last load' : 'Click to retry',
    );
  } finally {
    refresh.disabled = false;
  }
}

function capture() {
  if (
    !renderer ||
    document.pointerLockElement === world ||
    chatPanel.open ||
    connectPanel.open
  )
    return;
  try {
    void world.requestPointerLock?.()?.catch(() => undefined);
  } catch {
    // Dragging the canvas also works when the browser blocks pointer lock.
  }
}

function enter(captureMouse: boolean) {
  if (!renderer) return;
  if (!entered) presence.join();
  entered = true;
  welcome.hidden = true;
  game.classList.add('entered');
  if (document.activeElement instanceof HTMLButtonElement)
    document.activeElement.blur();
  if (captureMouse) capture();
}

function pause(dialog: HTMLDialogElement) {
  if (document.pointerLockElement === world) {
    resumePointer = true;
    document.exitPointerLock();
  }
  dragging = false;
  keys.clear();
  dialog.showModal();
}

function closePanel(dialog: HTMLDialogElement, resume = true) {
  dialog.close();
  if (resume && resumePointer) {
    resumePointer = false;
    capture();
  }
}

function updateNotice(notice: PostNotice) {
  const index = notices.indexOf(notice);
  if (index < 0) return;
  renderer?.setNotice(index, notice.canvas);
  if (focusedNotice === notice)
    noticeDescription.textContent = notice.description;
}

function focusNotice(notice: PostNotice | undefined) {
  if (focusedNotice === notice) return;
  focusedNotice = notice;
  interaction.hidden = !notice;
  crosshair.classList.toggle('active', !!notice);
  noticeDescription.textContent = notice?.description ?? '';
  if (!notice) return;
  pageButton.hidden = notice.pageCount < 2;
  const { identity, signedBy, sequence } = notice.post;
  const fingerprint = bytesToHex(signedBy.key).slice(0, 16);
  thread.href = `https://harbor.social/${encodeURIComponent(identity)}/post/${fingerprint}/${encodeURIComponent(sequence)}`;
  if (client) notice.loadAssets(client);
}

function turnPage(backwards = false) {
  if (client && !chatPanel.open) focusedNotice?.turn(client, backwards);
}

function replyToNotice() {
  if (focusedNotice) void openChat(focusedNotice.post);
}

function showComposer() {
  const ready = !!client?.activeIdentityKey;
  const label = pending ? 'Retry publish' : 'Publish';
  element('send-label').textContent = label;
  send.disabled = busy;
  create.disabled = busy;
  draft.readOnly = busy || !!pending;
  chatForm.hidden = !ready;
  identityForm.hidden = ready || !client;
  if (!client) return;
  if (ready) draft.focus();
  else identityName.focus();
}

async function openChat(target?: PostData) {
  if (chatPanel.open || connectPanel.open) return;
  if (!pending && replyTo?.id !== target?.id) draft.value = '';
  if (!pending) replyTo = target;
  element('chat-heading').textContent = replyTo
    ? 'Reply to post'
    : 'Write a post';
  element('chat-context').textContent = replyTo
    ? 'Publishes as a public reply on Harbor.'
    : 'Publishes to Harbor as a public post.';
  report(pending ? 'Saved on this browser. Retry to publish to Harbor.' : '');
  pause(chatPanel);
  showComposer();
  try {
    client = await getClient();
    updateAvatarName(client);
    if (!chatPanel.open) return;
    showComposer();
    if (!client.activeIdentityKey)
      report('Create a Harbor identity to start posting.');
    else if (!pending) {
      const profile = latestLocalProfile(client, client.activeIdentityKey);
      if (profile?.name) report(`Posting as ${profile.name}`);
    }
  } catch (error) {
    console.error('Could not open the Harbor client:', error);
    report('Could not connect to Harbor. Close and reopen chat to retry.');
  }
}

async function publish(
  activeClient: PolycentricClient,
  post: PostData,
  retry: boolean,
) {
  const key = eventKeyFromId(post.id);
  const results = new Map<string, ServerPushResult>();
  const collect = (outcomes: ServerPushResult[]) => {
    for (const outcome of outcomes) {
      if (outcome.identity === key.identity)
        results.set(outcome.server, outcome);
    }
  };
  // The world publishes to production even when the regular client uses a
  // different configured seed list. Restore the identity's server list after.
  const previousServers = activeClient.servers;
  activeClient.servers = [...HARBOR_PRODUCTION_SERVERS];
  activeClient.events.onPushResults(collect);
  try {
    await activeClient.sync(
      retry ? SyncStrategy.FULL_PUSH : SyncStrategy.PARTIAL_PUSH,
    );
  } finally {
    activeClient.events.offPushResults(collect);
    activeClient.servers = previousServers;
  }
  const signer = bytesToHex(post.signedBy.key);
  return HARBOR_PRODUCTION_SERVERS.some((server) => {
    const result = results.get(server);
    return (
      result &&
      !result.error &&
      !result.eventIssues.some(
        (issue) =>
          issue.key.collection === key.collection &&
          issue.key.sequence === key.sequence &&
          bytesToHex(new Uint8Array(issue.key.signedBy.key)) === signer,
      )
    );
  });
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const activeClient = client;
  const text = draft.value.trim();
  if (!activeClient?.activeIdentityKey || busy || (!pending && !text)) return;
  busy = true;
  showComposer();
  report('Publishing…');
  try {
    const retry = !!pending;
    pending ??= await createPost(activeClient, { text, images: [], replyTo });
    if (!(await publish(activeClient, pending, retry)))
      throw new Error('No production server confirmed the post.');
    const message = replyTo
      ? 'Reply published to Harbor.'
      : 'Post published to Harbor.';
    const chat = readChat({ id: pending.id, text: pending.content });
    if (chat?.text) {
      spoken = { ...chat, until: performance.now() + 10_000 };
      const selfChat = element('self-chat');
      selfChat.textContent = chat.text;
      selfChat.hidden = false;
    }
    dropNotice(pending);
    pending = undefined;
    replyTo = undefined;
    draft.value = '';
    if (chatPanel.open) closePanel(chatPanel, false);
    announce(message);
    void loadPosts();
  } catch (error) {
    console.error('Harbor publish failed:', error);
    report(
      pending
        ? 'Saved on this browser. Retry to publish to Harbor.'
        : 'Could not save the post. Your draft is still here.',
    );
  } finally {
    busy = false;
    if (chatPanel.open) showComposer();
  }
});

identityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = identityName.value.trim();
  if (!client || busy || !name) return;
  busy = true;
  showComposer();
  report('Creating your Harbor identity…');
  try {
    await createIdentity(client, name);
    updateAvatarName(client);
    connectIdentity.hidden = true;
    report(`Posting as ${name}`);
  } catch (error) {
    console.error('Could not create a Harbor identity:', error);
    report(
      'Could not finish identity setup. Try again or use an existing identity.',
    );
  } finally {
    busy = false;
    if (chatPanel.open) showComposer();
  }
});

draft.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!event.repeat) chatForm.requestSubmit();
});

chatPanel.addEventListener('close', () => {
  const active = document.activeElement;
  if (
    !chatPanel.open &&
    active instanceof HTMLElement &&
    chatPanel.contains(active)
  )
    active.blur();
});

for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-close]',
)) {
  button.addEventListener('click', () => {
    const dialog = button.closest('dialog');
    if (dialog) closePanel(dialog);
  });
}
function openIdentity() {
  if (connectPanel.open) return;
  resumeChat = chatPanel.open;
  if (resumeChat) closePanel(chatPanel, false);
  pause(connectPanel);
  element('pair-code').focus();
}

bindIdentityDialog(connectPanel, (connectedClient) => {
  client = connectedClient;
  updateAvatarName(connectedClient);
  connectIdentity.hidden = true;
  closePanel(connectPanel, false);
  if (resumeChat) void openChat(replyTo);
  else announce('Harbor identity connected.');
});
connectIdentity.addEventListener('click', openIdentity);
element('existing-identity').addEventListener('click', openIdentity);
refresh.addEventListener('click', () => void loadPosts());
pageButton.addEventListener('click', () => turnPage());
async function enterFromWelcome() {
  if (busy) return;
  const name = welcomeName.value.trim();
  if (!name || client?.activeIdentityKey) {
    enter(true);
    return;
  }
  busy = true;
  enterButton.disabled = true;
  welcomeName.disabled = true;
  welcomeError.textContent = 'Creating your Harbor identity…';
  welcomeError.hidden = false;
  try {
    client = await getClient();
    if (!client.activeIdentityKey) await createIdentity(client, name);
    updateAvatarName(client);
    connectIdentity.hidden = true;
    enter(false);
  } catch (error) {
    console.error('Could not create a Harbor identity:', error);
    welcomeError.textContent =
      'Could not create your identity. Try again or clear the name to play as a guest.';
  } finally {
    busy = false;
    enterButton.disabled = false;
    welcomeName.disabled = false;
  }
}

enterButton.addEventListener('click', () => void enterFromWelcome());
welcomeIdentity.addEventListener('submit', (event) => {
  event.preventDefault();
  void enterFromWelcome();
});
element('open-chat').addEventListener('click', () => void openChat());
element('reply').addEventListener('click', replyToNotice);
world.addEventListener('click', () => {
  if (!busy) enter(true);
});
world.addEventListener('pointerdown', () => {
  dragging = entered && document.pointerLockElement !== world;
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
window.addEventListener('blur', () => {
  keys.clear();
  dragging = false;
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== world) keys.clear();
  else resumePointer = false;
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== world && !dragging) return;
  view.yaw += event.movementX * 0.00245;
  view.pitch = Math.max(
    -1.31,
    Math.min(1.31, view.pitch - event.movementY * 0.00245),
  );
});
window.addEventListener('keydown', (event) => {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.target === welcomeName ||
    chatPanel.open ||
    connectPanel.open
  )
    return;
  if (
    event.key === 'Enter' &&
    (entered ||
      !(
        event.target instanceof HTMLElement && event.target.closest('button, a')
      ))
  ) {
    event.preventDefault();
    if (!event.repeat) void openChat();
  }
  if (entered && event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat && jump === 0) jumpSpeed = 5.6;
    return;
  }
  if (focusedNotice && !event.repeat) {
    if (event.code === 'KeyE') turnPage(event.shiftKey);
    if (event.code === 'KeyR') replyToNotice();
    if (event.code === 'KeyT') thread.click();
  }
  if (!renderer || !movement.includes(event.code)) return;
  event.preventDefault();
  if (!entered) enter(false);
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

const map = element<HTMLCanvasElement>('minimap');
const mapContext = map.getContext('2d');
const mapTerrain = document.createElement('canvas');
mapTerrain.width = map.width;
mapTerrain.height = map.height;
const mapBase = mapTerrain.getContext('2d');
const mapScale = 1.38;
const mapX = -53;
const mapZ = -56;
for (let y = 0; y < map.height; y += 2) {
  for (let x = 0; x < map.width; x += 2) {
    if (!mapBase) break;
    const wx = x / mapScale + mapX;
    const wz = y / mapScale + mapZ;
    const land = ground(wx, wz);
    const n = noise(x, y);
    mapBase.fillStyle =
      land < 2
        ? n > 0.84
          ? '#2f514e'
          : '#284843'
        : trailDistance(wx, wz) < 1.25
          ? '#9b8350'
          : land % 4 === 1
            ? '#586047'
            : `hsl(73 20% ${24 + land * 0.55 + n * 5}%)`;
    mapBase.fillRect(x, y, 2, 2);
  }
}
const coordinates = element('coordinates');
const compassTrack = element('compass-track');
const ticks = Array.from({ length: 24 }, (_, index) => {
  const mark = document.createElement('span');
  mark.textContent = ['N', 'E', 'S', 'W'][index / 6] ?? '';
  mark.classList.toggle('cardinal', !!mark.textContent);
  compassTrack.append(mark);
  return mark;
});

function drawHud(avatars: readonly Avatar[] = []) {
  const current = `${Math.floor(view.x)} / ${Math.floor(view.z)}`;
  if (coordinates.textContent !== current) coordinates.textContent = current;
  const bearing = ((((view.yaw * 180) / Math.PI) % 360) + 360) % 360;
  for (const [index, mark] of ticks.entries()) {
    const angle = ((index * 15 - bearing + 540) % 360) - 180;
    mark.style.left = `${119 + angle * 2.55}px`;
    mark.hidden = Math.abs(angle) > 53;
  }
  if (!mapContext) return;
  mapContext.drawImage(mapTerrain, 0, 0);
  mapContext.fillStyle = '#ffca78';
  for (const [x, z] of STATIONS.slice(0, notices.length)) {
    mapContext.fillRect(
      Math.round((x - mapX) * mapScale) - 1,
      Math.round((z - mapZ) * mapScale) - 1,
      3,
      3,
    );
  }
  for (const avatar of avatars) {
    const tint = COATS[coatIndex(avatar.id)].map((channel) =>
      Math.round(channel * 255),
    );
    const x = Math.round((avatar.x - mapX) * mapScale);
    const y = Math.round((avatar.z - mapZ) * mapScale);
    mapContext.fillStyle = '#172820';
    mapContext.fillRect(x - 2, y - 2, 5, 5);
    mapContext.fillStyle = `rgb(${tint.join(',')})`;
    mapContext.fillRect(x - 1, y - 1, 3, 3);
  }
  mapContext.save();
  mapContext.translate(
    Math.round((view.x - mapX) * mapScale),
    Math.round((view.z - mapZ) * mapScale),
  );
  mapContext.rotate(view.yaw);
  mapContext.beginPath();
  mapContext.moveTo(0, -6);
  mapContext.lineTo(4, 4);
  mapContext.lineTo(0, 2);
  mapContext.lineTo(-4, 4);
  mapContext.closePath();
  mapContext.fillStyle = '#fff3d6';
  mapContext.strokeStyle = '#182017';
  mapContext.lineWidth = 2;
  mapContext.stroke();
  mapContext.fill();
  mapContext.restore();
}

function start() {
  try {
    renderer = createRenderer(world);
    renderer.setStations(notices.map((notice) => notice.canvas));
  } catch (error) {
    console.error(error);
    element('welcome-copy').textContent = 'This browser could not start WebGL.';
    element<HTMLButtonElement>('enter-world').disabled = true;
    drawHud();
    return;
  }
  let previous = performance.now();
  function frame(time: number) {
    requestAnimationFrame(frame);
    if (!renderer) return;
    const dt = Math.min(0.05, (time - previous) / 1000);
    previous = time;
    const exploring = entered && !chatPanel.open && !connectPanel.open;
    if (exploring) {
      view.yaw +=
        (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) *
        dt *
        1.6;
      view.pitch = Math.max(
        -1.31,
        Math.min(
          1.31,
          view.pitch +
            (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * dt,
        ),
      );
      walk(view, keys, dt, renderer.obstacles, notices.length);
    }
    if (jump > 0 || jumpSpeed > 0) {
      jumpSpeed -= 13 * dt;
      jump = Math.max(0, jump + jumpSpeed * dt);
      if (jump === 0) jumpSpeed = 0;
    }
    const camera = { ...view, y: view.y + jump };
    const noticeIndex = exploring ? facingNotice(camera, notices.length) : -1;
    focusNotice(notices[noticeIndex]);
    const avatars = presence.avatars(time);
    for (const avatar of avatars) {
      if (!avatar.chat?.text || seenPosts.has(avatar.chat.id)) continue;
      const paper = nameplate(avatar.id, avatar.chat.text);
      if (paper)
        dropPost(
          avatar.chat.id,
          paper,
          avatar.x + Math.sin(avatar.yaw) * 2,
          avatar.z - Math.cos(avatar.yaw) * 2,
        );
    }
    const seconds = time / 1000;
    for (let index = drops.length - 1; index >= 0; index--) {
      if (seconds - drops[index].start > 22) drops.splice(index, 1);
    }
    if (spoken && time >= spoken.until) {
      spoken = undefined;
      element('self-chat').hidden = true;
    }
    renderer.draw(camera, seconds, avatars, drops);
    drawHud(avatars);
  }
  requestAnimationFrame(frame);
}

start();
void loadPosts();

window.setInterval(() => {
  if (entered && !document.hidden) void loadPosts();
}, 12_000);
