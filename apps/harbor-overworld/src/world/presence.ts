import {
  CROWN_DURATION,
  type CrownLocation,
  displayName,
  HIT_LINES,
  isPose,
  isShotPath,
  isPlacedPost,
  parseMessage,
  PRESENCE_INTERVAL,
  PRESENCE_PATH,
  type NamedPose,
  type PlotSnapshot,
  type Placement,
  type PlacementUpdate,
  type Pose,
  type ChatPost,
  readChat,
  readKingScale,
  type KingScale,
  ROOM_CAPACITY,
  type Shoot,
  type ShotPath,
} from './presence-protocol';

export type Avatar = NamedPose & { id: number; walking: boolean; king?: true };
export type LocalCrown = { location: CrownLocation } | { expiresAt: number };

type Track = {
  from: Pose;
  name?: string;
  chat?: ChatPost;
  to: Pose;
  receivedAt: number;
  walking: boolean;
  king?: true;
  kingScale?: KingScale;
};

function interpolate(track: Track, now: number): Pose {
  const t = Math.min(
    1,
    Math.max(0, (now - track.receivedAt) / PRESENCE_INTERVAL),
  );
  const { from, to } = track;
  const delta = to.yaw - from.yaw;
  const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    yaw: from.yaw + turn * t,
  };
}

function isPlayerId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSlot(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < ROOM_CAPACITY
  );
}

export function createPresence(
  readPose: () => NamedPose,
  onJoin: (slot: number) => void,
  onStatus: (label: string, solo: boolean) => void,
  onPlots: (snapshot: PlotSnapshot) => void,
  onPlacements: (update: PlacementUpdate) => void,
  onCrown: (crown: LocalCrown | undefined) => void,
  onGunshot: (path: ShotPath, ownShot: boolean, line?: number) => void,
  onRespawn: (slot: number) => void,
) {
  const session = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  const tracks = new Map<number, Track>();
  let socket: WebSocket | undefined;
  let sendTimer = 0;
  let reconnectTimer = 0;
  let attempts = 0;
  let started = false;
  let available = false;
  let id: number | undefined;
  let spawnRevision = 0;
  let lastStatus = '';

  function status(value: string, solo = false) {
    if (lastStatus === value) return;
    lastStatus = value;
    onStatus(value, solo);
  }

  function sendPose(connection: WebSocket) {
    if (
      connection.readyState !== WebSocket.OPEN ||
      connection.bufferedAmount > 1024
    )
      return;
    const { x, y, z, yaw, name, chat, kingScale } = readPose();
    connection.send(
      JSON.stringify({
        x,
        y,
        z,
        name,
        chat,
        kingScale,
        spawnRevision,
        yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      }),
    );
  }

  function respawn(value: unknown) {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      value.id !== id ||
      !('slot' in value) ||
      !isSlot(value.slot) ||
      !('spawnRevision' in value) ||
      typeof value.spawnRevision !== 'number' ||
      !Number.isSafeInteger(value.spawnRevision) ||
      value.spawnRevision <= spawnRevision
    )
      return false;
    spawnRevision = value.spawnRevision;
    onRespawn(value.slot);
    return true;
  }

  function open() {
    if (socket) return;
    const url = new URL(PRESENCE_PATH, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('session', session);
    const connection = new WebSocket(url);
    socket = connection;
    status(available ? 'Reconnecting…' : 'Joining room…');

    connection.addEventListener('message', ({ data }) => {
      if (socket !== connection || typeof data !== 'string') return;
      const message = parseMessage(data);
      if (!message || typeof message !== 'object' || !('type' in message))
        return;

      if (
        message.type === 'welcome' &&
        id === undefined &&
        'id' in message &&
        isPlayerId(message.id) &&
        'slot' in message &&
        isSlot(message.slot)
      ) {
        id = message.id;
        attempts = 0;
        if (
          !respawn('respawn' in message ? message.respawn : undefined) &&
          !available
        )
          onJoin(message.slot);
        available = true;
        status('1 player online');
        sendPose(connection);
        sendTimer = window.setInterval(
          () => sendPose(connection),
          PRESENCE_INTERVAL,
        );
        return;
      }

      if (
        id !== undefined &&
        message.type === 'gunshot' &&
        'shooter' in message &&
        isPlayerId(message.shooter) &&
        'path' in message &&
        isShotPath(message.path)
      ) {
        const hit = 'hit' in message ? message.hit : undefined;
        let line: number | undefined;
        if (
          hit &&
          typeof hit === 'object' &&
          'id' in hit &&
          isPlayerId(hit.id)
        ) {
          tracks.delete(hit.id);
          if (
            'line' in hit &&
            typeof hit.line === 'number' &&
            Number.isInteger(hit.line) &&
            hit.line >= 0 &&
            hit.line < HIT_LINES.length
          )
            line = hit.line;
          if (hit.id === id && 'respawn' in hit && respawn(hit.respawn))
            sendPose(connection);
        }
        onGunshot(message.path, message.shooter === id, line);
        return;
      }

      if (
        message.type === 'placements' &&
        'day' in message &&
        typeof message.day === 'string' &&
        'posts' in message &&
        Array.isArray(message.posts)
      ) {
        onPlacements({
          type: 'placements',
          day: message.day,
          posts: message.posts.filter(isPlacedPost),
          live:
            'live' in message && typeof message.live === 'boolean'
              ? message.live
              : undefined,
        });
        return;
      }
      if (
        message.type === 'plots' &&
        'day' in message &&
        typeof message.day === 'string' &&
        'papers' in message &&
        Array.isArray(message.papers)
      ) {
        onPlots({
          type: 'plots',
          day: message.day,
          papers: message.papers.filter(
            (paper): paper is string => typeof paper === 'string',
          ),
        });
        return;
      }

      if (
        id === undefined ||
        message.type !== 'players' ||
        !('players' in message) ||
        !Array.isArray(message.players)
      )
        return;
      const now = performance.now();
      const crown = 'crown' in message ? message.crown : undefined;
      if (
        crown &&
        typeof crown === 'object' &&
        'x' in crown &&
        typeof crown.x === 'number' &&
        Number.isFinite(crown.x) &&
        'z' in crown &&
        typeof crown.z === 'number' &&
        Number.isFinite(crown.z)
      ) {
        onCrown({ location: { x: crown.x, z: crown.z } });
      } else if (
        crown &&
        typeof crown === 'object' &&
        'holder' in crown &&
        crown.holder === id &&
        'remainingMs' in crown &&
        typeof crown.remainingMs === 'number' &&
        crown.remainingMs > 0 &&
        crown.remainingMs <= CROWN_DURATION
      ) {
        onCrown({ expiresAt: now + crown.remainingMs });
      } else {
        onCrown(undefined);
      }
      const present = new Set<number>();
      let online = 1;
      for (const player of message.players) {
        if (
          !isPose(player) ||
          !('id' in player) ||
          !isPlayerId(player.id) ||
          player.id === id
        )
          continue;
        const previous = tracks.get(player.id);
        const distance = previous
          ? Math.hypot(player.x - previous.to.x, player.z - previous.to.z)
          : 0;
        const from =
          previous && distance < 6 ? interpolate(previous, now) : player;
        const king = 'king' in player && player.king === true;
        present.add(player.id);
        if (!('practice' in player && player.practice === true)) online++;
        tracks.set(player.id, {
          from,
          to: player,
          name: 'name' in player ? displayName(player.name) : undefined,
          chat: 'chat' in player ? readChat(player.chat) : undefined,
          king: king ? true : undefined,
          kingScale:
            king && 'kingScale' in player
              ? readKingScale(player.kingScale)
              : undefined,
          receivedAt: now,
          walking: distance > 0.02 && distance < 6,
        });
      }
      for (const playerId of tracks.keys()) {
        if (!present.has(playerId)) tracks.delete(playerId);
      }
      status(online === 1 ? '1 player online' : `${online} players online`);
    });

    connection.addEventListener('close', ({ code }) => {
      if (socket !== connection) return;
      reset();
      if (!available || code === 4001) {
        status('Solo play', true);
        return;
      }
      status('Reconnecting…');
      const delay = Math.min(15_000, 600 * 2 ** attempts++);
      reconnectTimer = window.setTimeout(open, delay);
    });
  }

  function reset() {
    socket = undefined;
    id = undefined;
    spawnRevision = 0;
    onCrown(undefined);
    clearInterval(sendTimer);
    clearTimeout(reconnectTimer);
    tracks.clear();
  }

  window.addEventListener('pagehide', () => {
    const connection = socket;
    reset();
    connection?.close();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && started) open();
  });

  return {
    shoot(aim: Omit<Shoot, 'type'>) {
      if (id === undefined || socket?.readyState !== WebSocket.OPEN)
        return false;
      const yaw = Math.atan2(Math.sin(aim.yaw), Math.cos(aim.yaw));
      socket.send(JSON.stringify({ ...aim, type: 'shoot', yaw }));
      return true;
    },
    place(placement: Placement) {
      if (id === undefined || socket?.readyState !== WebSocket.OPEN)
        return false;
      socket.send(JSON.stringify(placement));
      return true;
    },
    join() {
      if (started) return;
      started = true;
      open();
    },
    avatars(now: number): Avatar[] {
      return [...tracks.entries()].map(([id, track]) => ({
        id,
        walking: track.walking,
        name: track.name,
        chat: track.chat,
        king: track.king,
        kingScale: track.kingScale,
        ...interpolate(track, now),
      }));
    },
  };
}
