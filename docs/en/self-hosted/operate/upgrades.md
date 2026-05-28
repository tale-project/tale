---
title: Upgrades
description: How `tale upgrade` and `tale deploy` move a Tale instance forward — the rolling restart pattern, what to do before an upgrade, and the version compatibility story.
---

Upgrades on a self-hosted Tale instance run through the `tale` CLI in two steps: `tale upgrade` to move the binary itself to the new version, then `tale deploy` to roll the platform containers to match. The deploy uses a blue-green pattern — the new colour starts alongside the old, healthchecks pass, traffic flips, the old colour drains. Zero downtime is the default; rollback to the previous colour is a single command if a smoke check fails.

The CLI install lives in [Install the tale CLI](/self-hosted/install/cli-install). This page covers what each subcommand does and the order to run them in.

## Before you upgrade

Two things are worth confirming first:

- A working backup landed within the last 24 hours — see [Backups and restore](/self-hosted/operate/backups-and-restore). Upgrades that fail mid-migration are rare, but the recovery path is "restore from dump."
- The release notes for the target version do not name a breaking change. The notes are linked from the GitHub release page; breaking changes are flagged as such at the top.

If the upgrade crosses a major version (1.x → 2.x), read the migration notes end-to-end before starting. Major versions are where schema migrations and config-file format changes land.

## The two commands

`tale upgrade` updates the CLI binary itself. The deployed platform version matches the CLI's version — that coupling is intentional, so the CLI you run cannot deploy a version it does not know about.

```bash
# Move the CLI to the latest release
tale upgrade

# Then roll the platform to match
tale deploy
```

`tale deploy` does the actual rolling restart: it pulls new images, starts the new blue or green colour alongside the running one, waits for healthchecks, flips the proxy, drains and removes the old colour. The default targets the rotatable services (`platform`, `rag`, `crawler`); stateful services (`db`, `proxy`) need `--all` to update in place.

```bash
# Include the stateful services
tale deploy --all

# Roll only specific services
tale deploy --services platform,rag

# Preview without changes
tale deploy --dry-run
```

`--dry-run` is worth running before every production upgrade — it surfaces missing images, missing migrations, and dependency mismatches without touching the running containers.

## The blue-green pattern

A running instance is one of the two colours (blue or green) at any given time. `tale deploy` brings up the other colour, waits for it to pass healthchecks, then flips Caddy's upstream to the new colour. The old colour drains its in-flight requests (default 30 s), then exits.

Three guarantees the pattern gives you:

- **No window where both colours serve traffic.** A database constraint enforces single-active — Caddy routes to the healthy one.
- **Rollback is reverting one state file.** `tale rollback` re-flips the upstream back; the old colour is still running for a few minutes after a deploy in case you need to bounce back.
- **Failed healthchecks block the flip.** If the new colour does not pass within the timeout, the deploy aborts and the old colour continues serving.

The full deploy procedure including the cleanup phase lives in `tale --help`; the operator-facing recipe is `tale deploy && tale status` and visual confirmation in the browser.

## Rolling back

```bash
# Back to the previous version
tale rollback

# Or pin to a specific version
tale rollback --version 0.9.0
```

Rollback is fast (it is just flipping the colour) but does not undo schema migrations. If the upgrade ran a migration that the old version does not understand, rollback leaves the database ahead of the binary — the old version refuses to start. The release notes name when this happens; for those upgrades, restore-from-dump is the actual rollback path.

## Version compatibility

Tale versions are semver. The compatibility rules:

- Patch (`0.9.0 → 0.9.1`) — no migrations, no config changes, rollback is always safe.
- Minor (`0.9.x → 0.10.x`) — may include forward-only migrations; rollback restores the binary but not the schema.
- Major (`0.x → 1.x`) — read the migration notes, schedule the maintenance window, expect surprises.

Skipping minor versions (going from 0.9 to 0.11) is supported as long as the intermediate migrations are still in the binary; the release notes call it out when this is not the case.

## Where this fits

The upgrade flow ties together every other operate page — backups are what makes a failed upgrade recoverable, observability is what tells you the new colour is healthy, hardening is what you re-walk after a major version. If you are setting up the CLI for the first time, [Install the tale CLI](/self-hosted/install/cli-install) covers the workstation-side setup; if you are picking up the pager mid-rollout, [Troubleshooting](/self-hosted/operate/observability/troubleshooting) names the symptoms.
