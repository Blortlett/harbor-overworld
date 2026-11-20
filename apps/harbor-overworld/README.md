# Harbor Overworld

Overworld is a desktop browser game. Live Harbor posts appear on wooden
noticeboards. Walk with WASD, look with the mouse, turn pages with E, reply
with R, and open chat with Enter.

## Run locally

Download the [release archive](https://github.com/SomewhatJustin/harbor-overworld/releases/latest/download/harbor-overworld.tar.gz)
into your current directory. Extract it and start a loopback-only server with
Python 3.

```sh
mkdir -p harbor-overworld-local
tar -xzf harbor-overworld.tar.gz -C harbor-overworld-local
python3 -m http.server 4173 --bind 127.0.0.1 --directory harbor-overworld-local
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/) in a desktop browser.
Live posts and identity pairing still use the Harbor production network.
Press Ctrl+C in the terminal to stop the server.

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

Visitors can explore as guests or connect using a pairing link or code from
their Harbor app. They approve the browser in Harbor. A backup file also works.
The browser saves the connected identity for this hostname. All Harbor traffic
goes directly from the browser to the production network. The host serves only
static files.

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
