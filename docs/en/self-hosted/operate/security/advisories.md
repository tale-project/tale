---
title: Follow security advisories
description: Find published security notices, assess whether your deployment is affected, and report a vulnerability privately.
---

Check [Tale’s GitHub Security Advisories](https://github.com/tale-project/tale/security/advisories) and the target version’s [release notes](https://github.com/tale-project/tale/releases) when reviewing a security update. The repository’s [security policy](https://github.com/tale-project/tale/security/policy) defines reporting and supported versions.

## Assess an advisory

Read the affected and patched versions first. Match them to the running runtime and enabled components, not just the CLI installed on your workstation.

| Information | What to establish |
| --- | --- |
| Affected versions and components | Whether the vulnerable code is present in your deployment. |
| Preconditions and impact | Whether your configuration exposes the vulnerable path and what access it could allow. |
| Patched versions | The release that contains the fix. |
| Severity and any CVSS vector | The reported impact and assumptions; also assess your own exposure. |
| Workarounds | The temporary restrictions available if you cannot deploy the fix immediately. |
| Advisory identifier and references | The stable record to use in your incident and deployment notes. |

Do not infer that a deployment is safe solely because it sits on a private network. Authentication, connector behavior and internal access can still matter. Prioritize the response using the advisory and your incident procedure.

## Apply and verify the fix

Tale is a rolling-release 0.x project. Security fixes land in the latest release only; older versions do not receive backports. Read the notes for every release you cross, then follow [Upgrades](/self-hosted/operate/upgrades), including backup and recovery preparation.

Record the installed fix and verify the affected behavior after deployment. If you used a temporary workaround, remove it only when the corrected runtime is running and your checks pass.

## Report a vulnerability privately

Open the repository’s **Security** tab and choose **Report a vulnerability**. If you cannot use GitHub, email `security@tale.dev`. Do not disclose an unpatched vulnerability in a public issue.

Include the affected component and version, reproduction steps and likely impact. Use a minimal reproduction without credentials, personal data or unnecessary production records. Reporters can request credit in the resulting advisory.

The security policy commits to acknowledgement and triage within 72 hours, a fix or workaround shared privately with the reporter within 14 days, and publication of a GitHub Security Advisory with the patched release. Use the private report for coordination while investigation is underway.

## Keep the review repeatable

Bookmark the advisory and release pages and include them in your regular update review. Record who checks them, which deployments they cover and where urgent findings are escalated. [Release review](/self-hosted/operate/release-notes/format) provides the broader checklist; [Hardening](/self-hosted/operate/security/hardening) covers controls that reduce exposure between updates.
