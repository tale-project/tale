---
title: Troubleshooting
description: Symptom-first map of the issues operators actually hit on a running Tale instance, with the fixes that have landed in practice.
---

This page maps the issues operators have actually hit on a running Tale instance to the fixes that have worked. The list is short on purpose — comprehensive failure-mode catalogues encourage skimming past the symptom that matches yours. Scan the sub-headings until one fits what you're seeing, then read the prose underneath. Anything not listed here is rare enough that the diagnosis path is the same in every case: read the logs, then file an issue.

For any symptom that doesn't appear below, the `tale` CLI's `--verbose` flag plus the container logs (see [Operations — Logs](/self-hosted/operate/observability/operations#viewing-logs)) almost always surface the root cause. When that's not enough, open an issue at [GitHub Issues](https://github.com/tale-project/tale/issues) with the verbose output attached.

## Platform never reports ready

A fresh container takes up to three minutes before `/tmp/platform-ready` lands, because the entrypoint waits for env sync to finish and `bunx convex deploy` to push the function set before signalling healthy. The `200 OK` lines from the proxy health probe arrive long before that — they do **not** mean the UI is reachable.

Watch `docker compose logs -f platform` and wait for the `Tale Dev v0.x.x  Ready.` line. If it never arrives, three causes are common: an unreachable `convex` service (the platform deploy step needs it up), a malformed secret in `.env` that the env sync rejects (look for `[env-sync] rejecting key` in the convex logs), or insufficient RAM on the host so the green deploy can't start alongside the blue one. The blue-green topology assumes 12 GB; on 8 GB hosts the green container is killed before it deploys.

## "DB_PASSWORD must be set" on every service

`DB_PASSWORD` gates four services and surfaces from each one with a slightly different message:

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` from the database container.
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` from the platform.
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` from the RAG service.
- `ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set` from the crawler.

Open `.env` and set `DB_PASSWORD` to a non-empty value. Re-run `tale start` (or `docker compose up`) — the variable is read at container start, so a running stack won't pick it up until you bring it down and back up. When connecting to an external Postgres, set `POSTGRES_URL` instead and leave `DB_PASSWORD` unset; the four services then read the URL directly. The full pattern lives in [Linux server install — Using an external database](/self-hosted/install/linux-server#using-an-external-database).

## Provider key edits don't take effect

Provider config (`$TALE_CONFIG_DIR/providers/<name>.json` and its `.secrets.json` sibling) is watched by the convex container — saving from **Settings > Providers** or editing the file by hand both trigger the same reload. Two cases break that:

- **The secrets file is SOPS-encrypted but `SOPS_AGE_KEY` is no longer set.** The file format is self-describing, so the loader refuses to overwrite encrypted content with plaintext to prevent data loss. Restore the age key or delete the encrypted file before re-saving. The full flow is in [Providers — Switching modes](/self-hosted/configuration/providers#switching-modes).
- **You edited the file inside the container's writable mount.** Tale's compose mounts `convex-data:/app/data` to the convex service writable, and the same volume read-only to platform/RAG/crawler. Edit the files from the host (`$TALE_CONFIG_DIR` on the host maps into `/app/data/platform-config` in the convex container) or use the UI; in-container `vi` against the read-only mount silently fails for sibling services.

## Documents stay "indexing" forever

Document indexing is a multi-stage pipeline: the RAG service extracts text, splits it into chunks, generates embeddings, and writes them with vector entries to ParadeDB. A hundred-page PDF takes minutes; a thousand-page export can take half an hour. The progress is visible per file in **Knowledge > Documents**.

When indexing stalls indefinitely, two causes dominate: the embedding-tagged provider is misconfigured or rate-limiting (check `docker compose logs rag` for `provider error` lines), or pgvector is missing from the external Postgres you pointed Tale at. The second case shows up as `extension "vector" is not available` in the RAG logs; install pgvector on the external instance per [Linux server install — Using an external database](/self-hosted/install/linux-server#using-an-external-database).

## Where to get help

Logs are the first place to look — `docker compose logs -f` for a live stream, `tale logs <service> --tail 200` when an instance is already running under `tale deploy`. The container smoke test (`bun run docker:test`) validates the full stack from a clean state and catches port conflicts and dependency drift on a development host.

For issues that survive a log read, file at [GitHub Issues](https://github.com/tale-project/tale/issues) with the verbose CLI output and the `compose.yml` snippet you're running. Security-relevant findings go through [Security advisories](/self-hosted/operate/security/advisories) instead, where a private draft pre-empts public disclosure until a patch is available.
