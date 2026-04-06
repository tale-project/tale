---
title: Troubleshooting
description: Solutions for common issues and where to get help.
---

## Common issues

### "Docker Engine not found" on Windows

This means Docker Desktop is not running. Open Docker Desktop from the Start menu or system tray, wait for the engine to show green, then try your command again.

### Browser shows certificate warning

Tale uses a self-signed certificate for local development. You can click through the browser warning or remove it permanently by running:

```bash
docker exec tale-proxy caddy trust
```

Then restart your browser.

### Platform does not load after `docker compose up`

Wait for the platform ready message in the logs. This can take up to two minutes. The `200 OK` health check messages that appear before it do not mean the UI is ready.

### AI responses are slow or failing

Check your provider API key in Settings > Providers. Common causes:

- Expired or revoked API key. Regenerate it at openrouter.ai and update in Settings > Providers.
- Insufficient credits on your OpenRouter account.
- The model configured in your provider file is not available on your account tier.
- Network issue between the Tale server and the OpenRouter API.

### Documents are not searchable after upload

Document indexing runs in the background. After uploading, the RAG service extracts text, splits it into chunks, generates embeddings, and writes to the database. Large files such as multi-hundred-page PDFs can take several minutes. Check the status indicator in Knowledge > Documents to see the current state.

### Website crawling shows no pages

After adding a website, the crawler does an initial pass of the homepage and any links it finds. This takes a few minutes depending on site size. If the page count stays at 0, check `docker compose logs crawler` for errors. Common causes are SSL issues on the target site or `robots.txt` blocks.

### Service fails with "DB_PASSWORD must be set"

All database-connected services require `DB_PASSWORD` to be set in your `.env` file. If you see one of these errors:

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` (database)
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` (platform)
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` (RAG)

Open your `.env` file and ensure `DB_PASSWORD` is set to a non-empty value. If you are setting up for the first time, choose any password. If you previously relied on the default, set it explicitly now.

### Forgot admin password

If you are locked out of your admin account, another admin can reset your password from Settings > Organization > member row > Edit > Set Password. If no admins are available, someone with Docker access can use the Convex Dashboard to update the user record directly.

## Docker build and container issues

### Docker build fails with "parent snapshot does not exist"

This is a Docker BuildKit cache corruption issue. Fix it by pruning the build cache:

```bash
docker builder prune -f
```

Then retry your build.

### Port already in use

If `docker compose up` fails because ports (5432, 8001, 8002, 80, 443) are already in use by other services on your machine, use the test compose override which maps to non-conflicting ports:

```bash
docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test up -d --build
```

This uses ports 15432, 18001, 18002, 10080, and 10443 instead.

### Image size unexpectedly large after changes

If a Docker image grows significantly after your changes:

1. Check that new dependencies are installed with `--no-install-recommends` (apt) or `--no-cache-dir` (pip/uv)
2. Verify build-time dependencies stay in the builder stage (not copied to runtime)
3. Run the image size budget checker:

```bash
bun run docker:test:image
```

4. Use `dive` to visually inspect which layers are largest:

```bash
dive <image>
```

See the [Contributing Docker guide](/contributing-docker) for image size reduction techniques.

### DB shows duplicate key errors on startup

On first startup, the database may show errors like:

```
ERROR: duplicate key value violates unique constraint
```

These are harmless. They occur when the `uuid-ossp` extension init script runs idempotently. The extension is already installed by the ParadeDB base image, and the init script handles the conflict gracefully.

### Container health check keeps failing

If a service stays in `starting` or `unhealthy` state:

1. Check logs:

```bash
docker compose logs <service> --tail=50
```

2. Verify `.env` has all required variables (especially `DB_PASSWORD`, `OPENAI_API_KEY`)
3. Check that dependent services are healthy (e.g., platform depends on db, rag, crawler)
4. For platform: allow up to 5 minutes for the Convex framework to compile and deploy functions during a cold start

## Getting help

- Logs: `docker compose logs -f` is always the first place to look
- Container tests: `bun run docker:test` validates the full stack
- GitHub Issues: https://github.com/tale-project/tale/issues
- Convex Dashboard: useful for inspecting raw data and function logs when debugging backend problems
