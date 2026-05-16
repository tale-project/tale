---
title: Troubleshooting
description: Symptom-first map of the issues operators actually hit on a running Tale instance, with the fixes that have landed in practice.
---

This page maps the issues operators have hit on a running Tale instance to the fixes that have worked. The list is short on purpose — a comprehensive failure-mode catalogue encourages skimming past the symptom that matches yours. Scan the sub-headings until one fits, then read the prose underneath; anything not listed here is rare enough that the diagnosis path is the same in every case: read the logs, then file an issue.

For any symptom that isn't below, the `tale` CLI's `--verbose` flag plus the per-service container logs (see [Operations — Logs](/self-hosted/operate/observability/operations#logs)) almost always surface the root cause. When that isn't enough, file at [GitHub Issues](https://github.com/tale-project/tale/issues) with the verbose CLI output and the relevant log excerpt attached.

## The platform never reports ready

A fresh `platform` container takes up to three minutes before `/tmp/platform-ready` lands, because the entrypoint waits for env sync to finish and `bunx convex deploy` to push the function set before signalling healthy. The `200 OK` lines from the proxy health probe arrive long before that — they do not mean the UI is reachable.

Watch `docker compose logs -f platform` and wait for the `Tale Dev v0.x.x  Ready.` line. If it never arrives, three causes are common. The most frequent is an unreachable `convex` service — the platform's deploy step needs Convex up before it can push functions, so a convex container that crashes on boot drags the platform with it. The second is a malformed secret in `.env` that the env sync rejects; look for `[env-sync] rejecting key` in the convex logs. The third is host RAM: the blue-green topology runs both colors during the swap, and on an 8 GB host the green container is killed before it deploys. Bumping the host to 12 GB is the fix.

## "DB_PASSWORD must be set" on every service

`DB_PASSWORD` gates four services, and each one surfaces a slightly different error when the value is missing:

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` from the database container.
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` from the platform.
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` from the RAG service.
- `ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set` from the crawler.

Open `.env`, set `DB_PASSWORD` to a non-empty value, and re-run `tale start` (or `docker compose up`). The variable is read at container start, so a running stack won't pick it up until you bring it down and back up. When connecting to an external Postgres, set `POSTGRES_URL` instead and leave `DB_PASSWORD` unset — the four services then read the URL directly. The full pattern lives at [Production deployment — Using an external database](/self-hosted/install/linux-server#using-an-external-database).

## Provider key edits don't take effect

Provider config under `$TALE_CONFIG_DIR/providers/<name>.json` (and the matching `.secrets.json`) is watched by the convex container — saving from **Settings > Providers** or editing the file by hand trigger the same reload. Two cases break that.

The first is the SOPS-encrypted secrets file when `SOPS_AGE_KEY` is no longer set. The file format is self-describing, so the loader refuses to overwrite encrypted content with plaintext to prevent data loss — it would otherwise look like the operator silently downgraded their secrets storage. Restore the age key, or delete the encrypted file before re-saving. The full flow is on [Providers — Switching modes](/self-hosted/configuration/providers#switching-modes).

The second is when the file is edited from inside the wrong mount. Tale's compose mounts `convex-data:/app/data` writable on the convex service, and the same volume read-only on platform, RAG, and crawler. Edit the files from the host (the host path mapped into `/app/data/platform-config` on the convex container) or use the UI; an in-container `vi` against the read-only mount silently fails for sibling services and never reaches the watcher.

## Documents stay "indexing" forever

Document indexing is a multi-stage pipeline: the RAG service extracts text, splits it into chunks, generates embeddings against an embedding-tagged provider, and writes the chunks and vector entries to ParadeDB. A hundred-page PDF takes minutes; a thousand-page export can take half an hour. The progress is visible per file under **Knowledge > Documents**.

When indexing stalls indefinitely, two causes dominate. The embedding-tagged provider is either misconfigured or rate-limiting — check `docker compose logs rag` for `provider error` lines, which name the failing provider and the HTTP status the upstream returned. Or the external Postgres you pointed Tale at is missing the `vector` extension; the symptom is `extension "vector" is not available` in the RAG logs. Install pgvector on the external instance per [Production deployment — Using an external database](/self-hosted/install/linux-server#using-an-external-database).

## Where to get help

Logs are the first place to look — `docker compose logs -f` for a live stream, `tale logs <service> --tail 200` when the stack is running under `tale deploy`. The container smoke test (`bun run docker:test`) validates the full stack from a clean state and catches port conflicts and dependency drift on a development host before they reach production.

For issues that survive a log read, file at [GitHub Issues](https://github.com/tale-project/tale/issues) with the verbose CLI output and the `compose.yml` snippet you're running. Security-relevant findings go through [Security advisories](/self-hosted/operate/security/advisories) instead, where a private draft pre-empts public disclosure until a patch is available.
