---
title: Changelog
description: The in-product release viewer that surfaces what changed in the Tale platform itself. Admins read this after an upgrade to see what landed and to share the highlights with the org.
---

The changelog is the in-product viewer that surfaces release notes for the Tale platform itself — not for content your members produce. After a self-hosted upgrade or a managed-cloud rollout, the viewer lists what changed between the previous version and the one running now. Admins read it after an upgrade to brief the team and to flag anything that affects how members work.

The viewer reads release notes from the Tale repository on GitHub and caches each page for an hour, so repeat visits do not refetch — a cold cache still needs GitHub to be reachable.

## Where the changelog lives

The changelog has two surfaces. The **What's new** page lists every recent release with its full notes. The **upgrade toast** fires once per version bump and links straight to the page — the toast shows `Upgraded to v<version>` with a **View** action and dismisses itself after a few seconds; a dot on your avatar persists until you actually open the notes, so a member who was away does not miss the heads-up.

Open the page from your user menu — its footer names the running version and links **What's new** — or from the upgrade toast when it appears. The page fetches up to roughly thirty recent releases; older ones link out to the GitHub release history.

## What each entry shows

Each release entry carries four fields: the version tag, the publish date, the release name (often a short headline), and the release body in Markdown. Tale renders the body the way GitHub does — headings, lists, links, and code fences all survive. Releases that GitHub has not yet published surface a short explainer card with a link to the public release history.

## Scope

The changelog is the platform's changelog — what changed in Tale itself. It does not show changes to your agents, your workflows, or your knowledge base; those have their own per-resource history. If you are looking for the version history of an agent or a workflow, open the resource and switch to the **History** tab.

The viewer is read-only and visible to every signed-in member. There is no Admin-only flag — anyone with an account can open the page. The data the viewer fetches is public release information from the Tale GitHub repository, so there is nothing org-scoped to hide.

## A worked upgrade

After a self-hosted upgrade from `v0.42` to `v0.45`, sign in and look for the upgrade toast in the top right. Click **View** to open the changelog page. The page shows three release entries (`v0.43`, `v0.44`, `v0.45`) newest first, each with the engineer-written notes from the GitHub release. Skim the highlights, share the link with the team if anything needs a wider audience; the toast fires only once per version, and the dot on your avatar clears once you have opened the notes.

When the upgrade spans more than the fetched window, the page shows the most recent entries with a banner that links to GitHub for the earlier notes. The cache stays warm for the next reader on your instance.

## Where this fits

The changelog is the operator's read-out of what Tale itself just did; it sits next to the audit log (which records what your members did) and the providers page (which tracks which model versions are wired). Pair it with [self-hosted upgrade](/self-hosted/operate/upgrades) when you operate the instance — the upgrade guide walks the version bump, and the changelog reads out the result on the other side.
