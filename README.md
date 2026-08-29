# IMS13 Yearbook

Dark-first, liquid-glass yearbook photo gallery for class IMS13.
Express backend, vanilla JS + Three.js frontend.

## Run

```bash
npm install
cp .env.example .env   # fill in values
npm start              # http://localhost:3000
```

## Test

```bash
npm test
```

## Lint / build gate

```bash
npm run build:check
```

## Layout

```
server.js          thin bootstrap (env -> app -> listen)
src/config/        env validation + paths
src/server/        app assembly, middleware, routes
tests/             node:test suites
docs/handoffs/     phase handoff artifacts (see BUILD-PLAN.md)
```

Execution strategy and phase gates: see `BUILD-PLAN.md` in the agent-lab workspace.
