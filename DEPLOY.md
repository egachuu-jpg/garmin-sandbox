# Deployment Guide — Garmin Coach

## What you need before starting
- [Railway account](https://railway.com) (Hobby plan, ~$5/month)
- This repository pushed to GitHub
- Your Garmin Connect credentials (email + password)
- An [Anthropic API key](https://console.anthropic.com)
- A passphrase you'll use to log into the app on your phone

Estimated time: 30–45 minutes.

---

## Step 1 — Create the Railway project

1. Go to [railway.com](https://railway.com) → **New Project**
2. Choose **Deploy from GitHub repo** → select `garmin-sandbox`
3. Select the branch: `main`
4. Railway will detect the `nixpacks.toml` and start an initial build. Let it run — it will fail the first time because env vars aren't set yet. That's fine.

---

## Step 2 — Add PostgreSQL

1. Inside your Railway project, click **+ New** → **Database** → **Add PostgreSQL**
2. The Postgres service exposes its own `DATABASE_URL`. Your **app** service needs a reference to it: in the app service → **Variables**, add `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}` (use the reference picker; adjust the name if your DB service isn't called `Postgres`).

> ⚠️ Do **not** paste the placeholder from `.env.example` (`...@host:5432/dbname`) — that overrides the real connection string and the app will fail with `getaddrinfo ENOTFOUND host`.

---

## Step 3 — Set environment variables

In your Railway service, go to **Variables** and add these:

| Variable | Value |
|---|---|
| `APP_PASSPHRASE` | Any strong passphrase — this is your login to the app |
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-...`) |
| `NODE_ENV` | `production` |
| `GARMINTOKENS` | `/root/.garmin-mcp` (where the Python MCP caches its Garmin tokens — must be on the volume, see Step 4) |

> `DATABASE_URL` is already set automatically by the PostgreSQL plugin.

After saving variables, Railway will trigger a new deploy. Wait for it to go green (the build installs both Node.js and Python dependencies).

---

## Step 4 — Add a Volume for Garmin token persistence

The Garmin MCP caches its OAuth tokens to disk, and Railway's filesystem resets on each deploy — so the tokens must live on a persistent volume. Set `GARMINTOKENS` (Step 3) to the volume mount path so the Python MCP reads/writes there. One login then survives all future deploys.

1. In your Railway project, click your service → **Volumes** tab → **Add Volume**
2. Set the **Mount Path** to `/root/.garmin-mcp`
3. Railway will redeploy automatically

> Without this volume (plus the `GARMINTOKENS` var), you'd need to re-authenticate with Garmin after every deploy.

---

## Step 5 — Run the database migration

After the deploy is green:

1. In Railway, go to your service → **Settings** → scroll to **Deploy** → click **Railway Shell** (or use the Railway CLI: `railway shell`)
2. Run:
   ```bash
   npm run db:migrate
   ```
   This creates the `conversations`, `messages`, `gear`, and `activity_gear` tables.

You should see output like `CREATE TABLE`, `CREATE INDEX` — no errors.

---

## Step 6 — Authenticate with Garmin (one-time MFA setup)

You need one interactive login to complete Garmin's MFA challenge and cache OAuth tokens to the volume.

> **`curl_cffi` / `libstdc++`:** Garmin blocks plain-`requests` logins (403/429), so `garminconnect` uses `curl_cffi` to impersonate a browser. `curl_cffi`'s native extension needs `libstdc++.so.6`, which the Nix Python doesn't expose by default — `nixLibs = ["pkgs.stdenv.cc.cc.lib"]` in `nixpacks.toml` puts it on `LD_LIBRARY_PATH`. If a login ever fails with `ImportError: libstdc++.so.6`, set it manually for the command:
> ```bash
> export LD_LIBRARY_PATH="$(dirname "$(find /nix/store -name 'libstdc++.so.6' | head -1)")"
> ```

In the Railway shell (`GARMIN_EMAIL` / `GARMIN_PASSWORD` are already in the env):

```bash
/opt/venv/bin/garmin-mcp-auth
```
(equivalently: `/opt/venv/bin/python -m garmin_mcp.auth_cli`). The Python MCP is installed in a venv at `/opt/venv` — see `nixpacks.toml`. Enter your MFA code when prompted. Because `GARMINTOKENS=/root/.garmin-mcp` (Step 3), tokens are written to the volume as `garmin_tokens.json`.

Confirm both token files landed:
```bash
ls -la /root/.garmin-mcp/   # expect garmin_tokens.json
```

You won't need to repeat this unless the tokens expire (~6 months) or you change your Garmin password.

---

## Step 7 — Verify the deployment

1. In Railway, copy your service's public URL (under **Settings** → **Networking** → **Generate Domain** if you haven't already)
2. Open it in a browser — you should see the login screen
3. Enter your `APP_PASSPHRASE` — you should land on the Home screen
4. Tap **Chat** → try asking: *"What's today's date and can you check my training readiness?"*
5. You should see tool-call chips appear as Claude fetches Garmin data

If tools fail with connection errors, see the Troubleshooting section below.

---

## Step 8 — Add to iPhone home screen (PWA)

1. Open your Railway URL in **Safari** on your iPhone
2. Log in with your passphrase
3. Tap the **Share** button (box with arrow pointing up)
4. Scroll down and tap **Add to Home Screen**
5. Name it `Coach` → tap **Add**

It will appear on your home screen as a standalone app with no browser chrome. The app is designed for this — full screen, safe area padding, large touch targets.

---

## Step 9 — (Optional) Custom domain

In Railway → your service → **Settings** → **Networking** → **Custom Domain**, add your own domain (e.g., `coach.yourdomain.com`). Update your DNS with the CNAME Railway provides.

---

## Troubleshooting

**Build fails: `pip: not found` or `npm: not found`**
> Make sure `nixpacks.toml` is committed to the branch you're deploying. Verify it contains `providers = ["python", "node"]`.

**App loads but chat shows "MCP server unavailable"**
> The Garmin MCPs didn't start. Check that:
> 1. MFA login was completed (Step 6)
> 2. The volume is mounted at `/root/.garmin-mcp` and `GARMINTOKENS=/root/.garmin-mcp` is set
> 3. Token file exists: in Railway shell, run `ls /root/.garmin-mcp/` (expect `garmin_tokens.json`)

**Chat works but workout creation fails**
> The Taxuspt MCP (Python) handles workout writes. Re-run `/opt/venv/bin/garmin-mcp-auth` in the Railway shell to refresh the shared tokens (they land in `/root/.garmin-mcp`).

**"Invalid passphrase" on login**
> Double-check `APP_PASSPHRASE` in Railway variables. Note: it's case-sensitive and whitespace-sensitive.

**Database errors on first chat**
> You likely skipped Step 5. Run `npm run db:migrate` in the Railway shell.

**Tokens expired after a few weeks**
> Garmin OAuth tokens expire periodically. Re-run Step 6 in the Railway shell to refresh them. Your volume keeps old tokens until overwritten.

---

## Updating the app

Push to the branch and Railway auto-deploys. The Volume persists — no need to redo the MFA setup after a normal code update.

```bash
git push origin main
```

> **After a deploy that changes the database schema** (e.g. the `coach_memory` table), re-run the migration in the Railway shell — it's idempotent (`CREATE TABLE IF NOT EXISTS`):
> ```bash
> npm run db:migrate
> ```

---

## Cost estimate

| Service | Cost |
|---|---|
| Railway Hobby plan | ~$5/month |
| Railway PostgreSQL | ~$0–2/month (small DB) |
| Railway Volume (1GB) | ~$0.25/month |
| Anthropic API | ~$1–5/month depending on usage |
| **Total** | **~$7–12/month** |
