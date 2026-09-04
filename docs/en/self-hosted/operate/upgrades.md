---
title: Upgrades
description: How `tale update` moves a Tale instance forward — automatic CLI/instance version alignment, the rolling restart pattern, what to do before an upgrade, and the version compatibility story.
---

Upgrades on a self-hosted Tale instance run through two commands: `tale update` moves the CLI binary to the new version and syncs your project files to match, then `tale deploy` rolls the platform containers. The deploy uses a blue-green pattern — the new colour starts alongside the old, healthchecks pass, traffic flips, the old colour drains. Zero downtime is the default; if a patch release misbehaves, `tale rollback` returns to the previous patch in one command, and anything bigger recovers from the pre-upgrade snapshot.

**One hard exception:** there is no upgrade path onto 0.5 from an earlier line. 0.5 is a breaking cutover that requires a fresh deployment — see [0.4 → 0.5: breaking cutover](#04--05-breaking-cutover) before anything else if your instance is on 0.4.x or older (0.4 itself was the previous such cutover, severing 0.3.x).

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
- **Backend & compute** — `backend-api`, `backend-worker`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` — roll on every deploy too, so they never version-skew from `platform`. Each recreates **in place** when its image actually changed; the deploy first drains its in-flight work (chat turns for the backend, agent runs for `sandbox`) so the brief restart doesn't cut a live request.
- **Stop-gated tier** — `db`, `object-store`, `proxy` — left **running and untouched** by default (recreating Postgres, the blob store, or the proxy is a brief outage you don't want on a routine roll). Pass `--stop` to update them; the deploy warns and names them when it skips.

```bash
# After tale update, roll the containers to match (app tier + backend)
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

## How schema changes reach a deployment

Database schema changes are not a separate step you run. Each release's backend applies its own SQL migrations **at boot**, under an advisory lock so the api and worker containers (and any scaled replicas) apply them exactly once while the others wait. A deployed container is therefore always at its own schema — there is nothing to check, apply, or roll forward by hand.

Migrations are **forward-only** and written to be safe under a rolling deploy: the previous version keeps serving while the new one migrates, so a release never ships a change that breaks the version it is replacing. Going BACK a version is a snapshot restore, not a down-migration — which is why `tale rollback` refuses minor and major downgrades (see below).

```bash
# Re-provision the built-in defaults into every organization (idempotent).
# The same step every deploy runs — use it when you want it on demand.
tale migrate
```

If the backend cannot apply a migration it fails to start, and the deploy's healthcheck blocks the traffic flip: the previous colour keeps serving while you read `docker compose logs` and fix the cause. Nothing half-migrated is ever put in front of users.

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
- **The 0.5.0 baseline** — versions below 0.5.0 and versions from 0.5.0 on are separate worlds: no upgrade in either direction, see the cutover section below.

Skipping minor versions (going from 0.9 to 0.11) is supported as long as the intermediate schema migrations are still in the image; the release notes call it out when this is not the case. The 0.5.0 baseline is the standing instance of that exception: the application store itself changed at 0.5, so no 0.5+ release can read what came before.

To move _down_ a version deliberately — say a minor release misbehaves — pin the target with `tale update --version <version>`. The command warns when the target is older than the running version; downgrade only to a version whose schema migrations are a prefix of what the database has applied, or restore a volume snapshot from before the upgrade. A downgrade below 0.5.0 crosses the cutover backwards and is not supported: a 0.4.x release cannot read data created by 0.5+ — restore a pre-0.5 snapshot or deploy 0.4.x fresh instead.

## 0.4 → 0.5: breaking cutover

0.5 replaced the application backend's runtime and store: application data now lives in Postgres, where 0.4 kept it in the bundled Convex service's own database. No importer bridges the two, so **a 0.4.x instance cannot be upgraded in place — 0.5 requires a fresh deployment.**

**What this means in practice:**

- `tale deploy` with a 0.5+ CLI **refuses** to touch an instance whose running version is below 0.5.0, before pulling an image or writing anything.
- Nothing from a 0.4 instance's database is carried over: chats, automations and their run history, knowledge entries, task history, users and sign-ins. The org **config tree** (agents, skills, providers, governance policies) lives on the shared config volume as files and does carry forward; files in a BYO-S3 bucket physically remain in the bucket, but the new instance has no references to them.
- The 0.4.x line stays maintained for security and critical fixes on the `release/0.4` branch — staying on 0.4.x for a while is a supported choice, moving to 0.5 is a re-onboarding, not an upgrade.

**Moving to 0.5:**

```bash
# 1. Leave the 0.4 instance untouched (it keeps serving).
# 2. Create a NEW project directory with a 0.5 CLI:
mkdir tale-05 && cd tale-05
tale init
tale deploy

# 3. Re-onboard: organizations, users (invite / SSO), configuration,
#    documents and knowledge re-upload.
# 4. Decommission the 0.4 instance once the new one is accepted.
```

The expert override — `tale deploy --accept-data-loss` — exists for the rare case where you deliberately reuse a host whose old volumes you have already dealt with. It does exactly what its name says: pre-0.5 data on that instance becomes permanently unreadable.

**The legacy `tale_platform` database.** Every `tale-db` container used to create an empty `tale_platform` database on start — the database the bundled Convex service used in 0.4, which nothing in 0.5 reads. Fresh installs no longer create it, and nothing drops it for you: an instance first deployed on an earlier 0.5 release still carries it, and so does a reused 0.4 host. It is harmless. Once you are sure you need nothing from the Convex era, take a snapshot and drop it by hand — on `db`, and on `knowledge-db` where your stack runs one:

```bash
tale backup
docker compose exec db psql -U tale -d tale -c 'DROP DATABASE IF EXISTS tale_platform;'
```

## Where this fits

The upgrade flow ties together every other operate page — backups are what makes a failed upgrade recoverable, observability is what tells you the new colour is healthy, hardening is what you re-walk after a major version. If you are setting up the CLI for the first time, [Install the tale CLI](/self-hosted/install/cli-install) covers the workstation-side setup; if you are picking up the pager mid-rollout, [Troubleshooting](/self-hosted/operate/observability/troubleshooting) names the symptoms.
