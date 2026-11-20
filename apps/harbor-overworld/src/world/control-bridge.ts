import type { GameControls } from './controls';

export function connectControlBridge(controls: GameControls) {
  const label = new URLSearchParams(location.search).get('control');
  if (!label || !/^[a-zA-Z0-9_-]{1,32}$/.test(label)) return;

  const url = new URL('/__overworld/control', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('tab', label);

  let socket: WebSocket | undefined;
  let retry: number | undefined;
  function open() {
    const connection = new WebSocket(url);
    socket = connection;
    connection.addEventListener('message', async ({ data }) => {
      if (socket !== connection || typeof data !== 'string') return;
      const { id, name, args } = JSON.parse(data);
      try {
        const result = await controls.dispatch(name, args);
        if (connection.readyState === WebSocket.OPEN)
          connection.send(JSON.stringify({ id, result: result ?? null }));
      } catch (error) {
        if (connection.readyState === WebSocket.OPEN)
          connection.send(
            JSON.stringify({
              id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      }
    });
    connection.addEventListener('close', () => {
      if (socket !== connection) return;
      controls.dispatch('stop', []);
      retry = window.setTimeout(open, 1000);
    });
  }

  open();
  window.addEventListener('pagehide', () => {
    const connection = socket;
    socket = undefined;
    clearTimeout(retry);
    connection?.close();
    controls.release();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && !socket) open();
  });
}
