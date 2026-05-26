---
title: Trust and compliance
description: Which compliance posture Tale Cloud ships with, who audits what, which controls are yours, and how to report incidents.
---

Trust and compliance on Cloud is the page an auditor wants. It names the frameworks the platform is certified against, splits responsibilities between Tale and your org cleanly, lists the data-protection controls available to you, and tells you who to call when something goes wrong.

The content here is descriptive — what is shipped today, what evidence Tale can hand over on request. The legal documents themselves (DPA, terms, privacy) live under [Legal](/legal/privacy); this page is the operator's quick reference.

## A worked control — audit logs end to end

The org's compliance officer needs to demonstrate that "every change to access control is logged with the actor, the target, and the timestamp". Tale's [Audit logs](/platform/admin/governance/audit-logs) record every member invite, role change, removal, and 2FA reset with the actor's user ID, the affected member's ID, and an ISO timestamp. Logs are immutable — restoring a snapshot does not modify them — and retained per the org's configured floor. The officer exports a date range as CSV, hands it to the auditor, and the worked example clears the control.

## Certifications and frameworks

Tale Cloud is currently audited or attested against the following frameworks; the certification reports are available under NDA via support:

- SOC 2 Type II (annual)
- ISO/IEC 27001
- GDPR-aligned controls (EDPB guidance applied)
- FADP-aligned controls for the Switzerland region (revDSG)

Pending or planned: HIPAA BAA (US enterprise customers), additional regional attestations as the region list grows.

## Shared-responsibility split

| Control                       | Tale              | You                    | Evidence                                                 |
| ----------------------------- | ----------------- | ---------------------- | -------------------------------------------------------- |
| Infrastructure availability   | ✓                 |                        | Status page, SOC 2 SLA report                            |
| Data encryption at rest       | ✓                 |                        | Architecture description                                 |
| Encryption in transit         | ✓                 |                        | TLS termination by Tale's edge                           |
| Member identity and roles     |                   | ✓                      | [Members and roles](/platform/admin/members-and-roles)   |
| API key issuance and rotation |                   | ✓                      | [API keys](/platform/admin/api-keys)                     |
| Content filtering and DLP     | Provides hooks    | Configures rules       | [Guardrails](/platform/admin/governance/guardrails)      |
| Audit-log retention           | Provides storage  | Sets retention         | [Retention](/self-hosted/configuration/retention)        |
| Data-subject requests         | Provides workflow | Initiates and approves | [DSRs](/platform/admin/governance/data-subject-requests) |
| Provider credentials          |                   | ✓                      | [Providers](/platform/admin/providers)                   |

## Data protection controls

Inside the product, three control surfaces matter for compliance:

- **Audit logs** — immutable record of who did what; retention configurable.
- **Legal hold** — exempts a record set from retention until lifted; covered in [Legal hold](/platform/admin/governance/legal-hold).
- **Data subject requests** — the request → claim → erasure → audit workflow; covered in [DSRs](/platform/admin/governance/data-subject-requests).

## Reporting incidents

Tale's security incident contact is `security@tale.dev`. Suspected vulnerability disclosure follows the responsible-disclosure policy on the same email. Customer-facing security advisories are published on the status page and emailed to the org's Owner.

## Where this fits

Trust and compliance is the audit-time page; [Data residency](/cloud/data-residency) is the architecture-time page; [Subprocessors](/legal/subprocessors) is the list-of-vendors page. An auditor usually wants all three at once — bookmark them together. If you operate self-hosted, the controls are the same; what changes is who runs the infrastructure beneath them — see [Self-hosted overview](/self-hosted/overview).
