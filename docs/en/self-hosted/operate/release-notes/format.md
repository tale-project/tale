---
title: Release notes format
description: Authoritative format for GitHub release notes on tale-project/tale.
---

Tale ships its release history as GitHub release notes against the `tale-project/tale` repository, in a fixed shape so operators can scan a release for the three things that matter before an upgrade — security relevance, behavioural change, breaking change — without reading every bullet. This page is the contract: it names every section, the order they appear in, the framing every release shares, and the classification rules that decide which bullet lands where. The `/release` slash command in the main repository drafts notes against this spec, and the in-product **What's new** viewer renders the same Markdown.

## Why this spec exists

Operators and end-users rely on release notes to know:

- Whether a security fix affects them.
- Whether a model or provider change will shift their workflow outputs.
- Whether an upgrade requires manual steps.

Consistent sectioning — in a consistent order — makes it easy to scan a release for the three things above without reading every bullet.

## Required sections

Include only the sections that have content. Always use this order:

| Order | Section header           | Scope                                                                             |
| ----- | ------------------------ | --------------------------------------------------------------------------------- |
| 1     | `## 🔒 Security`         | CVE fixes, dependency patches, auth/session/crypto hardening, secret handling     |
| 2     | `## 🤖 Model & Provider` | LLM model swap/upgrade/deprecation, provider config changes that alter output     |
| 3     | `## 💥 Breaking Changes` | API removal/renaming, schema changes requiring manual migration, removed features |
| 4     | `## 🚀 Features`         | New user-visible functionality                                                    |
| 5     | `## ⚡ Performance`      | Measurable performance wins worth calling out                                     |
| 6     | `## 🛠 Improvements`     | Non-breaking enhancements, UX polish                                              |
| 7     | `## 🐛 Fixes`            | Bug fixes (non-security)                                                          |
| 8     | `## 📝 Other`            | Docs, refactors, chores — include sparingly                                       |

## Required framing

Every release must include, at minimum:

1. **Title**: `v{version} — {short tagline}`, e.g. `v1.6.0 — Usage analytics & multi-tenancy`.
2. **Summary**: 2–3 sentences at the top describing what changed and why. No emoji.
3. **Upgrade instructions**:

   ```markdown
   ## Upgrade

   Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.
   ```

   Both steps are required — `tale upgrade` fetches the new CLI, `tale deploy` applies it. Omitting either leaves the deployment on the old version.

4. **Manual migration notes** (only when relevant): if any breaking change requires operator action beyond `tale deploy`, include a `## Migration Guide` section with numbered steps.
5. **Full Changelog link** at the bottom:
   ```markdown
   **Full Changelog**: https://github.com/tale-project/tale/compare/v{previous}...v{new}
   ```

## Classification rules

- **Security**: anything touching authentication, session, secrets storage, crypto, or reachable dependency CVEs. When in doubt, classify as security AND file a [Security Advisory](/self-hosted/operate/security/advisories).
- **Model & Provider**: any change that could alter LLM output for the same user input — model bumps, provider swaps, prompt/template changes in default agents.
- **Breaking Changes**: users or operators must do something to keep working after upgrade. If upgrade "just works," it is not breaking.
- **Other**: only for changes worth mentioning that fit nowhere else. Trivial chores (typo fixes, internal refactors, test-only changes) should be omitted.

## Example

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

The release-notes format is the contract between Ruler GmbH and every operator running a self-hosted Tale instance. The same Markdown the in-app [What's new](/platform/admin/changelog) viewer renders is what `tale deploy` readers consult before upgrading; consistent shape is what makes the notes scannable. The `/release` slash command in the main repository drafts notes following this spec. For security-grade fixes that also warrant a CVE disclosure, [Security advisories](/self-hosted/operate/security/advisories) is the parallel surface.
