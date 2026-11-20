#!/usr/bin/env bash
set -euo pipefail

rustup toolchain install 1.100.0 --profile minimal --target wasm32-unknown-unknown
rustup override set 1.100.0
sudo apt-get update -qq
sudo apt-get install -y protobuf-compiler
archive=wasm-bindgen-0.2.130-x86_64-unknown-linux-musl
cd "$RUNNER_TEMP"
curl --fail --location --retry 3 -o "$archive.tar.gz" "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.130/$archive.tar.gz"
echo "9687f3bb551b9f66f37ed32a40d7913a00f7962db653054e56857bc306c3227f  $archive.tar.gz" | sha256sum --check
tar -xzf "$archive.tar.gz" -C "$HOME/.cargo/bin" --strip-components=1 "$archive/wasm-bindgen"
