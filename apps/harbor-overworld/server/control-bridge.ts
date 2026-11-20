import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { parseControl } from '../src/world/controls.ts';

const PATH = '/__overworld/control';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const LIMIT = 16_384;

function localUrl(request: IncomingMessage) {
  if (
    !request.socket.remoteAddress ||
    !LOOPBACK.has(request.socket.remoteAddress) ||
    !request.headers.host
  )
    return;
  try {
    const base = new URL(`http://${request.headers.host}`);
    if (HOSTS.has(base.hostname)) return new URL(request.url ?? '/', base);
  } catch {
    return;
  }
}

function sameOrigin(request: IncomingMessage) {
  try {
    const origin = new URL(request.headers.origin ?? '');
    return (
      (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      origin.host === request.headers.host
    );
  } catch {
    return false;
  }
}

function respond(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage) {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > LIMIT) throw new Error('Control command is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export const controlBridge: Plugin = {
  name: 'overworld-control-bridge',
  configureServer({ config, httpServer, middlewares }) {
    if (!httpServer || config.mode !== 'playground') return;

    const server = new WebSocketServer({ noServer: true, maxPayload: LIMIT });
    const tabs = new Map<string, WebSocket>();
    const pending = new Map<
      number,
      { socket: WebSocket; finish: (status: number, value: unknown) => void }
    >();
    let nextId = 1;

    httpServer.on('upgrade', (request, socket, head) => {
      if (request.url?.split('?')[0] !== PATH) return;
      const tab = localUrl(request)?.searchParams.get('tab');
      if (!tab || !/^[a-zA-Z0-9_-]{1,32}$/.test(tab) || !sameOrigin(request)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      if (tabs.has(tab)) {
        socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
        return;
      }
      server.handleUpgrade(request, socket, head, (client) => {
        tabs.set(tab, client);
        client.on('error', () => client.terminate());
        client.on('close', () => {
          tabs.delete(tab);
          for (const command of pending.values())
            if (command.socket === client)
              command.finish(503, {
                error: `Playground tab "${tab}" disconnected.`,
              });
        });
        client.on('message', (data, binary) => {
          if (binary) return;
          try {
            const { id, result, error } = JSON.parse(data.toString());
            const command = pending.get(id);
            if (command?.socket !== client) return;
            command.finish(
              typeof error === 'string' ? 422 : 200,
              typeof error === 'string'
                ? { error }
                : { result: result ?? null },
            );
          } catch {
            return;
          }
        });
      });
    });

    middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== PATH) return next();
      if (!localUrl(request) || request.headers.origin)
        return respond(response, 403, {
          error: 'Control requests require the local CLI.',
        });
      if (request.method === 'GET')
        return respond(response, 200, { tabs: [...tabs.keys()].sort() });
      if (
        request.method !== 'POST' ||
        request.headers['content-type'] !== 'application/json'
      )
        return respond(response, 400, {
          error: 'Expected a JSON control command.',
        });

      void (async () => {
        const { tab, name, args } = await readBody(request);
        const command = parseControl(name, args);
        const target =
          tab ?? (tabs.size === 1 ? tabs.keys().next().value : undefined);
        const socket =
          typeof target === 'string' ? tabs.get(target) : undefined;
        if (socket?.readyState !== WebSocket.OPEN) {
          const error =
            tabs.size > 1 && !target
              ? 'Choose a playground tab with --tab.'
              : 'Open a playground tab with ?control=<name>.';
          return respond(response, 404, { error });
        }
        const id = nextId++;
        function finish(status: number, value: unknown) {
          clearTimeout(timer);
          pending.delete(id);
          respond(response, status, value);
        }
        const timer = setTimeout(
          () => finish(504, { error: 'The playground tab did not respond.' }),
          5000,
        );
        pending.set(id, { socket, finish });
        socket.send(JSON.stringify({ id, ...command }));
      })().catch((error: unknown) => {
        respond(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    httpServer.once('close', () => {
      for (const socket of tabs.values()) socket.terminate();
      server.close();
    });
  },
};
