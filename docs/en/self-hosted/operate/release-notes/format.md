---
title: How to read release notes
description: The shape Tale's release notes follow — the semver promise, where breaking changes and deprecations sit, how security entries are flagged, and where the per-release migration notes live.
---

Tale ships a release per minor version and patches as bug-fix tags between them. The release notes for every tag follow the same shape so you can scan one in a minute and know whether the upgrade is a five-minute bump or a maintenance window. This page covers the format: the semver promise, what each section guarantees, and where to read deeper when a row points at a migration.

The notes themselves live on the GitHub release page for each tag. The CLI also surfaces them — `tale update --notes` prints the notes for the version it is about to install.

## The semver promise

Tale versions are semver, and the version number is the headline fact about an upgrade.

- **Patch (`0.9.0 → 0.9.1`)** — bug fixes only. No schema migrations, no config changes, no behaviour changes other than the fix itself. Safe to upgrade without reading past the security section.
- **Minor (`0.9.x → 0.10.x`)** — new features, possibly forward-only migrations. Backwards-compatible by default; deprecations are announced one minor in advance. The one standing exception is 0.4.0: a breaking minor that requires a fresh deployment (see [Upgrades → 0.3 → 0.4](/self-hosted/operate/upgrades)).
- **Major (`0.x → 1.x`)** — breaking changes are allowed. Always carries a migration-notes link at the top of the release; read it end-to-end before starting.

The version line at the top of every release page names the bump kind in plain English so you do not have to do the arithmetic yourself.

## The sections every release has

Each release page is the same ordered list of sections. Empty sections are omitted, not left blank — if you do not see a section, there is nothing to report there.

- **Highlights** — one or two paragraphs naming what the release is for. Read this first.
- **Breaking changes** — every change that requires the operator to do something before or after the upgrade. Each row names the symptom you would hit if you skipped, and the action that avoids it.
- **Deprecations** — features still working in this release but flagged for removal. Each row names the removal version so you can plan the cutover.
- **Security** — CVE-format entries for fixes that close a vulnerability. The full feed lives under [Security advisories](/self-hosted/operate/security/advisories); the release notes carry the one-line summary plus the advisory link.
- **Features and fixes** — the long list. Grouped by area (Platform, CLI, Docs); each row reads as one sentence.
- **Migration notes** _(major versions and some minors)_ — the linked walk through schema migrations, config-file changes, or operator-facing renames. Always read for majors.

## How to scan a release

Read the version line, the highlights, and the breaking-changes section. If breaking changes is empty and the security section does not name a fix that touches your install, the upgrade is the `tale update` + `tale deploy` sequence from [Upgrades](/self-hosted/operate/upgrades). If either section has rows, walk them before running `tale deploy`.

```text
0.12.0 (minor) — 2026-05-14

Highlights
  Streaming tool calls now stream into the chat as they emit.

Breaking changes
  (none)

Deprecations
  AGENTS_LEGACY_PROMPT env var — removed in 0.14.

Security
  CVE-2026-XXXX — patched bypass in the run-code sandbox.
  See: advisory TAL-2026-007.
```

The shape above is what `tale update --notes` prints. The web version of the same release adds links on every advisory and migration row.

## Where this fits

The release-notes format is the contract between the project and the operator — the same shape every release so the upgrade decision is a scan, not a deep read. The natural next steps are [Upgrades](/self-hosted/operate/upgrades) for the deploy mechanics and [Security advisories](/self-hosted/operate/security/advisories) for the long-form vulnerability feed the security section links into.
