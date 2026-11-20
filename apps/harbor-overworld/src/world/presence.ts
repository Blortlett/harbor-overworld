import {
  displayName,
  isPose,
  parseMessage,
  PRESENCE_INTERVAL,
  PRESENCE_PATH,
  type NamedPose,
  type PlotSnapshot,
  type Pose,
  type ChatPost,
  readChat,
  ROOM_CAPACITY,
} from './presence-protocol';

export type Avatar = NamedPose & { id: number; walking: boolean };

type Track = {
  from: Pose;
  name?: string;
  chat?: ChatPost;
  to: Pose;
  receivedAt: number;
  walking: boolean;
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

export function createPresence(
  readPose: () => NamedPose,
  onJoin: (slot: number) => void,
  onStatus: (label: string) => void,
  onPlots: (snapshot: PlotSnapshot) => void,
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
  let lastStatus = '';

  function status(value: string) {
    if (lastStatus === value) return;
    lastStatus = value;
    onStatus(value);
  }

  function sendPose(connection: WebSocket) {
    if (
      connection.readyState !== WebSocket.OPEN ||
      connection.bufferedAmount > 1024
    )
      return;
    const { x, y, z, yaw, name, chat } = readPose();
    connection.send(
      JSON.stringify({
        x,
        y,
        z,
        name,
        chat,
        yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      }),
    );
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
        typeof message.slot === 'number' &&
        Number.isInteger(message.slot) &&
        message.slot >= 0 &&
        message.slot < ROOM_CAPACITY
      ) {
        id = message.id;
        attempts = 0;
        if (!available) onJoin(message.slot);
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
      const present = new Set<number>();
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
        present.add(player.id);
        tracks.set(player.id, {
          from,
          to: player,
          name: 'name' in player ? displayName(player.name) : undefined,
          chat: 'chat' in player ? readChat(player.chat) : undefined,
          receivedAt: now,
          walking: distance > 0.02 && distance < 6,
        });
      }
      for (const playerId of tracks.keys()) {
        if (!present.has(playerId)) tracks.delete(playerId);
      }
      status(
        tracks.size ? `${tracks.size + 1} players online` : '1 player online',
      );
    });

    connection.addEventListener('close', ({ code }) => {
      if (socket !== connection) return;
      reset();
      if (!available || code === 4001) {
        status('Solo play');
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
        ...interpolate(track, now),
      }));
    },
  };
}
