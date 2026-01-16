# Scripts Directory

This directory contains development and utility scripts for the project.

## Main Scripts

### Development Scripts

- **`dev.mjs`** - Main development orchestrator

  - Starts Convex backend in LOCAL mode
  - Syncs environment variables
  - Starts Vite dev server
  - **Usage**: `npm run dev`

- **`sync-convex-env-from-dotenv.mjs`** - Environment variable sync
  - Syncs .env/.env.local variables to LOCAL Convex deployment
  - Uses `--local` flag for local development
  - **Usage**: Called automatically by dev.mjs

### Utility Scripts

- **`generate-admin-password.mjs`** - Admin password generation
  - **Usage**: `npm run admin:generate-password`

## 🔧 Local Development Focus

All Convex-related scripts use `CONVEX_AGENT_MODE=anonymous` to ensure:

- No cloud dependencies
- No login prompts or authentication required
- Local-only development
- Faster iteration
- Offline capability

## Entry Points (package.json)

- `npm run dev` → `node ./scripts/dev.mjs`
- `npm run admin:generate-password` → `node ./scripts/generate-admin-password.mjs`
