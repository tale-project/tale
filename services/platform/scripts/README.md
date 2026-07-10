# Scripts Directory

This directory contains development and utility scripts for the project.

## Main Scripts

### Development Scripts

- **`dev.ts`** - Main development orchestrator
  - Starts Convex backend in LOCAL mode
  - Syncs environment variables
  - Starts Vite dev server
  - **Usage**: `bun run dev`

- **`sync-convex-env-from-dotenv.ts`** - Environment variable sync
  - Syncs .env/.env.local variables to LOCAL Convex deployment
  - Uses `--local` flag for local development
  - **Usage**: Called automatically by dev.ts

### Migration Gate Scripts

- **`migrations-codegen.ts`** - Registry codegen + structural validation for the versioned
  migration framework: derives every migration's identity from its folder, regenerates
  `convex/migrations/framework/registry(.node).gen.ts` and the `api.d.ts` module map, and
  enforces the folder contract (uniqueness, contiguity, 'use node' ⟺ kind, harness marker)
  - **Usage**: `bun run migrations:sync` (write) / called by `check-migrations.ts` (check)

- **`check-migrations.ts`** - The migrations CI gate orchestrator: codegen check mode plus the
  `_id`-FK guard (a `table-rows` migration may not snapshot a `v.id()`-referenced table)
  - **Usage**: first member of `bun run migrations:check`

- **`check-migration-corpus.ts`** - Corpus coverage guard: every runnable migration's declared
  subjects must be seedable by the baseline world corpus the full-chain suite runs against
  - **Usage**: second member of `bun run migrations:check`

- **`check-schema-snapshot.ts`** / **`check-config-snapshot.ts`** - "Missing migration" guards:
  fingerprint the live Convex schema / org-config Zod schemas against the committed baselines;
  data-incompatible drift demands a migration first
  - **Usage**: `bun run migrations:check` (check) / `bun run migrations:snapshot` (refresh)

### Utility Scripts

- **`generate-admin-password.ts`** - Admin password generation
  - **Usage**: `bun run admin:generate-password`

## 🔧 Local Development Focus

All Convex-related scripts use `CONVEX_AGENT_MODE=anonymous` to ensure:

- No cloud dependencies
- No login prompts or authentication required
- Local-only development
- Faster iteration
- Offline capability

## Entry Points (package.json)

- `bun run dev` → `bun scripts/dev.ts`
- `bun run admin:generate-password` → `bun scripts/generate-admin-password.ts`
