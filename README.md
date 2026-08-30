# IMS13 Yearbook

Dark-first **Liquid Glass** yearbook photo gallery for class IMS13 —
Neumorphism + Skeuomorphism, macOS-like windows, a Three.js glass photo-card hero,
masonry/carousel/lightbox views, and a stateful Mac **Preview**-style window
(filmstrip · zoom · rotate · keyboard navigation).

Express backend · vanilla JS (ES modules, no bundler) · Google OAuth (auth-only) ·
swappable Local/R2 storage · JSON (dev) / PostgreSQL (prod) metadata behind a
repository layer.

## Features

- **Public gallery** — floating 3D glass photo-card hero (reduced-motion, mobile,
  and weak-device fallbacks), Pinterest masonry, coverflow carousel, lightbox
  quick view, draggable Mac window preview with filmstrip.
- **Admin** — sign-in gate, 3-step upload wizard (drag-drop, batch reorder with an
  insertion caret, metadata), XHR progress with per-file results, marquee
  multi-select photo management, scrollspy nav.
- **Image pipeline** — validation → orientation fix → EXIF stripped → metadata →
  thumbnail → storage → repository, with cleanup on failure.
- **Hardening** — rate limits (auth + uploads), body/upload size caps, MIME +
  magic-byte checks, JSON error contract, production boot invariants, no secrets
  in logs, subtle keyboard-only focus glow (no default browser rings).

## Run (development)

```bash
npm install
cp .env.example .env   # fill in values (dev needs NODE_ENV=development)
node scripts/seed-demo.mjs 8   # optional: 8 synthetic sample photos
npm start              # http://localhost:3000
```

## Test

```bash
npm test               # 104 tests (node:test)
npm run build:check    # lint + syntax gate (Railway runs this too)
```

## Deploy

See [`docs/deployment/DEPLOYMENT.md`](docs/deployment/DEPLOYMENT.md) — production
requires R2 storage, PostgreSQL metadata/sessions, and Google OAuth credentials.

## Layout

```
server.js            thin bootstrap (compose → app → listen)
src/config/          env validation + paths
src/server/          app assembly, middleware, routes
src/auth/            google oauth, session stores (file/pg)
src/domain/          pure photo/people logic
src/data/            repository layer (json | sql)
src/storage/         StorageDriver (local | r2)
src/images/          sharp pipeline
src/uploads/         upload orchestration
public/              frontend (css tokens, gallery, admin, vendored three)
tests/               node:test suites
docs/                handoffs + deployment runbook
```

Execution strategy and phase gates: `BUILD-PLAN.md` in the agent-lab workspace.
