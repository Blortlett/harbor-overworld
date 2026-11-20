import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { HttpServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  displayName,
  isPose,
  parseMessage,
  PRESENCE_INTERVAL,
  PRESENCE_PATH,
  type NamedPose,
  type PresenceMessage,
  readChat,
  ROOM_CAPACITY,
} from '../src/world/presence-protocol.ts';

const IDLE_MS = 20_000;
const MAX_QUEUED_BYTES = 64 * 1024;

type Client = {
  ws: WebSocket;
  id: number;
  slot: number;
  pose?: NamedPose;
  updatedAt: number;
};

function sameHost(request: IncomingMessage) {
  try {
    const origin = new URL(request.headers.origin ?? '');
    return (
      (origin.protocol === 'https:' || origin.protocol === 'http:') &&
      origin.host === request.headers.host
    );
  } catch {
    return false;
  }
}

export function attachPresence(http: HttpServer) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 1536 });
  const clients = new Map<string, Client>();
  let nextId = 1;

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const [path, query] = (request.url ?? '').split('?');
    if (path !== PRESENCE_PATH) return;
    const session = new URLSearchParams(query).get('session');
    if (!session || !/^[a-f0-9]{32}$/.test(session)) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!sameHost(request)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const previous = clients.get(session);
    if (!previous && clients.size >= ROOM_CAPACITY) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    server.handleUpgrade(request, socket, head, (ws) => {
      const occupied = new Set(
        [...clients.values()].map((client) => client.slot),
      );
      let slot = 0;
      while (occupied.has(slot)) slot++;
      const client: Client = {
        ws,
        id: previous?.id ?? nextId++,
        slot: previous?.slot ?? slot,
        pose: previous?.pose,
        updatedAt: performance.now(),
      };
      clients.set(session, client);
      previous?.ws.close(4001, 'Connection replaced');
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        if (clients.get(session) === client) clients.delete(session);
      });
      ws.on('message', (data, binary) => {
        const now = performance.now();
        if (
          binary ||
          (client.pose && now - client.updatedAt < PRESENCE_INTERVAL / 2)
        )
          return;
        const message = parseMessage(data.toString());
        if (!isPose(message)) return;
        const { x, y, z, yaw } = message;
        client.pose = {
          x,
          y,
          z,
          yaw,
          name: 'name' in message ? displayName(message.name) : undefined,
          chat: 'chat' in message ? readChat(message.chat) : undefined,
        };
        client.updatedAt = now;
      });
      const welcome: PresenceMessage = {
        type: 'welcome',
        id: client.id,
        slot: client.slot,
      };
      ws.send(JSON.stringify(welcome));
    });
  }

  http.on('upgrade', upgrade);
  const timer = setInterval(() => {
    const now = performance.now();
    const players = [];
    for (const [session, client] of clients) {
      const { ws } = client;
      if (
        now - client.updatedAt > IDLE_MS ||
        ws.bufferedAmount > MAX_QUEUED_BYTES
      ) {
        clients.delete(session);
        ws.terminate();
      } else if (client.pose) {
        players.push({ id: client.id, ...client.pose });
      }
    }
    if (!clients.size) return;
    const snapshot: PresenceMessage = { type: 'players', players };
    const data = JSON.stringify(snapshot);
    for (const { ws } of clients.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }, PRESENCE_INTERVAL);
  timer.unref();

  http.once('close', () => {
    clearInterval(timer);
    http.off('upgrade', upgrade);
    for (const { ws } of clients.values()) ws.terminate();
    clients.clear();
    server.close();
  });
}
