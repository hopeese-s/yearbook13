# Phase 0 Handoff - Foundation

Status: COMPLETE (pending Gate 1 human approval)
Branch: feat/foundation
Date: 2026-08-29

## What was built

Foundation scaffold only. No feature domains implemented.

- `package.json` - ESM, Node >=20, scripts: start/dev/test/lint/build:check
- Approved dependency footprint installed (express, express-session,
  session-file-store, passport, passport-google-oauth20, multer, sharp,
  dotenv, express-rate-limit, helmet; dev: @biomejs/biome, supertest).
  npm reports 0 vulnerabilities. Sharp resolved via prebuilt binary on
  Windows; Railway verification (prebuilt-first, no unconditional libvips)
  remains a Phase 4/9 task per BUILD-PLAN.md.
- `server.js` - thin bootstrap only (env -> app -> listen + graceful shutdown)
- `src/config/env.js` - full env validation; production invariants enforced at boot:
  - STORAGE_DRIVER must be r2 (local refused)
  - SESSION_STORE must be sql|redis (file/memory refused)
  - DB_DRIVER must be sql (json refused)
  - SESSION_SECRET required, >= 32 chars
  - Google OAuth credentials required (auth-only; Drive scopes are NOT requested)
  - R2 credentials required when STORAGE_DRIVER=r2
- `src/config/paths.js` - root/public/uploads/data/sessions resolution
- `src/server/middleware/security.js` - helmet, body limits, trust proxy
- `src/server/middleware/errors.js` - notFoundHandler + createErrorHandler factory;
  registered as FINAL middleware; JSON error contract `{error:{code,message}}`;
  message suppressed in production
- `src/server/routes/health.routes.js` - GET /health (Railway healthcheck target)
- `railway.json` - approved build flow: `npm ci && npm run build:check && npm prune --omit=dev`,
  healthcheck /health, no unconditional libvips
- `tests/` - 19 passing tests (env validation + production guards, health smoke,
  middleware-order incl. thrown-error path and production message suppression)
- `AGENTS.md`, `README.md`, `.gitignore`, `.env.example` (complete deployment checklist)

## Architecture contracts established

1. Middleware order: security -> routers -> notFound -> errorHandler(LAST).
   Test seam: `createApp(config, { extraRouters })` mounts test routers before 404.
2. Env validation is the single source of truth for configuration; production
   invariants are enforced at boot and covered by tests.
3. Error contract: all errors return JSON `{error:{code,message}}`; no HTML
   Express defaults; no stack traces; no message leakage in production.
4. server.js stays thin; all logic lives under src/.

## Verification results

- `npm test` -> 25/25 pass
- `npm run lint` (biome) -> clean
- `npm run build:check` -> clean
- Manual boot: server listens on :3000, GET /health -> 200 {"status":"ok"}

## Reviewer round + fixes (build-plan retry policy: one batch)

Reviewer verdict: CHANGES REQUIRED (1 blocker, 2 major, 4 minor, 5 nit).
Findings fixed in one batch:

1. BLOCKER - `npm test` script (`node --test tests/`) failed on this platform;
   fixed to `node --test` (default recursive scan). Handoff claim now reproducible.
2. MAJOR - `.env` was never loaded despite README instructions; fixed with
   `import 'dotenv/config'` as the first line of server.js (still thin bootstrap).
3. MAJOR - unset NODE_ENV silently defaulted to development, bypassing every
   production invariant; fixed FAIL-SAFE: unset NODE_ENV now defaults to
   production requirements (explicit `NODE_ENV=development` needed locally,
   as .env.example already instructs).
4. MINOR - DB_URL now required in production when DB_DRIVER=sql (+ test).
5. MINOR - added missing coverage: GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL
   production branches, invalid PORT, invalid DRIVE_IMPORT_ENABLED.
6. MINOR - production error logs now omit error messages entirely (signed URLs
   / connection strings cannot leak); non-production logs carry the stack (+ tests).
8. NIT - shared test helpers moved to tests/helpers.js (duplicate health test removed).
9. NIT - DRIVE_IMPORT_ENABLED strictly validated ("true"|"false"), no silent coercion.
10. NIT - SESSION_SECRET trimmed before length check; placeholder rejected.
12. NIT - graceful shutdown has a 10s force-exit so deploys are deterministic.

Deferred (reviewer-agreed, batched into Phase 1):
7. Static "error handler is LAST" assertion test - to be added when real
   routers land in Phase 1 (extraRouters seam already proves ordering behavior).
11. Feature deps (sharp/multer/passport/...) unused in Phase 0 ship in the
   production image; footprint was approved at Gate 0; deferred deliberately.

## Deviations / notes

- Node's test runner on this machine (Node 24, Windows) did not accept a
  directory argument (`node --test tests/`); `npm test` uses the default
  recursive scan (`node --test`) which discovers tests/**/*.test.js.
- BUILD-PLAN.md Phase 0 allowed-paths listed `test/smoke/`; implemented as
  `tests/` per the approved architecture tree in the final plan (§2).
- AGENTS.md and README.md added (approved in the final plan Phase A tree).
- NODE_ENV fail-safe default (unset = production requirements) is stricter
  than .env.example implies; documented here and in env.js JSDoc.

## Gate 1 checklist for human approval

Inspect before approving Authentication (Phase 1):
- [ ] Repo tree and file boundaries match BUILD-PLAN.md Phase 0
- [ ] `npm test` and `npm run build:check` pass locally
- [ ] Production invariants in env.js match the approved architecture
- [ ] errors.js is final middleware (see tests/smoke/middleware-order.test.js)
- [ ] .env.example is a complete deployment checklist, no real secrets
- [ ] railway.json build flow matches the approved correction
