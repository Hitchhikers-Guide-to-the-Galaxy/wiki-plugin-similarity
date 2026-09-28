#!/bin/sh
# Build the Rust core (similarity-core) as WebAssembly into server/.
# The core lives in its own repo; CORE points at a checkout of it.
set -e
CORE=${CORE:-$HOME/Code/similarity-core}
HERE=$(cd "$(dirname "$0")/.." && pwd)
(cd "$CORE/wasm" && cargo build --release --target wasm32-wasip1)
cp "$CORE/wasm/target/wasm32-wasip1/release/similarity_wasm.wasm" "$HERE/server/similarity-core.wasm"
echo "server/similarity-core.wasm: $(wc -c < "$HERE/server/similarity-core.wasm") bytes from $(cd "$CORE" && git rev-parse --short HEAD)$(cd "$CORE" && git diff --quiet || echo '+dirty')"
