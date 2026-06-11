---
title: Upgrades
description: How `tale upgrade` and `tale deploy` move a Tale instance forward — the rolling restart pattern, what to do before an upgrade, and the version compatibility story.
---

Upgrades on a self-hosted Tale instance run through the `tale` CLI in two steps: `tale upgrade` to move the binary itself to the new version, then `tale deploy` to roll the platform containers to match. The deploy uses a blue-green pattern — the new colour starts alongside the old, healthchecks pass, traffic flips, the old colour drains. Zero downtime is the default; if a patch release misbehaves, `tale rollback` returns to the previous patch in one command, and anything bigger recovers from the pre-upgrade snapshot.

The CLI install lives in [Install the tale CLI](/self-hosted/install/cli-install). This page covers what each subcommand does and the order to run them in.

## Before you upgrade

Two things are worth confirming first:

- Your off-host copy of the `backups` volume is current — see [Backups and restore](/self-hosted/operate/backups-and-restore). `tale deploy` snapshots the data volumes automatically before any step that can migrate data, but the snapshot lives on the same host; the off-host copy is what survives a dead disk.
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
- **Patch rollback is one command.** `tale rollback` redeploys the previous patch release on the idle colour and flips traffic back. It refuses minor and major downgrades — those can leave the database ahead of the binary, and their recovery path is a snapshot restore.
- **Failed healthchecks block the flip.** If the new colour does not pass within the timeout, the deploy aborts and the old colour continues serving.

The full deploy procedure including the cleanup phase lives in `tale --help`; the operator-facing recipe is `tale deploy && tale status` and visual confirmation in the browser.

## Rolling back

```bash
# Back to the previous patch version
tale rollback
```

`tale rollback` is gated to patch-level steps: it only targets the recorded previous version, and refuses unless that version shares `major.minor` with the running platform. Patch releases never carry migrations, so redeploying the previous patch is always safe. Anything bigger may have migrated data forward — redeploying an older binary on top of migrated data corrupts the instance instead of recovering it. For those, the recovery path is restoring the pre-upgrade snapshot and redeploying the version that matches it; the refusal message prints the exact commands, and the full walk lives in [Backups and restore](/self-hosted/operate/backups-and-restore).

## Version compatibility

Tale versions are semver. The compatibility rules:

- Patch (`0.9.0 → 0.9.1`) — no migrations, no config changes, `tale rollback` is always safe.
- Minor (`0.9.x → 0.10.x`) — may include forward-only migrations; `tale rollback` refuses, recovery is restore-snapshot-and-redeploy.
- Major (`0.x → 1.x`) — read the migration notes, schedule the maintenance window, expect surprises.

Skipping minor versions (going from 0.9 to 0.11) is supported as long as the intermediate migrations are still in the binary; the release notes call it out when this is not the case.

## Where this fits

The upgrade flow ties together every other operate page — backups are what makes a failed upgrade recoverable, observability is what tells you the new colour is healthy, hardening is what you re-walk after a major version. If you are setting up the CLI for the first time, [Install the tale CLI](/self-hosted/install/cli-install) covers the workstation-side setup; if you are picking up the pager mid-rollout, [Troubleshooting](/self-hosted/operate/observability/troubleshooting) names the symptoms.
