#!/usr/bin/env bash
# Installs the Emscripten version pinned in the codec repository's
# .emsdk-version into ~/emsdk. Run it from the codec repository's root.
# Afterwards: source ~/emsdk/emsdk_env.sh
# Usage: scripts/ci/setup-emsdk.sh [version-file]   (default: .emsdk-version)
set -euo pipefail
version="$(cat "${1:-.emsdk-version}")"
if [ ! -d "$HOME/emsdk" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$HOME/emsdk"
fi
"$HOME/emsdk/emsdk" install "$version"
"$HOME/emsdk/emsdk" activate "$version"
