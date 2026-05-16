---
title: Release notes format
description: Authoritative format for GitHub release notes on tale-project/tale.
---

Tale ships its release history as GitHub release notes against the `tale-project/tale` repository, in a fixed shape so operators can scan a release for the three things that matter before an upgrade — security relevance, behavioural change, breaking change — without reading every bullet. This page is the contract: it names every section, the order they appear in, the framing every release shares, and the classification rules that decide which bullet lands where.

Operators read these notes before running `tale upgrade`; the same Markdown the `/release` slash command in the main repo drafts is what the in-product **What's new** viewer renders. Consistency of shape is the load-bearing property — once an operator has read three releases, they know exactly where to look for the security entries, the model bumps, and the migration steps.

## Why this spec exists

Operators and end users rely on release notes to answer three questions before upgrading:

- Does this release fix a security issue that affects me?
- Did a model or provider change shift the output of any workflow I run?
- Does this upgrade require manual steps?

Consistent sectioning in a consistent order makes those three answers findable in seconds, without reading every bullet. The spec exists to keep that contract loud across every release.

## Required sections

Include only the sections that have content; never include an empty section. The order is fixed:

| Order | Section header           | Scope                                                                              |
| ----- | ------------------------ | ---------------------------------------------------------------------------------- |
| 1     | `## 🔒 Security`         | CVE fixes, dependency patches, auth/session/crypto hardening, secret handling.     |
| 2     | `## 🤖 Model & Provider` | LLM model swap/upgrade/deprecation, provider config changes that alter output.     |
| 3     | `## 💥 Breaking Changes` | API removal/renaming, schema changes requiring manual migration, removed features. |
| 4     | `## 🚀 Features`         | New user-visible functionality.                                                    |
| 5     | `## ⚡ Performance`      | Measurable performance wins worth calling out.                                     |
| 6     | `## 🛠 Improvements`     | Non-breaking enhancements, UX polish.                                              |
| 7     | `## 🐛 Fixes`            | Bug fixes (non-security).                                                          |
| 8     | `## 📝 Other`            | Docs, refactors, chores. Use sparingly.                                            |

## Required framing

Every release includes, at minimum, four pieces of framing on top of the section bullets.

**Title.** Format `v{version} — {short tagline}`, e.g. `v1.6.0 — Usage analytics & multi-tenancy`. The tagline is the one-line headline the changelog viewer renders next to the version number.

**Summary.** Two to three sentences at the top describing what changed and why. No emoji in the summary — emoji are reserved for the section headers below.

**Upgrade instructions.** A short block at the bottom of the notes that names the two commands every upgrade involves:

```markdown
## Upgrade

Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.
```

Both steps are required. `tale upgrade` fetches the new CLI binary; `tale deploy` rolls the new version onto the running stack. Omitting either leaves the deployment on the old version, which is the most common upgrade mistake.

**Manual migration notes** (only when relevant). If any breaking change requires operator action beyond `tale deploy`, include a `## Migration Guide` section with numbered steps. This is the section operators look for when the title or summary mentions a breaking change.

**Full Changelog link** at the bottom:

```markdown
**Full Changelog**: https://github.com/tale-project/tale/compare/v{previous}...v{new}
```

## Classification rules

A bullet lands in `## 🔒 Security` whenever it touches authentication, sessions, secrets storage, cryptography, or any reachable dependency CVE. When the categorisation is ambiguous, classify as security and also file a [Security Advisory](/self-hosted/operate/security/advisories) — it's cheaper to retract a non-issue than to under-disclose a real one.

`## 🤖 Model & Provider` catches anything that could alter LLM output for the same user input — model bumps, provider swaps, prompt or template changes in default agents.

`## 💥 Breaking Changes` is reserved for changes where users or operators must do something to keep working after upgrade. If `tale upgrade` followed by `tale deploy` is enough, it isn't breaking.

`## 📝 Other` is for changes worth mentioning that fit nowhere else. Trivial chores (typo fixes, internal refactors, test-only changes) are omitted entirely — they're git history, not release notes.

## A worked release

```markdown
# v1.6.0 — Usage analytics & multi-tenancy

This release adds time-based usage analytics, hardens multi-tenant org isolation,
and bumps the default reasoning model. No breaking changes.

## 🔒 Security

- Tighten org-scoping on governance policy queries (#1573)

## 🤖 Model & Provider

- Default reasoning model bumped from Opus 4.6 → Opus 4.7 (#1590)

## 🚀 Features

- Time-based usage analytics dashboard under `/metrics/usage` (#1574)
- Multi-org support: users can belong to multiple organizations (#1573)

## 🛠 Improvements

- Tabs underline variant adopted across settings surfaces (#1571)

## 🐛 Fixes

- Fix prompt library sidebar scroll on short viewports (#1572)

## Upgrade

Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.

**Full Changelog**: https://github.com/tale-project/tale/compare/v1.5.2...v1.6.0
```

## Where this fits

The release-notes format is the contract between Ruler GmbH and every operator running a self-hosted Tale instance. The same Markdown the in-app [What's new](/platform/admin/changelog) viewer renders is what operators consult before running `tale upgrade`; consistent shape is what makes the notes scannable. The `/release` slash command in the main repository drafts notes following this spec. For security-grade fixes that also warrant a CVE disclosure, [Security advisories](/self-hosted/operate/security/advisories) is the parallel surface.
