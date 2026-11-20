import { createServer } from 'node:http';
import { PRESENCE_PATH } from '../src/world/presence-protocol.ts';
import { attachPresence } from './presence.ts';

const http = createServer((request, response) => {
  const healthy = request.method === 'GET' && request.url === '/healthz';
  response.writeHead(healthy ? 200 : 404, { 'Content-Type': 'text/plain' });
  response.end(healthy ? 'ok\n' : 'not found\n');
});
// Unlike Vite, the standalone server has no other upgrade handlers.
http.on('upgrade', (request, socket) => {
  if (request.url?.split('?')[0] !== PRESENCE_PATH) socket.destroy();
});
attachPresence(http);
http.listen(8080, '0.0.0.0', () =>
  console.log('Presence listening on 0.0.0.0:8080'),
);
