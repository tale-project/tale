---
title: Security advisory process
description: How Tale coordinates, files, and publishes security-relevant fixes.
---

How Tale coordinates, files, and publishes security-relevant fixes.

## Channels

- **Primary**: [GitHub Security Advisories](https://github.com/tale-project/tale/security/advisories) on `tale-project/tale`. Advisories are drafted privately, linked to CVE when applicable, then published after a patched release is available.
- **Secondary**: every advisory is cross-referenced in the corresponding GitHub Release notes under the `## 🔒 Security` section (see [release-notes-format.md](/self-hosted/operate/release-notes/format)).
- **Direct notification** (manual, for now): critical advisories are emailed to known deployment operators. There is no automated operator email list yet — this is a future work item.

## When to file an advisory

File a GitHub Security Advisory when any of the following applies:

- CVSS v3.1 score ≥ 4.0 (Medium or higher).
- Any bug that could leak secrets across tenants, leak session tokens, or escalate privileges.
- Any fix in authentication, session, organization-scoping, crypto, or secrets storage — even if no external report triggered it.
- Any reachable dependency CVE (the vulnerable code path is exercised by Tale).

**Do not** file an advisory for dependency CVEs whose code paths are demonstrably unreachable by Tale — document those in the normal `## 🔒 Security` release notes section instead, with a note on why they are not exploitable here.

## Severity → escalation matrix

| CVSS             | Advisory   | Release notes               | Direct email to operators                                           |
| ---------------- | ---------- | --------------------------- | ------------------------------------------------------------------- |
| Critical (9.0+)  | Required   | Required, prominent summary | Yes — before public disclosure if coordinated, otherwise at publish |
| High (7.0–8.9)   | Required   | Required                    | Only if exploitation requires no user action                        |
| Medium (4.0–6.9) | Required   | Required                    | No                                                                  |
| Low (&lt;4.0)    | Optional   | Required                    | No                                                                  |

## Timeline

1. **Private draft** in GitHub Security Advisory. Include affected versions, description, severity estimate.
2. **Request CVE** via GitHub's advisory UI if severity ≥ Medium.
3. **Prepare patched release** on a private fork/branch. Do not push patches to `main` before the advisory is ready to publish.
4. **Coordinated disclosure** with the reporter if externally reported — typically 90 days max embargo, shorter for actively exploited issues.
5. **Publish advisory** simultaneously with the patched `tale upgrade` availability. Reference the CVE and the release tag.
6. **Cross-link** in the release notes for the patched version.

## What to include in an advisory

- Affected versions (range or list).
- Patched version (exact tag, e.g. `v1.6.1`).
- Summary of impact — what an attacker could do.
- Prerequisites — network position, auth state, feature flags required to exploit.
- Workarounds for operators who cannot upgrade immediately.
- Credits to the reporter (with permission).

## Operator action

Operators should:

- Watch `tale-project/tale` releases (`GitHub → Watch → Custom → Security advisories` is free, no platform work needed).
- Treat `## 🔒 Security` entries in release notes as an upgrade prompt.
- Subscribe to the direct notification list (once it exists) for critical-only alerts.

## Related

- [Release notes format](/self-hosted/operate/release-notes/format) — where Security entries live in notes.
- The `/release` slash command in the main repository drafts the Security section.
