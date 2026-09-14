---
title: Security and compliance
description: Find certification information, understand responsibilities, and collect evidence for a security review.
---

Tale holds ISO/IEC 27001 and SOC 2 Type II certifications. For a security review, ask your Tale contact for the applicable certificates, report scope, and supporting documents; use the evidence relevant to the service your organization has purchased.

Product controls support your organization’s processes. Whether a particular use meets your obligations also depends on your configuration, connected providers, and operating procedures.

## Prepare a review

Bring together your service agreement, data-processing agreement, the relevant certification evidence, and a description of your deployment. The [privacy policy](/legal/privacy) and [subprocessor information](/legal/subprocessors) provide additional context. Record the version and scope of each document in your review.

Clarify which organization and deployment the review covers. A certification statement is not a substitute for checking whether a particular service or configuration falls within the report’s scope.

## Know who is responsible

| Area | Tale on Cloud | Your organization |
| --- | --- | --- |
| Hosting and maintenance | Operates the agreed service | Chooses the service and coordinates changes |
| Identity and access | Provides account, role, and SSO controls | Adds members, grants access, and reviews it |
| Model providers and connectors | Provides integration controls | Chooses services, credentials, and permitted uses |
| Usage and content policies | Provides policy controls and records | Configures rules and responds to events |
| Data requests and retention | Provides the supported workflows | Determines requirements and authorizes actions |

For self-hosted deployments, your operator also owns the infrastructure responsibilities. Enterprise support arrangements depend on your agreement.

## Check the controls in the product

- [Members and roles](/platform/admin/members-and-roles) define access. Review inactive accounts and elevated roles.
- [Enterprise SSO](/platform/admin/enterprise-sso) connects your identity provider. Test both sign-in and recovery before requiring it.
- [Audit logs](/platform/admin/governance/audit-logs) help investigate recorded actions. Use [audit-log integrity](/self-hosted/operate/security/audit-log-integrity) when evaluating tamper evidence and its limits.
- [Guardrails](/platform/admin/governance/guardrails), [legal hold](/platform/admin/governance/legal-hold), and [data-subject requests](/platform/admin/governance/data-subject-requests) support specific processes; read their scope before relying on them.

## Report an incident

Use your agreed Enterprise support channel for a service incident. Report a suspected vulnerability through [GitHub’s private security reporting](https://github.com/tale-project/tale/security) or `security@tale.dev`. Include the affected version and reproduction details without sending credentials or personal data in a public issue.

For a review of where data travels, continue with [Cloud data residency](/cloud/data-residency).
