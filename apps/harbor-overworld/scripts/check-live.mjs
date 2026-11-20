import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const [, , site, commit, waitOption] = process.argv;
if (
  !site ||
  !commit ||
  (commit !== '--room-only' && !/^[a-f0-9]{40}$/.test(commit))
) {
  throw new Error(
    'Usage: check-live.mjs SITE COMMIT|--room-only [--wait=SECONDS]',
  );
}
const origin = new URL(site).origin;
const deadline = Date.now() + 1000 * Number(waitOption?.split('=')[1] ?? 0);

async function waitForBuild() {
  const url = new URL('/build.json', origin);
  let observed;
  do {
    try {
      url.searchParams.set('check', String(Date.now()));
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(5000),
      });
      observed = response.ok
        ? (await response.json()).commit
        : `HTTP ${response.status}`;
      if (observed === commit) return;
    } catch (error) {
      observed = error.message;
    }
    if (Date.now() < deadline) await delay(2000);
  } while (Date.now() < deadline);
  throw new Error(`Expected ${commit} at ${origin}, last observed ${observed}`);
}

async function checkRoom() {
  const url = new URL('/presence', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const peers = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Room check timed out. Joined ${peers.filter((peer) => peer.id).length}/2 clients, ` +
                `with ${peers.filter((peer) => peer.papers?.length).length}/2 populated noticeboard snapshots. ` +
                `Room builds: ${peers.map((peer) => peer.commit ?? 'unknown').join(', ')}.`,
            ),
          ),
        15_000,
      );
      function finish(error) {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }
      for (const x of [0.5, 1.5]) {
        url.searchParams.set('session', randomBytes(16).toString('hex'));
        const socket = new WebSocket(url, { headers: { Origin: origin } });
        const peer = { socket };
        peers.push(peer);
        socket.addEventListener('error', () =>
          finish(new Error('Could not connect to the presence room')),
        );
        socket.addEventListener('close', () =>
          finish(new Error('Presence socket closed')),
        );
        socket.addEventListener('message', ({ data }) => {
          const message = JSON.parse(data);
          if (message.type === 'welcome') {
            peer.id = message.id;
            peer.commit = message.commit;
            socket.send(JSON.stringify({ x, y: 5, z: 12, yaw: 0 }));
          } else if (message.type === 'players') {
            peer.players = message.players;
          } else if (message.type === 'plots' && message.papers.length) {
            peer.papers = message.papers;
          }
          if (
            peers.length === 2 &&
            peers[0].id !== peers[1].id &&
            peers.every(
              (current) =>
                current.id &&
                (commit === '--room-only' || current.commit === commit) &&
                current.papers?.[0] &&
                current.papers[0] === peers[0].papers?.[0] &&
                peers.every((other) =>
                  current.players?.some((player) => player.id === other.id),
                ),
            )
          )
            finish();
        });
      }
    });
    console.log(
      `Two players joined the same room and received ${peers[0].papers.length} noticeboard posts.`,
    );
  } finally {
    for (const { socket } of peers) socket.close();
  }
}

if (commit !== '--room-only') {
  await waitForBuild();
  console.log(`${origin} is serving ${commit}.`);
}
for (;;) {
  try {
    await checkRoom();
    break;
  } catch (error) {
    if (Date.now() >= deadline) throw error;
    await delay(2000);
  }
}
