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
startCommand: MALLOC_ARENA_MAX=2 MALLOC_MMAP_THRESHOLD_=131072 MALLOC_TRIM_THRESHOLD_=131072 node --max-old-space-size=128 --max-semi-space-size=2 server.js
sleepApplication: true
healthcheck:  GET /health (30s timeout)
restart:      ON_FAILURE, max 3
```

### RAM budget (Railway bills per MB of RAM)

Measured in production mode with 2,000 photos in Postgres:

| | before | after |
|---|---|---|
| idle after boot | ~158 MB | ~76 MB |
| after browsing the gallery | ~196 MB | ~90 MB |
| peak while uploading 5 x 14 MB photos + a 20 MB video | ~346 MB | ~132 MB |
| held after that upload | ~272 MB | ~120 MB |

What keeps it low (don't undo these without measuring):

- **`node` directly, not `npm start`** — npm stays resident as a second process (~65 MB).
- **No AWS SDK** — R2 is reached through `src/storage/s3-lite.js` (SigV4 signing, ~150 lines).
- **sharp is lazy-loaded** — only loads on the first upload.
- **Uploads spool to disk** (`os.tmpdir()/ims13-uploads`), and videos and the full-size masters
  stream to R2 from there. Temp files are deleted when the request ends.
- **JPEG masters are written with `optimiseCoding: false`**. Huffman optimisation buffers the
  whole image (~130 MB for 19 MP). The output pixels are identical; files are ~5% larger.
- **ZIP export, Drive import and the thumbnail proxy all stream**; nothing is built in RAM.
- **One shared pg pool** (max 3, idle connections close after 10 s); the unfiltered gallery
  list is paginated in SQL.
- **glibc malloc env vars** make freed image buffers go back to the OS rather than staying
  in a fragmented heap. **`--max-old-space-size=128`** caps the V8 heap; the app uses ~10–20 MB.
- **`sleepApplication: true`** — App Sleeping stops RAM billing entirely while no one visits
  (the first request after sleep takes a few seconds to wake the service). Keep the app free of
  background timers or persistent outbound connections, or it can never fall asleep.

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
