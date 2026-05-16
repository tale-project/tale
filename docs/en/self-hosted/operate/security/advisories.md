---
title: Security advisory process
description: How Tale coordinates, files, and publishes security-relevant fixes.
---

This page documents how Tale handles security-relevant fixes from initial report to published advisory. The shape is conventional: a private draft on GitHub, a patched release, then a public advisory with CVE linkage and a cross-reference in the release notes. The page exists so operators know what to watch for and so reporters know what to expect from a disclosure.

The operator-side takeaway is short — subscribe to GitHub Security Advisories on `tale-project/tale` and read the `## 🔒 Security` section of every release. Anything that earns a CVE shows up in both places, with the upgrade path and the workarounds named explicitly.

## Where advisories live

The **primary channel** is [GitHub Security Advisories](https://github.com/tale-project/tale/security/advisories) on `tale-project/tale`. Advisories are drafted privately, linked to a CVE when severity warrants it, and published only after a patched release is available. The advisory body names every affected version range, the patched version tag, the impact summary, and the upgrade path.

Every advisory is **cross-referenced** in the corresponding GitHub release notes under the `## 🔒 Security` section — see [Release notes format](/self-hosted/operate/release-notes/format) for the canonical shape. An operator scanning a release for security relevance never has to leave the notes; the bullet there names the CVE and links to the advisory.

For **direct notification** of critical advisories, Ruler GmbH emails known deployment operators before public disclosure. There is no automated operator email list yet — this is a future work item. Subscribing to GitHub Security Advisories on the repo (`GitHub → Watch → Custom → Security advisories`) is the immediate substitute, free, and works today.

## When to file an advisory

File a GitHub Security Advisory whenever any of these applies:

- CVSS v3.1 score of 4.0 or higher (Medium and above).
- Any bug that could leak secrets across tenants, leak session tokens, or escalate privileges.
- Any fix in authentication, session handling, organisation scoping, cryptography, or secrets storage — even when no external report triggered it.
- Any reachable dependency CVE — meaning the vulnerable code path is actually exercised by Tale.

Do **not** file an advisory for dependency CVEs whose code paths are demonstrably unreachable by Tale. Document those in the normal `## 🔒 Security` release notes section instead, with a note on why they are not exploitable here. Advisory inflation hurts operator signal more than it helps.

## Severity-to-escalation matrix

| CVSS             | Advisory | Release notes               | Direct email to operators                                           |
| ---------------- | -------- | --------------------------- | ------------------------------------------------------------------- |
| Critical (9.0+)  | Required | Required, prominent summary | Yes — before public disclosure if coordinated, otherwise at publish |
| High (7.0–8.9)   | Required | Required                    | Only if exploitation requires no user action                        |
| Medium (4.0–6.9) | Required | Required                    | No                                                                  |
| Low (<4.0)       | Optional | Required                    | No                                                                  |

The matrix is the ground truth — anything not listed there is editorial discretion in the advisory body.

## Disclosure timeline

A security fix moves through six steps from report to publication.

1. **Private draft** filed in GitHub Security Advisories. The draft includes affected versions, description, and a severity estimate.
2. **CVE requested** via GitHub's advisory UI if severity reaches Medium.
3. **Patched release prepared** on a private branch. Patches do not push to `main` before the advisory is ready to publish.
4. **Coordinated disclosure** with the reporter when externally reported — typically a 90-day maximum embargo, shorter for actively exploited issues.
5. **Advisory published** simultaneously with the patched `tale upgrade` availability. The published advisory references the CVE and the release tag.
6. **Cross-link** in the release notes for the patched version.

The order is deliberate: the patch lands before the advisory so an operator who reads the advisory at publish time can immediately upgrade to the fixed version.

## What an advisory contains

Every published advisory names six things:

- The affected versions (range or list).
- The patched version (exact tag, e.g. `v1.6.1`).
- A summary of impact — what an attacker could do.
- Prerequisites for exploitation — network position, auth state, feature flags.
- Workarounds for operators who cannot upgrade immediately.
- Credits to the reporter, with the reporter's permission.

The combination of "impact" and "prerequisites" is what lets an operator decide whether they're exposed without reading the patch.

## Operator action

Operators reading this page should do three things.

Watch `tale-project/tale` releases at the **Security advisories** notification level — `GitHub → Watch → Custom → Security advisories` is free, runs through GitHub's own email system, and needs no platform-side work.

Treat every `## 🔒 Security` entry in release notes as an upgrade prompt. Even when the linked advisory looks unrelated to your deployment, the bullet exists because something underlying — auth, crypto, secrets, a reachable dependency — moved.

Subscribe to the direct critical-only notification list once it exists. For now, the GitHub Watch feed is the only push channel.

## Where this fits

Security advisories are how Ruler GmbH discloses CVEs and how operators learn what to patch on a self-hosted instance. Every advisory points at a Tale release that contains the fix; operators run `tale deploy` to roll forward, and Cloud customers get the same fix on the next platform deploy. The release-notes side of the same event lives at [Release notes format](/self-hosted/operate/release-notes/format) under the `## 🔒 Security` section; the `/release` slash command in the main repository drafts that section automatically when a release ships.
