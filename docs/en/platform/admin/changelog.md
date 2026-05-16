---
title: What's new
description: The in-app changelog viewer — release notes for the Tale version your instance is running, refreshed every upgrade and badge-driven so users can see what changed without leaving the product.
---

The **What's new** dialog is the in-app changelog viewer. After a release lands — whether the Cloud edition rolled forward automatically or `tale deploy` finished on a self-hosted instance — a small badge appears next to each user's avatar pointing at the new entries. Opening the dialog shows the release notes for the version the instance is on, plus every prior version since the user last marked the changelog read. The audience is everyone in the product: Members see what changed in their UI, Admins read the same notes to know what to brief the team on.

This page is for Admins and Developers who need to understand how the dialog renders, where the content comes from, and what is in scope versus excluded. There is no dialog the Admin configures; the badge and the content are driven entirely by released versions.

## How the dialog reaches the reader

Tale shows the badge the moment a release with user-visible changes is detected. Clicking the badge opens the dialog. Each entry has a version number, a release date, and a Markdown body describing what changed in that version.

The badge clears when the dialog is acknowledged — not when it is merely opened. A user who closes the dialog without scrolling through every new entry still sees the badge on the next session, so the indicator behaves like an unread counter rather than a one-shot notification.

When an instance jumps multiple versions in a single upgrade — say `v1.4` to `v1.6` because `v1.5` was skipped — the dialog lists every intermediate version's notes in chronological order. Nothing between the two endpoints is hidden by the jump.

## Where the content comes from

Release notes are published in the canonical format described in [Release notes format](/self-hosted/operate/release-notes/format) on the project's GitHub repository. The platform fetches the notes for every version visible to the current edition at install and upgrade time, caches them locally, and renders the per-version sections through the same Markdown renderer the rest of the docs use.

The render path is short:

1. CI publishes notes on every tagged release.
2. The platform pulls the canonical Markdown at install and upgrade.
3. The dialog renders each per-version section, newest first.
4. The badge counter increments whenever a new version's notes land.

If a self-hosted instance is offline or restricted from reaching GitHub, the upgrade still completes — the dialog falls back to the notes bundled with the release artifact rather than blocking on the network fetch.

## What is in scope, what isn't

The in-app changelog mirrors the canonical GitHub release notes. The content is identical; only the surface differs. The covered changes are the ones a user would notice: new features, breaking changes, fixes the reader can verify, and migration notes for upgrades that require operator action.

Out of scope, by design:

- **Infrastructure-only changes** — dependency bumps, internal refactors, CI tweaks. These live in git history.
- **Cloud-specific operational notes** — incidents and planned maintenance go on the [status page](/develop/status-page), not the changelog.
- **Roadmap announcements** — the marketing site carries those; the changelog only describes shipped versions.

For the operator-side details of an upgrade — the exact CLI flags, the downgrade caveats, the deprecated env vars — [Release notes format](/self-hosted/operate/release-notes/format) is the authoritative source.

## Where this fits

The changelog is the user-facing half of every release. Operators read the GitHub release notes before running `tale deploy` to plan the action items; everyone in the product reads the in-app dialog after the upgrade lands to learn what changed. Together they cover the two ends of every release.

For the live state of the Cloud edition — incidents, maintenance, region status — [Status page](/develop/status-page) is the surface to read instead. For the historical release-notes catalogue across every version, the [release notes format](/self-hosted/operate/release-notes/format) reference is where the canonical entries live.
