import {
  bytesToHex,
  COLLECTION,
  v2,
  SyncStrategy,
  type PolycentricClient,
  type ServerPushResult,
} from '@polycentric/js-core';
import { Query } from '@polycentric/rs-core-wasm/web';
import { getClient, HARBOR_PRODUCTION_SERVERS } from '../client/client';
import { createPost, MAX_POST_LENGTH } from '../data/compose';
import { loadExplorePage } from '../data/feed';
import { createIdentity, latestLocalProfile } from '../data/identity';
import { findLike, setLike } from '../data/likes';
import { decodePostBundle, eventKeyFromId, type PostData } from '../data/posts';
import { coatIndex, COATS } from './avatar';
import { bindIdentityDialog } from './connect';
import { bindMobileControls } from './mobile';
import { PostNotice } from './notice';
import { type Avatar, createPresence } from './presence';
import {
  DEFAULT_KING_SCALE,
  displayName,
  isPlacedPost,
  isPlacement,
  KING_IDENTITY,
  KING_SCALES,
  type KingScale,
  kingChallenge,
  OVERWORLD_APPLICATION,
  type PlacedPost,
  type Placement,
  type PlacementUpdate,
  placementChallenge,
  type PostLocation,
  plotDay,
  postExpired,
} from './presence-protocol';
import { loadProfile } from '../data/profile';
import { fetchOnce } from '../data/query';
import {
  createRenderer,
  DROP_BASE,
  DROP_DURATION,
  DROP_HALF_WIDTH,
  DROP_HEIGHT,
  EYE_HEIGHT,
  type FallingPost,
  facingNotice,
  spawnView,
  walk,
} from './renderer';
import {
  ground,
  noise,
  SPAWN,
  STATIONS,
  trailDistance,
  WATER,
} from './terrain';
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
const likeButton = element<HTMLButtonElement>('like-post');
const thread = element<HTMLAnchorElement>('thread');
const noticeDescription = element('notice-description');
const crosshair = element('crosshair');
const fallingPosts = element('falling-posts');
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
const kingStatus = element('king-status');
const kingSizeButton = element<HTMLButtonElement>('king-size');
const welcomeIdentity = element<HTMLFormElement>('welcome-identity');
const welcomeName = element<HTMLInputElement>('welcome-name');
const welcomeError = element('welcome-error');
const enterButton = element<HTMLButtonElement>('enter-world');
let floor = view.y - EYE_HEIGHT;
const GRAVITY = 33;
const JUMP_SPEED = 8.2;
let airborne: { height: number; startedAt: number; speed: number } | undefined;
let kingMode = false;
let kingScale: KingScale = DEFAULT_KING_SCALE;
let avatarName: string | undefined;
const presence = createPresence(
  () => ({
    ...view,
    y: view.y - EYE_HEIGHT,
    name: avatarName,
    kingScale: kingMode ? kingScale : undefined,
  }),
  (slot) => {
    if (Math.hypot(view.x - SPAWN.x, view.z - SPAWN.z) > 0.25) return;
    const { x, y, z } = spawnView(slot);
    Object.assign(view, { x, y, z });
    floor = y - EYE_HEIGHT;
  },
  (label) => {
    roomStatus.hidden = false;
    roomStatus.textContent = label;
  },
  updatePlots,
  updatePlacements,
  async (nonce) => {
    const activeClient = client;
    const pair = activeClient?.currentKeyPair;
    if (activeClient?.activeIdentityKey !== KING_IDENTITY || !pair) return;
    const signature = await activeClient.cryptoManager.sign(
      pair.privateKey.key,
      kingChallenge(nonce),
      pair.keyType,
    );
    if (
      activeClient.activeIdentityKey !== KING_IDENTITY ||
      activeClient.currentKeyPair !== pair
    )
      return;
    return {
      key: bytesToHex(pair.publicKey.key),
      proof: bytesToHex(signature),
    };
  },
  (crowned) => {
    kingStatus.textContent =
      crowned && kingMode ? 'King Mode · Crowned' : 'King Mode';
  },
);
const mobile = bindMobileControls(game, world, {
  hasStarted: () => entered && !chatPanel.open && !connectPanel.open,
  handleLook,
  jump: jumpOnce,
  openChat: () => void openChat(),
});
let renderer: ReturnType<typeof createRenderer> | undefined;
let entered = false;
let dragging = false;
let busy = false;
let notices: PostNotice[] = [];
let focusedNotice: PostNotice | undefined;
let replyTo: PostData | undefined;
let pending:
  | { post: PostData; paper: string; location: PostLocation }
  | undefined;
let client: PolycentricClient | undefined;
let toastTimer = 0;
let resumePointer = false;
let resumeChat = false;
let openingReply = false;
let plotsDay: string | undefined;
type WorldPost = {
  notice: PostNotice;
  drop: FallingPost;
  landedAt: number;
  request?: Placement;
  preview?: HTMLElement;
  retryAt: number;
};
const worldPosts = new Map<string, WorldPost>();
const placementStorage = 'overworld:placement:';
const readingPlacements = new Set<string>();

function setNotices(posts: readonly PostData[]) {
  const byId = new Map(notices.map((notice) => [notice.post.id, notice]));
  notices = posts.map(
    (post) => byId.get(post.id) ?? new PostNotice(post, updateNotice),
  );
  renderer?.setStations(notices.map((notice) => notice.canvas));
}

function decodePaper(paper: string) {
  try {
    const bundle = v2.EventBundle.fromBinary(
      Uint8Array.from(atob(paper), (char) => char.charCodeAt(0)),
    );
    return decodePostBundle(bundle);
  } catch {
    return null;
  }
}

function updatePlots({ day, papers }: { day: string; papers: string[] }) {
  if (day !== plotDay(Date.now())) return;
  const posts = papers.slice(0, STATIONS.length).flatMap((paper) => {
    const post = decodePaper(paper);
    return post ? [post] : [];
  });
  if (!posts.length) return;
  plotsDay = day;
  setNotices(posts);
  markNetwork(
    'live',
    'PRODUCTION',
    `${posts.length} live ${posts.length === 1 ? 'post' : 'posts'}`,
  );
}

function isOverworldPost(post: PostData) {
  return (
    v2.Event.fromBinary(post.signedEvent.eventBytes).application?.id ===
    OVERWORLD_APPLICATION
  );
}

function showPlacement(
  { id, x, z, landedAt }: PlacedPost,
  post: PostData,
  {
    live,
    request,
    author,
  }: { live?: boolean; request?: Placement; author?: string } = {},
) {
  if (postExpired(landedAt) || post.id !== id) return;
  const existing = worldPosts.get(id);
  if (existing && (!existing.request || request)) return;
  if (existing?.drop.x === x && existing.drop.z === z) {
    existing.request = undefined;
    return;
  }
  existing?.preview?.remove();
  const notice = new PostNotice(post, updateNotice, { card: true, author });
  let y = Math.max(WATER, ground(x, z));
  for (const { drop } of worldPosts.values()) {
    if (drop.id !== id && drop.x === x && drop.z === z)
      y = Math.max(y, drop.y + DROP_HEIGHT + 0.08);
  }
  const entry: WorldPost = {
    notice,
    drop: {
      id,
      x,
      y,
      z,
      paper: notice.canvas,
      start: performance.now() / 1000 - (live ? 0 : DROP_DURATION),
    },
    landedAt,
    request,
    retryAt: 0,
  };
  worldPosts.set(id, entry);
  renderer?.setDrop(id, notice.canvas);
  if (live && !document.hidden) {
    const card = document.createElement('div');
    const coords = document.createElement('span');
    coords.className = 'plate';
    coords.textContent = `${Math.floor(x)} / ${Math.floor(z)}`;
    card.append(notice.canvas, coords);
    fallingPosts.append(card);
    entry.preview = card;
    if (client) notice.loadAssets(client);
    window.setTimeout(() => {
      card.remove();
      entry.preview = undefined;
    }, 3450);
  }
}

function restorePlacements() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(placementStorage)) continue;
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (
          isPlacement(saved?.request) &&
          isPlacedPost(saved?.placement) &&
          saved.placement.paper &&
          !postExpired(saved.placement.landedAt)
        ) {
          const post = decodePaper(saved.placement.paper);
          if (post) {
            showPlacement(saved.placement, post, { request: saved.request });
            continue;
          }
        }
      } catch {
        // Discard invalid saved placements.
      }
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('Could not restore local Overworld posts:', error);
  }
}

async function resolvePlacement(placement: PlacedPost, live: boolean) {
  const { id, landedAt, paper } = placement;
  if (postExpired(landedAt)) return;
  const existing = worldPosts.get(id);
  if (existing) {
    showPlacement(placement, existing.notice.post, { live: false });
    return;
  }
  if (paper) {
    const post = decodePaper(paper);
    if (post && isOverworldPost(post)) showPlacement(placement, post, { live });
    return;
  }
  if (readingPlacements.has(id)) return;
  readingPlacements.add(id);
  try {
    const activeClient = await getClient();
    const key = eventKeyFromId(id);
    if (key.collection !== COLLECTION.FEED || !key.signedBy) return;
    const query = new Query.GetPost({
      identity: key.identity,
      sequence: key.sequence,
      signerKeyPrefix: bytesToHex(key.signedBy.key).slice(0, 16),
    });
    for (let attempt = 0; attempt < 3 && !postExpired(landedAt); attempt++) {
      const bytes = await fetchOnce(
        activeClient,
        ['world-post', id, String(attempt)],
        query,
        { servers: HARBOR_PRODUCTION_SERVERS, serverTimeoutMs: 2500 },
      ).catch(() => undefined);
      if (bytes) {
        const { candidates } = v2.GetPostResponse.fromBinary(
          new Uint8Array(bytes),
        );
        for (const bundle of candidates) {
          const post = decodePostBundle(bundle);
          if (post?.id === id && isOverworldPost(post)) {
            showPlacement(placement, post, { live });
            return;
          }
        }
      }
      if (attempt < 2)
        await new Promise((resolve) =>
          window.setTimeout(resolve, 500 * (attempt + 1)),
        );
    }
  } catch (error) {
    console.warn('Could not load a shared Overworld post:', error);
  } finally {
    readingPlacements.delete(id);
  }
}

function updatePlacements({ posts, live }: PlacementUpdate) {
  for (const post of posts) {
    const age = Date.now() - post.landedAt;
    void resolvePlacement(post, live ?? (age >= 0 && age < 1000));
  }
}

function prunePlacements(now: number) {
  for (const [id, entry] of worldPosts) {
    if (!postExpired(entry.landedAt, now)) continue;
    entry.preview?.remove();
    worldPosts.delete(id);
    try {
      localStorage.removeItem(placementStorage + id);
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }
}

function retryPlacements() {
  const now = Date.now();
  if (plotsDay && plotsDay !== plotDay(now)) {
    plotsDay = undefined;
    setNotices([]);
  }
  prunePlacements(now);
  for (const entry of worldPosts.values()) {
    if (!entry.request || entry.retryAt > now) continue;
    if (presence.place(entry.request)) entry.retryAt = now + 8000;
    break;
  }
}

function publishPlacement(
  placement: PlacedPost & { paper: string },
  post: PostData,
  request: Placement,
  author?: string,
) {
  showPlacement(placement, post, { live: true, request, author });
  try {
    localStorage.setItem(
      placementStorage + placement.id,
      JSON.stringify({ placement, request }),
    );
  } catch (error) {
    console.warn('Could not save the local Overworld post:', error);
  }
  retryPlacements();
}

function facingPlacement(camera: typeof view, time: number) {
  const vx = Math.sin(camera.yaw);
  const vz = -Math.cos(camera.yaw);
  const slope = Math.tan(camera.pitch);
  let nearest: PostNotice | undefined;
  let range = 5;
  for (const { drop, notice } of worldPosts.values()) {
    if (time - drop.start < DROP_DURATION) continue;
    const dx = drop.x - camera.x;
    const dz = drop.z - camera.z;
    const depth = dx * vx + dz * vz;
    const along = dx * -vz + dz * vx;
    const height = camera.y + slope * depth - drop.y - DROP_BASE;
    if (
      depth < 0.15 ||
      depth >= range ||
      Math.abs(along) > DROP_HALF_WIDTH ||
      height < 0 ||
      height > DROP_HEIGHT
    )
      continue;
    nearest = notice;
    range = depth;
  }
  return nearest;
}

draft.maxLength = MAX_POST_LENGTH;

function updateAvatarName(activeClient: PolycentricClient) {
  const identity = activeClient.activeIdentityKey;
  welcomeIdentity.hidden = !!identity;
  connectIdentity.textContent = identity
    ? 'Switch Harbor identity'
    : 'Connect Harbor identity';
  kingMode = identity === KING_IDENTITY && !!activeClient.currentKeyPair;
  kingStatus.hidden = !kingMode;
  updateLikeButton();
  kingSizeButton.hidden = !kingMode;
  if (!kingMode) setKingScale(DEFAULT_KING_SCALE);
  if (!kingMode) kingStatus.textContent = 'King Mode';
  void presence
    .proveKing()
    .catch((error) => console.warn('Could not verify King Mode:', error));
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
    const activeClient = await getClient();
    client = activeClient;
    updateAvatarName(activeClient);
    const posts = new Map<string, PostData>();
    let cursor: string | undefined;
    for (let i = 0; !plotsDay && i < 5 && posts.size < STATIONS.length; i++) {
      const page = await loadExplorePage(activeClient, 'latest', cursor, {
        servers: HARBOR_PRODUCTION_SERVERS,
        includeLocal: false,
      });
      for (const post of page.items) {
        if (!isOverworldPost(post)) posts.set(post.id, post);
      }
      if (!page.hasMore || !page.cursor || page.cursor === cursor) break;
      cursor = page.cursor;
    }
    if (!plotsDay) setNotices([...posts.values()].slice(0, STATIONS.length));
    const count = notices.length;
    markNetwork(
      'live',
      'PRODUCTION',
      `${count} live ${count === 1 ? 'post' : 'posts'}`,
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
  mobile.reset();
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
  if (index >= 0) renderer?.setNotice(index, notice.canvas);
  if (worldPosts.get(notice.post.id)?.notice === notice)
    renderer?.setDrop(notice.post.id, notice.canvas);
  if (focusedNotice === notice)
    noticeDescription.textContent = notice.description;
}

function focusNotice(notice: PostNotice | undefined) {
  if (focusedNotice === notice) return;
  focusedNotice = notice;
  interaction.hidden = !notice;
  crosshair.classList.toggle('active', !!notice);
  noticeDescription.textContent = notice?.description ?? '';
  updateLikeButton();
  if (!notice) return;
  pageButton.hidden = notice.pageCount < 2;
  const { identity, signedBy, sequence } = notice.post;
  const fingerprint = bytesToHex(signedBy.key).slice(0, 16);
  thread.href = `https://harbor.social/${encodeURIComponent(identity)}/post/${fingerprint}/${encodeURIComponent(sequence)}`;
  if (client) notice.loadAssets(client);
}

function updateLikeButton() {
  const post = focusedNotice?.post;
  likeButton.setAttribute(
    'aria-pressed',
    String(!!(post && client && findLike(client, post.id))),
  );
}

async function toggleLike() {
  const post = focusedNotice?.post;
  if (!post || busy) return;
  const activeClient = client;
  if (!activeClient?.activeIdentityKey || !activeClient.currentKeyPair) {
    openIdentity();
    return;
  }
  busy = true;
  likeButton.disabled = true;
  try {
    const existing = findLike(activeClient, post.id);
    const { eventKey } = await setLike(activeClient, post.id, existing);
    updateLikeButton();
    const sent = await publish(activeClient, eventKey, false);
    if (sent) announce(existing ? 'Like removed.' : 'Post liked.');
    else announce('Reaction saved locally. Harbor sync is pending.');
  } catch (error) {
    console.error('Could not update the Harbor reaction:', error);
    announce('Could not finish syncing your reaction.');
  } finally {
    busy = false;
    likeButton.disabled = false;
    updateLikeButton();
  }
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
  key: v2.EventKey,
  retry: boolean,
) {
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
  const signer = key.signedBy && bytesToHex(key.signedBy.key);
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
    if (!pending) {
      const { x, z } = view;
      const result = await createPost(activeClient, {
        text,
        images: [],
        replyTo,
      });
      pending = { ...result, location: { x, z } };
    }
    const { post, paper, location } = pending;
    const pair = activeClient.currentKeyPair;
    if (
      !pair ||
      bytesToHex(pair.publicKey.key) !== bytesToHex(post.signedBy.key)
    )
      throw new Error('The publishing identity changed.');
    if (!(await publish(activeClient, eventKeyFromId(post.id), retry)))
      throw new Error('No production server confirmed the post.');
    const publishedAt = Date.now();
    const proof = bytesToHex(
      await activeClient.cryptoManager.sign(
        pair.privateKey.key,
        placementChallenge(post.id, location.x, location.z, publishedAt),
        pair.keyType,
      ),
    );
    const signedEvent = btoa(
      String.fromCharCode(...v2.SignedEvent.toBinary(post.signedEvent)),
    );
    publishPlacement(
      { id: post.id, paper, ...location, landedAt: publishedAt },
      post,
      {
        type: 'place',
        id: post.id,
        ...location,
        proof,
        publishedAt,
        signedEvent,
      },
      latestLocalProfile(activeClient, post.identity)?.name,
    );
    pending = undefined;
    replyTo = undefined;
    draft.value = '';
    if (chatPanel.open) closePanel(chatPanel, false);
    announce(
      post.reply
        ? 'Reply dropped here. Step back to read it.'
        : 'Post dropped here. Step back to read it.',
    );
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
  closePanel(connectPanel, false);
  if (resumeChat) void openChat(replyTo);
  else announce('Harbor identity connected.');
});
connectIdentity.addEventListener('click', openIdentity);
element('existing-identity').addEventListener('click', openIdentity);
refresh.addEventListener('click', () => void loadPosts());
kingSizeButton.addEventListener('click', (event) => {
  cycleKingScale();
  if (event.detail > 0) kingSizeButton.blur();
});
pageButton.addEventListener('click', () => turnPage());
likeButton.addEventListener('click', () => void toggleLike());
async function enterFromWelcome() {
  if (busy) return;
  const name = welcomeName.value.trim();
  if (!name || client?.activeIdentityKey) {
    enter(!game.classList.contains('touch-input'));
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
world.addEventListener('click', (event) => {
  const mouse = event.pointerType
    ? event.pointerType === 'mouse'
    : !game.classList.contains('touch-input');
  if (!busy && (!entered || mouse)) enter(mouse);
});
world.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse')
    dragging = entered && document.pointerLockElement !== world;
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
window.addEventListener('blur', () => {
  keys.clear();
  dragging = false;
  openingReply = false;
  mobile.reset();
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== world) keys.clear();
  else resumePointer = false;
});
function handleLook(deltaX: number, deltaY: number) {
  view.yaw += deltaX * 0.00245;
  view.pitch = Math.max(-1.31, Math.min(1.31, view.pitch - deltaY * 0.00245));
}

function setKingScale(scale: KingScale) {
  kingScale = scale;
  kingSizeButton.textContent = `Size ${scale}×`;
}

function cycleKingScale() {
  if (kingMode)
    setKingScale(
      KING_SCALES[(KING_SCALES.indexOf(kingScale) + 1) % KING_SCALES.length],
    );
}

function jumpHeight(time: number) {
  if (!airborne) return floor;
  const { height, startedAt, speed } = airborne;
  const seconds = Math.max(0, (time - startedAt) / 1000);
  return Math.min(
    80 - EYE_HEIGHT,
    height + speed * seconds - (GRAVITY * seconds ** 2) / 2,
  );
}

function jumpOnce() {
  if (!entered || chatPanel.open || connectPanel.open) return;
  if (!kingMode && airborne) return;
  const startedAt = performance.now();
  airborne = {
    height: Math.max(floor, jumpHeight(startedAt)),
    startedAt,
    speed: kingMode ? JUMP_SPEED * Math.SQRT2 : JUMP_SPEED,
  };
}

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== world && !dragging) return;
  handleLook(event.movementX, event.movementY);
});
window.addEventListener('keydown', (event) => {
  if (openingReply && event.code === 'KeyR' && event.repeat) {
    event.preventDefault();
    return;
  }
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
    event.target instanceof HTMLElement &&
    (event.target.closest('input, textarea, [contenteditable]') ||
      ((event.key === 'Enter' || event.code === 'Space') &&
        event.target.closest('button, a')))
  )
    return;
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) void openChat();
    return;
  }
  if (entered && kingMode && event.code === 'KeyK') {
    event.preventDefault();
    if (!event.repeat) cycleKingScale();
    return;
  }
  if (entered && event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) jumpOnce();
    return;
  }
  if (focusedNotice && ['KeyE', 'KeyR', 'KeyT', 'KeyL'].includes(event.code)) {
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'KeyE') turnPage(event.shiftKey);
    if (event.code === 'KeyR') {
      openingReply = true;
      replyToNotice();
    }
    if (event.code === 'KeyT') thread.click();
    if (event.code === 'KeyL') void toggleLike();
    return;
  }
  if (!renderer || !movement.includes(event.code)) return;
  event.preventDefault();
  if (!entered) enter(false);
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyR') openingReply = false;
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
  const postLocations = STATIONS.slice(0, notices.length).map(([x, z]) => ({
    x,
    z,
  }));
  for (const { drop } of worldPosts.values()) postLocations.push(drop);
  for (const { x, z } of postLocations) {
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
  restorePlacements();
  let previous = performance.now();
  function frame(time: number) {
    requestAnimationFrame(frame);
    if (!renderer) return;
    if (worldPosts.size) prunePlacements(Date.now());
    const dt = Math.min(0.05, (time - previous) / 1000);
    previous = time;
    const exploring = entered && !chatPanel.open && !connectPanel.open;
    const jumpFeet = airborne ? jumpHeight(time) : undefined;
    let feet = jumpFeet;
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
      ({ floor, feet } = walk(
        view,
        keys,
        dt,
        renderer.obstacles,
        notices.length,
        mobile.movement,
        jumpFeet,
        airborne ? view.y - EYE_HEIGHT : floor,
      ));
    }
    if (airborne && feet !== undefined) {
      view.y = Math.max(floor, feet) + EYE_HEIGHT;
      if (time > airborne.startedAt && feet <= floor) airborne = undefined;
      else if (jumpFeet !== undefined && feet < jumpFeet)
        airborne = { height: feet, startedAt: time, speed: 0 };
    } else {
      view.y += (floor + EYE_HEIGHT - view.y) * Math.min(1, dt * 11);
    }
    const extraEyeHeight = kingMode ? EYE_HEIGHT * (kingScale - 1) : 0;
    const camera = { ...view, y: view.y + extraEyeHeight };
    const seconds = time / 1000;
    const noticeIndex = exploring ? facingNotice(camera, notices.length) : -1;
    focusNotice(
      exploring
        ? (facingPlacement(camera, seconds) ?? notices[noticeIndex])
        : undefined,
    );
    const avatars = presence.avatars(time);
    renderer.draw(
      camera,
      seconds,
      avatars,
      [...worldPosts.values()].map(({ drop }) => drop),
      entered && kingMode,
    );
    drawHud(avatars);
  }
  requestAnimationFrame(frame);
}

start();
void loadPosts();

window.setInterval(retryPlacements, 1500);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) retryPlacements();
});
window.setInterval(() => {
  if (entered && !document.hidden) void loadPosts();
}, 12_000);
