# IMS13 Yearbook — Deployment Runbook (Railway)

The Builder NEVER deploys. A human performs deployment and verifies production (Gate 5).

## Production invariants (enforced by src/config/env.js at boot)

| Setting | Production requirement | Why |
|---|---|---|
| `NODE_ENV` | `production` (unset also fails safe to production rules) | cannot silently bypass invariants |
| `STORAGE_DRIVER` | `r2` | local `/uploads` is ephemeral on Railway |
| R2 vars | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | object storage creds |
| `SESSION_STORE` | `sql` | file/memory sessions are not persistent |
| `DB_DRIVER` | `sql` + `DB_URL` | JSON metadata is dev-only |
| `SESSION_SECRET` | >= 32 random chars | session signing |
| `GOOGLE_*` | client id/secret + production callback URL | OAuth |
| `ADMIN_EMAILS` | admin Google email(s) | upload authorization |

Boot REFUSES to start if any invariant is violated — this is the persistence guarantee.

## Build & start (railway.json)

```
buildCommand: npm install --include=dev --no-audit --no-fund && npm run build:check && npm prune --omit=dev
startCommand: npm start
healthcheck:  GET /health (30s timeout)
restart:      ON_FAILURE, max 3
```

Why: `npm install --include=dev` uses the lockfile while keeping Railway's cached
`node_modules` intact; this avoids the `EBUSY node_modules/.cache` failure from `npm ci`
and guarantees `build:check` has Biome available even when Railway sets a production
npm config. `--no-audit --no-fund` removes unrelated network work, then
`npm prune --omit=dev` slims the runtime image. No system `libvips` packages are
configured — Sharp ships prebuilt binaries; add an apt package ONLY if the Railway
build log proves a libvips/linking failure (then rebuild and record it here).

## Deploy steps (human)

1. Push `feat/foundation` (or merged `main`) to GitHub — PR only, never direct push to main.
2. Railway: New Project → Deploy from GitHub repo.
3. Add a PostgreSQL database plugin (Railway Postgres) → copy `DATABASE_PUBLIC_URL` into `DB_URL`.
4. Create a Cloudflare R2 bucket + API token; fill `R2_*` variables; set `R2_PUBLIC_BASE_URL`
   to the bucket's public CDN URL (or keep files app-served and leave it empty).
5. Google Cloud Console: OAuth client (Web) with redirect
   `https://<your-railway-domain>/auth/google/callback`; fill `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`.
6. Set remaining env vars from `.env.example` (all of them; no real secrets in git).
7. Deploy. Railway waits for `GET /health` → 200.

## Post-deploy verification (Gate 5 checklist)

- [ ] `GET /health` → 200 `{"status":"ok","env":"production"}`
- [ ] Public gallery loads with photos (uploads stored in R2, not local disk)
- [ ] Google sign-in works with the production callback URL
- [ ] Non-admin sign-in cannot reach `/admin.html` functions (401/403)
- [ ] Admin upload succeeds; image served from R2/CDN URL
- [ ] Session survives a server restart (persistent store)
- [ ] Restart the service → photos still listed (metadata in Postgres)
- [ ] Logs contain no secrets/tokens/errors leaking messages
- [ ] Mobile browser: gallery + preview usable

## Rollback

Railway → Deployments → redeploy the previous deployment. Data (R2 + Postgres) is
external to the service and survives rollbacks.

## Known MVP limits

- `SESSION_STORE=redis` is not implemented (use `sql`).
- Drive import (`DRIVE_IMPORT_ENABLED`) is an inert flag — future separate flow.
- Photo list filtering loads rows then filters in-process (fine at yearbook scale).
