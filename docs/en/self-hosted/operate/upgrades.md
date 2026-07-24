---
title: Upgrades
description: How `tale update` moves a Tale instance forward — automatic CLI/instance version alignment, the rolling restart pattern, what to do before an upgrade, and the version compatibility story.
---

Upgrades on a self-hosted Tale instance run through two commands: `tale update` moves the CLI binary to the new version and syncs your project files to match, then `tale deploy` rolls the platform containers. The deploy uses a blue-green pattern — the new colour starts alongside the old, healthchecks pass, traffic flips, the old colour drains. Zero downtime is the default; if a patch release misbehaves, `tale rollback` returns to the previous patch in one command, and anything bigger recovers from the pre-upgrade snapshot.

What you no longer do is keep the CLI in sync by hand: the CLI aligns itself to the instance automatically (see below), so the only deliberate step is choosing when to move versions with `tale update`.

The CLI install lives in [Install the tale CLI](/self-hosted/install/cli-install). This page covers what each command does and how the version model works.

## The CLI tracks the instance automatically

The CLI binary is always the same version as the instance it manages. The workspace records that version in `tale.json`; on every command the CLI compares its own version against it and, if they differ, self-updates the binary to match (up or down) before running. When they already match — the overwhelmingly common case — this is a no-op with no network call, so you never notice it.

That means you rarely run `tale update` except when you deliberately want to move to a new version. A teammate who installed a newer CLI than your instance, or restored an older snapshot, gets the right CLI version automatically on their next command. There is no flag to turn this off — keeping the tool and the instance in lockstep is what makes deploys safe.

## Before you upgrade

Two things are worth confirming first:

- Your off-host copy of the `backups` volume is current — see [Backups and restore](/self-hosted/operate/backups-and-restore). `tale update` snapshots the data volumes automatically before any step that can migrate data, but the snapshot lives on the same host; the off-host copy is what survives a dead disk.
- The release notes for the target version do not name a breaking change. The notes are linked from the GitHub release page; breaking changes are flagged as such at the top.

If the upgrade crosses a major version (1.x → 2.x), read the migration notes end-to-end before starting. Major versions are where schema migrations and config-file format changes land.

## The two commands

`tale update` updates the CLI binary and then syncs your project files to that version's templates. It does **not** touch the running containers — that is `tale deploy`'s job. If the file sync fails, the CLI rolls its own binary back to the version your workspace was on, so the binary and `tale.json` never drift apart.

Run bare, the command targets the newest release **in your current x.y release line** — a 0.3.x instance moves to the newest 0.3.x. Releases on a newer line can be breaking, so `tale update` never crosses that boundary on its own: when a newer line exists it says so and stays put. Moving lines is a deliberate step — read the release notes for the new line first, then pin it with `--version`.

```bash
# Move the CLI + project files to the newest release in the current x.y line
tale update

# Pin a specific version — the only way to change lines; allows downgrades (see Rolling back)
tale update --version 0.10.2

# Preview the version change and file sync without touching anything
tale update --dry-run
```

`tale deploy` does the actual rolling restart, and it always deploys the CLI's own version — which, thanks to alignment, is the version your workspace records. It sorts the services into three tiers:

- **App tier** — `platform` — rolls on **every** deploy with zero downtime (blue-green: the new colour starts alongside the old, healthchecks pass, traffic flips, the old colour drains).
- **Backend & compute** — `convex`, `sandbox`, `sandbox-egress` — roll on every deploy too, so they never version-skew from `platform`. Each is a single container that recreates **in place** when its image actually changed; the deploy first drains its in-flight work (chat generations for `convex`, agent runs for `sandbox`) so the brief restart doesn't cut a live request.
- **Stop-gated tier** — `db`, `proxy` — left **running and untouched** by default (recreating Postgres or the proxy is a brief outage you don't want on a routine roll). Pass `--stop` to update them; the deploy warns and names them when it skips.

```bash
# After tale update, roll the containers to match (app tier + convex)
tale deploy

# Also update db/proxy (brief downtime while they recreate)
tale deploy --stop

# Roll only specific services
tale deploy --services platform

# Preview without changes
tale deploy --dry-run
```

`--dry-run` is worth running before every production upgrade — it surfaces missing images, missing migrations, and dependency mismatches without touching the running containers.

## The blue-green pattern

A running instance is one of the two colours (blue or green) at any given time. The deploy phase brings up the other colour, waits for it to pass healthchecks, then flips Caddy's upstream to the new colour. The old colour drains its in-flight requests (default 30 s), then exits.

Three guarantees the pattern gives you:

- **No window where both colours serve traffic.** A database constraint enforces single-active — Caddy routes to the healthy one.
- **Patch rollback is one command.** `tale rollback` redeploys the previous patch release on the idle colour and flips traffic back. It refuses minor and major downgrades — those can leave the database ahead of the binary, and their recovery path is a snapshot restore.
- **Failed healthchecks block the flip.** If the new colour does not pass within the timeout, the deploy aborts and the old colour continues serving.

The full deploy procedure including the cleanup phase lives in `tale --help`; the operator-facing recipe is `tale update && tale deploy && tale status` and visual confirmation in the browser.

## Working with data migrations

Every deploy applies pending data migrations automatically — but only the non-destructive ones. Migrations that remove or overwrite data (a table drop, a column removal) are never run unattended: the deploy skips them, prints which ones are waiting, and leaves the decision to you.

```bash
# What is applied, what is pending, what failed
tale migrate status

# Apply pending migrations, reviewing each destructive step
tale migrate up --step

# Apply everything without prompting (CI / after reviewing the plan)
tale migrate up --yes

# Roll data back to an earlier version
tale migrate down --to 0.3.3
```

Destructive migrations snapshot the affected rows or config files before touching them, so `tale migrate down` can rebuild what they removed. Both directions are resumable: progress is tracked per migration (and per organization for config-file migrations), so a crash or timeout picks up where it stopped instead of starting over.

If a migration fails during a deploy, the platform still boots on its current schema — the boot log prints a prominent error and `tale migrate status` shows the failed migration with the recorded error. Fix the cause, then re-run `tale migrate up`; already-completed work is skipped.

## Rolling back

```bash
# Back to the previous patch version (prompts for confirmation)
tale rollback

# Skip the prompt when running non-interactively
tale rollback --yes
```

`tale rollback` is gated to patch-level steps: it only targets the recorded previous version, and refuses unless that version shares `major.minor` with the running platform. Patch releases never carry migrations, so redeploying the previous patch is always safe. Anything bigger may have migrated data forward — redeploying an older binary on top of migrated data corrupts the instance instead of recovering it. For those, the recovery path is restoring the pre-upgrade snapshot and moving back to the version that matches it with `tale update --version <version>` followed by `tale deploy --stop` (so `db`/`proxy` roll back too); the refusal message prints the exact commands, and the full walk lives in [Backups and restore](/self-hosted/operate/backups-and-restore).

Because the rollback tears down the running containers, the command warns what it is about to do and asks for confirmation before it pulls a single image; pass `--yes` to skip that prompt in scripts or CI.

## Version compatibility

Tale versions are semver. The compatibility rules:

- Patch (`0.9.0 → 0.9.1`) — no migrations, no config changes, `tale rollback` is always safe.
- Minor (`0.9.x → 0.10.x`) — may include forward-only migrations; `tale rollback` refuses, recovery is restore-snapshot-and-redeploy.
- Major (`0.x → 1.x`) — read the migration notes, schedule the maintenance window, expect surprises.

Skipping minor versions (going from 0.9 to 0.11) is supported as long as the intermediate migrations are still in the binary; the release notes call it out when this is not the case.

To move _down_ a version deliberately — say a minor release misbehaves and you have already reversed its migrations — pin the target with `tale update --version <version>`. The command warns when the target is older than the running version and reminds you to reverse data migrations first.

## Upgrading from 0.3.1 or earlier

Instances on version 0.3.1 or earlier keep the Convex backend's data in the `platform-data` Docker volume. Newer versions run Convex as its own service with its own `convex-data` volume — and nothing moves the data across at deploy time. Upgrade straight across that boundary and `tale deploy` pre-creates an **empty** `convex-data` volume: the instance comes up blank while every byte of your data still sits, untouched, in the old `platform-data` volume. Nothing is deleted — but the data does not move by itself, and `tale update` warns when it detects this constellation and offers to run the copy for you on the spot.

Docker has no native volume rename, so the move is a copy through a helper container — the same steps `tale update` runs when you accept its prompt (the old volume stays preserved either way). To do it by hand — you declined the prompt, or the automatic copy failed — run it before `tale deploy`, with the stack stopped, so nothing holds the volume open:

```bash
# 1. Find the legacy volume — <project> is the `id` in tale.json.
docker volume ls | grep platform-data
# Installs older than 0.2.33 used the fixed prefix `tale_` instead
# of `<project>_`; the destination below still uses `<project>_`.

# 2. Stop the running stack.
docker compose -p <project> down

# 3. Create the destination volume and copy the data across.
docker volume create <project>_convex-data
docker run --rm \
  -v <project>_platform-data:/from:ro \
  -v <project>_convex-data:/to \
  alpine sh -c "cd /from && cp -a . /to"

# 4. Roll the stack, then verify your data is there.
tale deploy

# 5. Only after verifying, reclaim the old volume.
docker volume rm <project>_platform-data
```

A dev workspace mirrors the same move under the `-dev` scope: `<project>-dev_platform-data` → `<project>-dev_convex-data`, with `docker compose -p <project>-dev down` as the stop step.

If you already deployed and got an empty instance, your data is still safe in `platform-data`. Stop the stack, remove the freshly created empty volume with `docker volume rm <project>_convex-data`, then run the copy above and deploy again.

## Where this fits

The upgrade flow ties together every other operate page — backups are what makes a failed upgrade recoverable, observability is what tells you the new colour is healthy, hardening is what you re-walk after a major version. If you are setting up the CLI for the first time, [Install the tale CLI](/self-hosted/install/cli-install) covers the workstation-side setup; if you are picking up the pager mid-rollout, [Troubleshooting](/self-hosted/operate/observability/troubleshooting) names the symptoms.
