# Scripts Directory

Development and utility scripts for `@tale/platform`.

## Development

- **`dev.ts`** / **`dev-engine.ts`** — the dev-fleet orchestrator: brings up the
  dockerized backing services, spawns the platform **backend** (`backend/main.ts`,
  role `all`) and the Vite dev server, and gates the boot on each one.
  - **Usage**: `bun run dev` (add `TALE_DEV_SKIP_DOCKER=1`, or `bun run dev:fast`,
    to skip the docker bring-up)
- **`backend-supervisor.ts`** — the health/restart state machine behind the fleet's
  backend child (consecutive-failure threshold, restart budget, stable-window
  forgiveness). Pure; the fleet does the I/O.
- **`dev-gates.ts`** — the boot gates' severity + timeout table (hard fails the
  fleet, soft degrades with a warning).
- **`dev-output.ts`** / **`dev-modes.ts`** / **`dev-secrets.ts`** — log classification
  and surfacing, the dev-mode matrix, and the insecure-but-stable local secret
  derivations (shared with `compose.dev.yml` so both local modes agree).
- **`setup-check.ts`** — pre-flight validation for a contributor's machine
  (runtime version, ports free) with the exact remediation for each failure.
  - **Usage**: `bun run setup:check` (from the repo root)

## Build / codegen

- **`generate-openapi.ts`** — regenerate the REST door's OpenAPI document from the
  route definitions.
  - **Usage**: `bun run generate:openapi`
- **`prerender-boot-shell.tsx`** — pre-render the boot shell into the built `dist/`.
- **`validate-builtin-configs.ts`** — validate the shipped org-config catalog
  against its schemas.
  - **Usage**: `bun run configs:validate`

## Utilities

- **`cls-harness.ts`** — layout-shift harness for the docs/screenshot lanes.

## Entry points (package.json)

- `bun run dev` → `scripts/dev.ts`
- `bun run setup:check` (repo root) → `scripts/setup-check.ts`
- `bun run generate:openapi` → `scripts/generate-openapi.ts`
- `bun run configs:validate` → `scripts/validate-builtin-configs.ts`
