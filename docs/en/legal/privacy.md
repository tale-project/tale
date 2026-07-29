---
title: Privacy policy
description: What Tale collects, why, how long it is kept, who else processes it, and the rights you have over your data.
noindex: true
---

This policy describes how Tale handles personal data when you use Tale Cloud, the docs site, the marketing site, or the in-product features. The shape is the same whether you are an end user, an org admin, or a visitor reading the docs — different surfaces collect different data, and each is named below. The policy applies to Tale Cloud; self-hosted instances are operated by the organisation that runs them and the controller is that organisation, not Tale.

Read this when you want to know what Tale stores about you, why, and how to remove it. Come back when policy changes — material changes are announced on the status page and emailed to org Owners.

## What we collect

Three buckets of data exist, each with its own retention rule:

- **Account data.** Name, email, organisation, role, and the credentials you use to sign in. Required to operate the service.
- **Product data.** Everything you put into the product — agents, workflows, documents, conversations, knowledge base entries, connector credentials. Stored as long as the parent org exists; deleted on org deletion or via the data-subject request flow.
- **Operational data.** Server logs, audit trails, support ticket contents, performance metrics. Tied to your account or org for as long as the data is useful for security, debugging, and compliance — typically up to 90 days for logs and indefinitely for audit trails.

We do not sell personal data. We do not use product data to train models — your conversations and documents are not part of any model training set, neither ours nor any provider's, except where you have explicitly enabled a feature that requires it and acknowledged the consent prompt.

## Why we collect it

The legal basis for each bucket is one of:

- **Contractual necessity.** Account data and the product data you create exist because you asked us to provide the service. We cannot run the platform without them.
- **Legitimate interest.** Operational data is collected to keep the platform secure, debug failures, and meet contractual SLAs.
- **Consent.** Marketing communications, analytics on the marketing site, and any feature that processes data beyond the contract are consent-based — opt-in, revocable, and recorded.

The lawful-basis breakdown per data category lives in the Data Processing Agreement available to enterprise customers on request.

## How long we keep it

| Data                  | Retention                                                                |
| --------------------- | ------------------------------------------------------------------------ |
| Account data          | Lifetime of the org plus 30 days after deletion                          |
| Product data          | Lifetime of the org; immediate erasure on org deletion                   |
| Documents and uploads | Lifetime of the parent record; soft-deleted records purged after 30 days |
| Server logs           | 90 days                                                                  |
| Audit logs            | Org-configurable floor; default 365 days, no upper bound                 |
| Backups               | 30 days, encrypted at rest                                               |

Erasure follows the documented data-subject request workflow inside the product — see the in-product governance page for the operator surface.

## Subprocessors

Tale Cloud uses a small number of third parties to deliver the service. Each is named, located, and scoped on the [Subprocessors](/legal/subprocessors) page. Material changes to the subprocessor list are announced 30 days before they take effect; org Owners can object via support and have the contract terminated if the new subprocessor is not acceptable.

## Your rights

You have the rights granted by GDPR (and the equivalent FADP rights for Swiss data subjects): access, rectification, erasure, restriction, portability, and objection. The mechanics:

- **Access and portability.** Export your data from inside the product or via the API; raw exports of org-scoped data are available on request.
- **Rectification.** Edit account data and product data inside the product. For data you cannot reach (server logs, audit entries with your user ID), submit a request through support.
- **Erasure.** Use the data-subject request workflow under **Settings > Governance > Data subject requests**. Erasure crosses every service that holds the data, including backups via key destruction.
- **Restriction and objection.** Submit through support; Tale acknowledges within five business days.

Contact: `privacy@tale.dev`. For complaints, the supervisory authority is the data-protection authority of the country in which you reside.

## Where this fits

Privacy is the data-handling contract; [Trust and compliance](/cloud/trust-and-compliance) is the operational evidence behind it. If you want to know which third parties touch your data, [Subprocessors](/legal/subprocessors) is the list; if you operate self-hosted, the data never leaves your infrastructure and this policy applies only to your use of Tale's own surfaces (the docs and marketing sites).
