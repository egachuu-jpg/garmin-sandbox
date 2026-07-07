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
# Apply the DB schema on every boot. db/schema.sql is idempotent (CREATE TABLE
# IF NOT EXISTS + ALTER ... ADD COLUMN IF NOT EXISTS), so this is a no-op when
# nothing changed — and it means a fresh or lagging database can never serve
# "relation does not exist" errors after a deploy. If the DB is briefly
# unreachable, log loudly but still start: the Garmin-backed screens work
# without Postgres, and the next deploy/restart retries.
if ! node db/migrate.js; then
  echo "WARNING: db migration failed — starting anyway; DB-backed routes will error until it succeeds." >&2
fi

# Bind to the port Railway provides (falls back to 3000 for local runs) so we
# never depend on a manual port setting in the Railway dashboard.
exec npm start -- -p "${PORT:-3000}"
