#!/usr/bin/env bash
set -euo pipefail

output=$(realpath -m "${1:?release directory}")
commit=${2:?commit SHA}
app=$(cd "$(dirname "$0")/.." && pwd)
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
mkdir -p "$output"
test -s "$app/dist/index.html"
test -s "$app/dist-presence/server.mjs"
presence_hash=$(sha256sum "$app/dist-presence/server.mjs" | cut -d ' ' -f 1)
printf '{"commit":"%s","presenceSha256":"%s"}\n' "$commit" "$presence_hash" > "$app/dist/build.json"
cp "$app/dist/build.json" "$output/build.json"
tar -czf "$output/harbor-overworld.tar.gz" -C "$app/dist" .
(
  cd "$app/dist-presence"
  zip -q -j - "$PWD/server.mjs" > "$output/harbor-overworld-presence.zip"
)
