#!/usr/bin/env bash
# curl_cffi (used by garminconnect for browser-impersonating Garmin requests)
# needs libstdc++.so.6 on LD_LIBRARY_PATH. The Nix Python doesn't expose it by
# default, and nixpacks `nixLibs` doesn't set it at runtime. Resolve the Nix gcc
# lib dir at boot (so we never hardcode a store hash) and export it before
# launching — the Python MCP subprocess inherits this env.
libdir="$(dirname "$(find /nix/store -name 'libstdc++.so.6' 2>/dev/null | head -1)")"
if [ -n "$libdir" ]; then
  export LD_LIBRARY_PATH="${libdir}:${LD_LIBRARY_PATH:-}"
fi
exec npm start
