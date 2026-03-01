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
