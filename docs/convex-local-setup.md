# Convex Local Development Setup

This guide explains how to set up Convex for local development in this project.

## 🔧 Important: Always Use Local Mode

This project is configured to use **Convex in local development mode**. This means:

- ✅ No cloud account required
- ✅ All data stored locally on your machine
- ✅ Faster development iteration
- ✅ Works completely offline
- ✅ No external dependencies or API keys needed for basic development

## First-Time Setup

**✅ No Setup Required!**

This project is configured to automatically skip the Convex login prompt using `CONVEX_AGENT_MODE=anonymous`. You will **NOT** see any setup prompts when running the development server.

The system automatically:

- Skips authentication prompts
- Runs in anonymous local mode
- Creates a local-only development environment

### Why Local Development?

1. **Simplicity**: No need to create cloud accounts or manage API keys
2. **Speed**: Faster startup and iteration times
3. **Privacy**: All your data stays on your local machine
4. **Reliability**: No network dependencies for core development

## Running the Development Server

The recommended way to start development is:

```bash
npm run dev
```

This script will:

1. 🔧 Start Convex backend in local mode (port 3210)
2. ⏳ Wait for the backend to be ready
3. 🔄 Sync environment variables from `.env.local`
4. ✅ Generate Convex code and types
5. 🚀 Start Next.js dev server (port 3000)

You'll see helpful messages like:

```
[dev] 🔧 Using LOCAL development mode for Convex
[dev] 💡 If this is your first time running Convex and you see a setup prompt:
[dev]    Please choose "Local development" or "Local" option
[dev]    This ensures you're running in local mode without cloud dependencies
```

## Manual Convex Commands

If you need to run Convex commands manually, always use the `CONVEX_AGENT_MODE=anonymous` environment variable:

```bash
# Start Convex backend only (no login prompt, automatically local)
CONVEX_AGENT_MODE=anonymous npx convex dev

# Generate code and types
npx convex codegen

# Deploy functions to local backend (no login prompt, automatically local)
CONVEX_AGENT_MODE=anonymous npx convex deploy
```

## Package.json Scripts

The following npm scripts are available and pre-configured for anonymous local development:

```bash
# Main development server (recommended)
npm run dev

# Convex-only commands (all use CONVEX_AGENT_MODE=anonymous)
npm run convex:dev      # Starts Convex in anonymous mode (automatically local)
npm run convex:deploy   # Deploys to anonymous backend (automatically local)
npm run convex:codegen  # Generates types and API
```

## Troubleshooting

### "Convex backend did not start listening within 30s"

This usually happens if:

1. You chose "Cloud development" instead of "Local development" in the setup prompt
2. There's a port conflict on port 3210

**Solution**:

- Kill any existing processes and restart
- Make sure to choose "Local development" if prompted again
- Check that port 3210 is available

### "Setup prompt appears despite configuration"

If you somehow still see a setup prompt (this should not happen with the current configuration):

**Solution**:

1. Stop all development servers
2. Run `CONVEX_AGENT_MODE=anonymous npx convex dev --local` manually
3. The prompt should be automatically skipped
4. If it still appears, check that the environment variable is properly set

### Port 3210 already in use

If you see an error about port 3210 being in use:

```bash
# Find and kill the process using port 3210
lsof -ti:3210 | xargs kill -9

# Or restart your development server
npm run dev
```

## Data Storage

In local mode, Convex stores all data in a local directory. Your data persists between restarts, so you don't lose your development data when stopping and starting the server.

## Environment Variables

The development script automatically syncs environment variables from your `.env.local` file to the Convex backend. This includes:

- `SITE_URL`
- Authentication keys
- API keys for external services

Make sure your `.env.local` file is properly configured before starting development.

## Next Steps

Once you have Convex running locally:

1. Your Next.js app will be available at `http://localhost:3000`
2. Convex dashboard (if needed) at `http://localhost:3210`
3. Make changes to Convex functions in the `convex/` directory
4. Changes will automatically reload and sync

Happy coding! 🚀
