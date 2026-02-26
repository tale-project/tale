# Convex backend

## Local development

Start the local Convex backend:

```bash
npm run convex:dev --workspace=@tale/platform
```

### Resetting local state

To fully reset the local Convex backend (clear all data, re-run schema, re-seed):

1. Remove the `CONVEX_DEPLOYMENT` variable from `services/platform/.env.local`
2. Remove the local data directory:
   ```bash
   rm -rf services/platform/.convex
   ```
3. Restart `convex dev` — it will re-provision a fresh local backend
