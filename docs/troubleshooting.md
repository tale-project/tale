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

## Getting help

- Logs: `docker compose logs -f` is always the first place to look
- GitHub Issues: https://github.com/tale-project/tale/issues
- Convex Dashboard: useful for inspecting raw data and function logs when debugging backend problems
