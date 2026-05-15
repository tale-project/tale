---
title: What's new
description: The in-app changelog viewer — release notes for the Tale version your instance is running, kept up to date across upgrades.
---

The **What's new** dialog is the in-app changelog viewer. After an upgrade — whether the Cloud edition rolled forward or `tale deploy` finished on your self-hosted instance — a small badge appears in the navigation pointing at the new entries; opening the dialog shows the release notes for the version you're on, plus every prior version since you last visited. The audience is everyone in the product: Members see what changed in their UI, Admins read the same notes to know what to brief the team on.

This page is for Admins and Developers who want to understand how the dialog renders, where its content comes from, and what's covered vs. excluded.

## How the dialog reaches the reader

A small badge appears next to a user's avatar after a release that introduces user-visible changes. Click it to open the **What's new** dialog. The dialog lists every version published since the user last marked the changelog read; each entry has a version number, a release date, and a Markdown body describing what changed.

The badge clears the moment the dialog is acknowledged — not when it's just opened. Closing the dialog without scrolling through every new entry leaves the badge in place until the next session.

## Where the content comes from

Release notes are published in the canonical [release notes format](/self-hosted/operate/release-notes/format) on the project's GitHub repository. The platform fetches the notes for every version visible to the current edition and renders them in the dialog. Cross-version upgrades — say jumping from `v1.4` to `v1.6` because `v1.5` was skipped — show every intermediate version's notes in chronological order, so no change between the two versions is hidden by the jump.

The render path:

1. The CI publishes notes on every tagged release.
2. The platform pulls the canonical Markdown source at install/upgrade time.
3. The dialog renders the per-version Markdown sections in chronological order.
4. The badge counter increments when a new version's notes land.

## What's in scope, what isn't

The in-app changelog mirrors the canonical GitHub release notes — same content, just rendered inside the product. It covers user-visible changes: new features, breaking changes, bug fixes that the reader would notice, and migration notes for upgrades that require operator action.

It does **not** cover infrastructure-only changes (dependency bumps, internal refactors), Cloud-specific operational notes (those go to status posts), or roadmap announcements (those live on the marketing site). For the operator-side detail of an upgrade — exact CLI flags, downgrade caveats, deprecated env vars — the [release-notes-format reference](/self-hosted/operate/release-notes/format) is the authoritative source.

## Where this fits

The changelog is the user-facing communication layer for upgrades. Operators read the GitHub release notes before running `tale deploy`; everyone in the product reads the in-app dialog after the upgrade lands. Together they cover both ends of the release: the operator gets the action items, the user gets the explanation. For the public status of the Cloud edition (incidents, planned maintenance), [Status page](/develop/status-page) is the surface.
