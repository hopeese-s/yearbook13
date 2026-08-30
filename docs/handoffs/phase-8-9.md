# Phase 8–9 Handoff — Integration, Verification, Deployment Prep

Status: COMPLETE (deployment itself awaits human + credentials — Gate 4/5)
Branch: feat/foundation

## Verification results (Phase 8)

- `npm ci` → clean install from lockfile, 0 vulnerabilities (local verification)
- `npm test` → 104/104 pass (0.8s)
- `npm run build:check` → clean (Biome over 71 files + node --check server.js)
- Dev boot + HTTP smoke: `/` 200, `/admin.html` 200, `/api/photos` list OK,
  thumbnail bytes 200, static vendor three.module.js 200
- Production invariants covered by tests: local storage refused, file/memory
  sessions refused, json metadata refused, missing secret/OAuth/R2/DB_URL refused,
  unset NODE_ENV fails safe to production requirements
- Fresh `npm ci` reproduces the Railway build's first step exactly
- Reviewer audits: Gate 2 (phases 1–4) and Gate 3 (phases 5–7) — all BLOCKER/MAJOR
  findings fixed in bounded batches (see git log "fix: gate 2/gate 3 findings")

## Persistent stores (Phase 9 implementation)

- `src/data/sql.repository.js` — PostgreSQL repository (JSONB metadata), same
  interface as JSON repo; dynamic `pg` import; injectable pool; contract-tested
  against a fake pool (real-DB runs are skip-gated: set TEST_DATABASE_URL later)
- `src/auth/session.pgstore.js` — express-session store on PostgreSQL
  (get/set/destroy/touch), injectable pool, contract-tested with fake pool
- `src/data/index.js` — repository factory (json|sql)
- `src/auth/session.js` — store factory: file (dev) | sql (prod) | redis → loud error
- Production boot now has NO non-persistent path: storage=R2, metadata=SQL,
  sessions=SQL are all implemented and wired

## Deployment prep (Phase 9 artifacts)

- `railway.json`: build `npm install --include=dev --no-audit --no-fund && npm run build:check && npm prune --omit=dev`,
  start `npm start`, healthcheck `/health`, restart policy. Railway uses install
  instead of ci because its cached `/app/node_modules/.cache` can be locked during
  ci cleanup (`EBUSY`); Sharp is still prebuilt-first with NO unconditional libvips.
- `docs/deployment/DEPLOYMENT.md`: env checklist, deploy steps, Gate 5 verification
  checklist, rollback, known limits
- `.env.example`: complete deployment checklist (no real secrets)

## What the human must provide for actual deployment (Gate 4 → 5)

1. GitHub repo + push (feature branch → PR; Builder never pushes to main)
2. Railway project + PostgreSQL plugin
3. Cloudflare R2 bucket + API token
4. Google OAuth client with production redirect URI
5. `ADMIN_EMAILS` allowlist values
