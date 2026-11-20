import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { HttpServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  displayName,
  isPlacement,
  isPose,
  isProof,
  parseMessage,
  PRESENCE_INTERVAL,
  PRESENCE_PATH,
  type NamedPose,
  type PresenceMessage,
  readChat,
  ROOM_CAPACITY,
} from '../src/world/presence-protocol.ts';
import { verifyKing } from './king.ts';
import { createPlots } from './plots.ts';

const IDLE_MS = 20_000;
const MAX_QUEUED_BYTES = 64 * 1024;

type Client = {
  ws: WebSocket;
  id: number;
  slot: number;
  pose?: NamedPose;
  updatedAt: number;
  nextPlacement: number;
  nextProof: number;
  proof?: string;
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

export function attachPresence(http: HttpServer, plotsFile?: string) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 1536 });
  const clients = new Map<string, Client>();
  let nextId = 1;
  let king: Client | undefined;

  function broadcast(snapshot: PresenceMessage) {
    const message = JSON.stringify(snapshot);
    for (const { ws } of clients.values())
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }
  const plots = createPlots(plotsFile, broadcast, (day, post) => {
    broadcast({ type: 'placements', day, posts: [post], live: true });
  });

  function setKing(client: Client, enabled: boolean) {
    if (enabled) {
      if (king && king !== client) setKing(king, false);
      king = client;
    } else if (king === client) {
      king = undefined;
    }
    if (client.ws.readyState === WebSocket.OPEN)
      client.ws.send(JSON.stringify({ type: 'king', enabled }));
  }

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
      const nonce = randomBytes(32).toString('hex');
      const client: Client = {
        ws,
        id: previous?.id ?? nextId++,
        slot: previous?.slot ?? slot,
        pose: previous?.pose,
        updatedAt: performance.now(),
        nextPlacement: 0,
        nextProof: 0,
      };
      clients.set(session, client);
      previous?.ws.close(4001, 'Connection replaced');
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        if (clients.get(session) === client) clients.delete(session);
        if (king === client) king = undefined;
      });
      ws.on('message', (data, binary) => {
        if (binary || clients.get(session) !== client) return;
        const now = performance.now();
        const message = parseMessage(data.toString());
        if (isPlacement(message)) {
          if (now < client.nextPlacement) return;
          client.nextPlacement = now + 1000;
          void plots.place(message).then((post) => {
            if (!post || ws.readyState !== WebSocket.OPEN) return;
            const { day } = plots.placements();
            ws.send(
              JSON.stringify({
                type: 'placements',
                day,
                posts: [post],
                live: false,
              }),
            );
          });
          return;
        }
        if (
          message &&
          typeof message === 'object' &&
          'type' in message &&
          message.type === 'king'
        ) {
          if ('enabled' in message && message.enabled === false) {
            client.proof = undefined;
            if (king === client) setKing(client, false);
          } else if (
            now >= client.nextProof &&
            'key' in message &&
            typeof message.key === 'string' &&
            /^[a-f0-9]{64}$/.test(message.key) &&
            'proof' in message &&
            isProof(message.proof) &&
            client.proof !== message.proof
          ) {
            client.nextProof = now + 6000;
            const proof = message.proof;
            client.proof = proof;
            void verifyKing(nonce, message.key, proof)
              .catch(() => false)
              .then((enabled) => {
                if (clients.get(session) === client && client.proof === proof) {
                  if (!enabled) client.proof = undefined;
                  setKing(client, enabled);
                }
              });
          }
          return;
        }
        if (client.pose && now - client.updatedAt < PRESENCE_INTERVAL / 2)
          return;
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
        nonce,
      };
      ws.send(JSON.stringify(welcome));
      const { day, posts } = plots.placements();
      const plotState = plots.snapshot();
      if (plotState) ws.send(JSON.stringify(plotState));
      for (const post of posts) {
        ws.send(
          JSON.stringify({
            type: 'placements',
            day,
            posts: [post],
            live: false,
          }),
        );
      }
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
        players.push({
          id: client.id,
          ...client.pose,
          king: client === king ? (true as const) : undefined,
        });
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
    plots.close();
    http.off('upgrade', upgrade);
    for (const { ws } of clients.values()) ws.terminate();
    clients.clear();
    server.close();
  });
}
