---
title: Security advisories
description: The Tale security advisory feed — CVE format, the four-tier severity scale, the disclosure timeline maintainers commit to, and how to subscribe.
---

Tale publishes a security advisory for every vulnerability that closes through a patched release. The feed lives on GitHub Security Advisories under the `tale-project/tale` repository and mirrors to an RSS endpoint operators can wire into their alerting. This page covers the format every advisory follows, the severity scale Tale uses, the disclosure timeline maintainers commit to, and the three subscription paths.

The advisories are the long-form record. The one-line summary plus a link appears in the **Security** section of each [release note](/self-hosted/operate/release-notes/format).

## The advisory format

Every advisory is a GitHub Security Advisory with a stable identifier of the form `TAL-YYYY-NNN` (Tale's internal id) plus the upstream `CVE-YYYY-NNNNN` if one was assigned. The body is the same ordered set of sections so an operator can scan the load-bearing facts without reading the prose.

- **Summary** — one sentence naming what an attacker could do and what the fix changes.
- **Affected versions** — the version range that contains the vulnerability, in semver form (`>=0.8.0, <0.12.3`).
- **Patched versions** — the first release that contains the fix. Upgrading to or past this version closes the vulnerability.
- **Severity** — one of the four tiers below, plus the CVSS 3.1 vector for operators who score against their own threat model.
- **Workarounds** — what to set, disable, or block to mitigate the vulnerability when an immediate upgrade is not possible. Empty when no workaround exists.
- **Credits** — the reporter, when they have asked to be named.

The patched-version row is the one most operators land on first; the upgrade itself is the two-command sequence from [Upgrades](/self-hosted/operate/upgrades).

## The severity scale

Tale uses four tiers. The tier is set from the CVSS score and the reachability of the vulnerable surface on a default install.

| Tier     | CVSS    | What it means                                                                                                                |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Critical | 9.0+    | Pre-authenticated remote code execution or unauthenticated data exfiltration. Patch within 24 hours.                         |
| High     | 7.0–8.9 | Authenticated escalation, sandbox escape, or cross-tenant data leak. Patch within a week.                                    |
| Moderate | 4.0–6.9 | Information disclosure, denial of service, or escalation requiring rare preconditions. Patch on the next maintenance window. |
| Low      | 0.1–3.9 | Defence-in-depth fixes and hardening without a known exploit path. Patch when convenient.                                    |

The CVSS vector lets you re-score against your own deployment — an advisory rated High against a public install may be Low against an air-gapped one.

## The disclosure timeline

Maintainers commit to the following timeline from the moment a report lands at `security@tale.dev`:

- **Within 72 hours** — acknowledgement, a triage call, and a TAL identifier assigned.
- **Within 14 days** — a fix or a workaround published privately to the reporter, and the patched version planned.
- **At fix release** — the advisory publishes on GitHub, the CVE assignment is requested, and the security section of the release notes carries the summary.
- **30 days after release** — the technical detail in the advisory expands with the reproducer (when reproducing in public no longer puts unpatched installs at risk).

Reporters can request a delay if they need more time to disclose; maintainers accept up to 90 days before publishing the summary anyway.

## Subscribing

Three paths to the same feed:

```text
GitHub watch         — github.com/tale-project/tale → Watch → Custom → Security alerts
RSS                  — https://github.com/tale-project/tale/security/advisories.atom
Email digest         — security-announce@tale.dev (one mail per advisory, no traffic between)
```

The RSS feed is what most operators wire into Slack or PagerDuty; the email digest is for one-person teams that do not run an alerting pipeline.

## Where this fits

The advisory feed is one of the two contracts that make Tale safe to self-host — release notes name what changes, advisories name what was wrong. The natural next reads are [How to read release notes](/self-hosted/operate/release-notes/format) for the matching change-log format and [Hardening](/self-hosted/operate/security/hardening) for the checklist that limits exposure before an advisory ever fires.
