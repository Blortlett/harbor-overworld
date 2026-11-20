# Harbor Overworld

Live Harbor posts appear on wooden noticeboards. Posts and replies published
from Overworld also drop as Harbor post cards at your position. Step back to
read the card, reply, or open the thread. Everyone in the room sees the fall
and its landing coordinates on screen. The card disappears after one minute.

Walk with WASD, look with the mouse, jump with Space, turn pages with E, reply
with R, and open chat with Enter. On a touchscreen, use the joystick to move,
drag the scene to look, and tap Jump or Chat. The fullscreen button appears
when your browser supports fullscreen.

## Run locally

Download the [release archive](https://github.com/SomewhatJustin/harbor-overworld/releases/latest/download/harbor-overworld.tar.gz)
into your current directory. Extract it and start a loopback-only server with
Python 3.

```sh
mkdir -p harbor-overworld-local
tar -xzf harbor-overworld.tar.gz -C harbor-overworld-local
python3 -m http.server 4173 --bind 127.0.0.1 --directory harbor-overworld-local
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/) in a browser.
Live posts and identity pairing still use the Harbor production network.
Press Ctrl+C in the terminal to stop the server.

## Test multiplayer locally

Build the workspace dependencies and Overworld using the source commands
below, then start the local preview.

```sh
pnpm --filter harbor-overworld preview --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/` in two desktop browser windows and select
**Enter world** in both. Both windows should show **2 players online**.
Walk in one window to see its avatar move in the other. Everyone who enters
the same preview joins one room of up to 24 players.

The presence server keeps up to 16 production posts on shared noticeboards,
which clear at 3 a.m. Central. Posts made in Overworld stay at their landing
coordinates for one minute. The public Harbor posts stay in their threads.
The standalone presence server saves the room state to a temporary file by default. Set
`OVERWORLD_PLOTS_FILE` to a writable path on a persistent volume to keep
them across container replacements.

## Deploy the release on your hardware

1. Download [harbor-overworld.tar.gz](https://github.com/SomewhatJustin/harbor-overworld/releases/latest/download/harbor-overworld.tar.gz).
   Extract it into a dedicated web root. The archive has `index.html`,
   `assets/`, and `licenses.txt` at its root.

   ```sh
   curl -fL https://github.com/SomewhatJustin/harbor-overworld/releases/latest/download/harbor-overworld.tar.gz -o /tmp/harbor-overworld.tar.gz
   mkdir -p /srv/harbor-overworld
   tar -xzf /tmp/harbor-overworld.tar.gz -C /srv/harbor-overworld
   ```

2. Serve that directory at the root of an HTTPS hostname. Point the hostname at
   the host and use the existing HTTPS server if available. A minimal Caddy
   configuration looks like this. Replace the hostname with your own.

   ```caddyfile
   play.example.com {
       root * /srv/harbor-overworld
       encode zstd gzip
       file_server
   }
   ```

3. Open the HTTPS URL in a desktop browser. The indicator in the top right
   should show **PRODUCTION** and a live post count. Check that **Connect Harbor
   identity** opens the pairing dialog. Close it, select **Enter world**, and
   walk toward a lantern to read its noticeboard. Share the root URL.

Visitors can explore as guests, pick a display name to create an identity,
or connect using a pairing link or code from their Harbor app. They approve the browser in Harbor. A backup file also works.
The browser saves the connected identity for this hostname. All Harbor traffic
goes directly from the browser to the production network. The host serves only
static files.

## Production multiplayer

Use `overworld-site` and `overworld-presence` from the **same** successful
Build Harbor Overworld Actions run. Serve the site as above. Extract the
presence ZIP outside the web root and run `node server.mjs` under a service
supervisor with Node 22. No package install is needed. Each process hosts
one in-memory room; run one instance and keep TCP 8080 private.

The server listens on `0.0.0.0:8080`. Check it locally with
`curl -fsS http://127.0.0.1:8080/healthz`. Add this directive inside the
site's Caddy block (or use the equivalent WebSocket proxy on your server):

```caddyfile
reverse_proxy /presence 127.0.0.1:8080
```

Forward the query string, upgrade headers, original Host and Origin. Clients
connect through the site's HTTPS hostname, not directly to port 8080. Open
two windows and confirm movement as in the local multiplayer check above.

## Build from source

Use the repository's Node and pnpm versions and the
[Rust/WASM toolchain](../../docs/content/developer/setup.md). From the fork root:

```sh
pnpm install --filter harbor-overworld... --frozen-lockfile
pnpm --filter @polycentric/rs-core-wasm build --profile wasm-release
pnpm --filter @polycentric/js-core generate
pnpm --filter @polycentric/js-core build
pnpm --filter @polycentric/js-browser build
pnpm --filter harbor-overworld typecheck
pnpm --filter harbor-overworld build
```

The static output is `apps/harbor-overworld/dist/`. Use
`pnpm --filter harbor-overworld preview` to preview that build locally.

Harbor Overworld modifies the Harbor web client for a noncommercial game.
The release includes the [app license](../LICENSE.md) and
[repository and SDK license](../../LICENSE) in `licenses.txt`.
