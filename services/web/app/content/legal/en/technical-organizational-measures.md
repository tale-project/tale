---
title: Technical and organizational measures
description: The technical and organizational measures Ruler GmbH applies to protect Personal Data processed on behalf of customers using the Tale platform.
noindex: true
---

**Last updated:** 01.05.2026

This document describes the technical and organizational measures ("TOMs") that Ruler GmbH ("Tale") implements to protect Personal Data processed on behalf of its customers, as referenced in Section 7 of the [Data Processing Agreement](/legal/data-processing-agreement). It applies to Tale Cloud. Self-hosted deployments are operated by the Customer; for those, the Customer determines and applies its own measures, while Tale provides hardened defaults and documented controls.

Tale reviews these measures at least annually and may update them, provided the overall level of protection afforded to Personal Data does not materially decrease.

## 1. Confidentiality

### 1.1 Access control — physical

Tale does not operate its own data centers. Physical infrastructure is provided by sub-processors listed in Appendix A of the [Data Processing Agreement](/legal/data-processing-agreement). Each provider is certified to ISO/IEC 27001 (or equivalent) and operates access controls including 24/7 staffing, video surveillance, badge or biometric entry, mantraps, and visitor logging. Evidence is available on request via the sub-processor trust pages.

### 1.2 Access control — systems

a) Multi-factor authentication is mandatory for every Tale employee with production access.

b) Access to production systems is granted on a least-privilege, need-to-know basis and reviewed at least quarterly.

c) Personnel access is provisioned through a central identity provider and revoked within one business day of role change or departure.

d) Privileged operations require an approved change ticket and are logged with the actor, action, and timestamp.

e) Customer access to the platform is authenticated by email and password (with optional WebAuthn or TOTP second factor) or by SSO (OIDC) where the Customer has configured it.

### 1.3 Access control — data

a) Personal Data is tenant-isolated at the application layer; every database query is scoped to the requesting organisation.

b) Production data is never copied to non-production environments. Synthetic or anonymized data is used for development and testing.

c) Customer-issued API keys are hashed at rest and revocable from the admin surface.

### 1.4 Separation control

a) Each customer organisation is a separate logical tenant; tenant identifiers are present on every row in the database and enforced at the query layer.

b) Backups are encrypted per tenant key; restoration into another tenant is prevented at the key-management layer.

c) Workloads run in isolated containers; network policies prevent cross-tenant traffic.

### 1.5 Pseudonymization and encryption

a) Personal Data is encrypted in transit using TLS 1.2 or higher, with HSTS enforced on every public endpoint.

b) Personal Data is encrypted at rest using AES-256 (or equivalent) at the storage layer.

c) Encryption keys are managed by the cloud sub-processor's key management service; key rotation occurs at least annually.

d) Where pseudonymization is feasible without breaking functionality, Tale prefers pseudonymous identifiers over plaintext personal identifiers in logs and analytics.

## 2. Integrity

### 2.1 Transfer control

a) All ingress and egress traffic crossing public networks is encrypted in transit.

b) Internal service-to-service traffic uses authenticated mTLS or signed tokens.

c) AI sub-processor calls are routed to a region matching the Customer's data-residency selection (Switzerland or EU); routing is enforced server-side.

### 2.2 Input control

a) Every administrative action in the platform is recorded in an immutable audit log, including the actor, the affected resource, and the timestamp.

b) Audit logs are retained for the period configured by the Customer (default 365 days, no upper bound) and are not modified by snapshot restores.

c) System logs from infrastructure components are retained for 90 days and are accessible only to authorized Tale personnel.

## 3. Availability and resilience

### 3.1 Availability control

a) Application services run in redundant configurations behind load balancers, with automatic failover between availability zones within the chosen region.

b) Monitoring covers system uptime, error rates, latency, and queue depth; on-call engineers are paged on threshold breaches.

c) Tale's status page publishes incident notifications and historical uptime data.

### 3.2 Recoverability

a) Tale snapshots application databases daily and object storage hourly. Snapshots are encrypted at rest with keys held by Tale's cloud sub-processor.

b) A disaster-recovery replica is maintained within the customer's selected region (Geneva for Switzerland, Dublin for the European Union).

c) Restores from snapshot are initiated by the Customer via support and meet the recovery time objective stated in the Service Agreement.

d) Backup integrity is verified at least quarterly by restoring a representative snapshot to an isolated environment.

### 3.3 Capacity and performance

a) Production environments are sized for expected peak load and scaled horizontally as utilization grows.

b) Rate limits and back-pressure mechanisms prevent any single tenant from degrading service for others.

## 4. Procedures for regular testing, assessment, and evaluation

### 4.1 Vulnerability management

a) Tale runs automated dependency scanning on every commit and tracks vulnerability disclosures for all production dependencies.

b) Security patches are applied within the timeframes mandated by Tale's vulnerability management policy: critical within 7 days, high within 30 days, medium within 90 days.

c) Container images are rebuilt at least monthly to pick up upstream security updates.

### 4.2 Penetration testing

a) Tale commissions an external penetration test at least annually. Findings are remediated according to severity, and an attestation letter is available to customers under NDA via support.

### 4.3 Audits and certifications

a) Tale maintains ISO/IEC 27001 and SOC 2 Type II certifications (or equivalent standards) for Tale Cloud.

b) Customers may request copies of the current SOC 2 Type II report and ISO 27001 certificate by contacting support; both are provided under NDA.

### 4.4 Internal review

a) The security team reviews access logs, configuration drift, and incident patterns on a rolling weekly basis.

b) The privacy team reviews data-subject request handling and retention behaviour at least quarterly.

c) Material findings from any review feed back into a tracked remediation backlog with owners and deadlines.

## 5. Incident response

### 5.1 Incident detection

a) Production systems emit telemetry to a centralized logging and monitoring platform.

b) Automated alerts page the on-call engineer on anomalies including elevated error rates, unauthorized access attempts, and unusual data egress patterns.

### 5.2 Incident response procedure

a) Tale maintains a documented incident response procedure covering detection, containment, eradication, recovery, and post-incident review.

b) The procedure is tested at least annually through a tabletop exercise or live drill.

c) Severity classifications and escalation paths are defined in advance; the on-call engineer is empowered to escalate to leadership without delay.

### 5.3 Customer notification

a) Tale notifies affected Customers without undue delay and in any event within 72 hours of becoming aware of a Data Breach affecting their Personal Data, as set out in Section 8 of the [Data Processing Agreement](/legal/data-processing-agreement).

b) Notifications include the information required by Applicable Data Protection Law: nature of the breach, categories and approximate numbers affected, likely consequences, and remediation steps.

## 6. Personnel

### 6.1 Confidentiality

a) Every Tale employee, contractor, and consultant signs a written confidentiality agreement covering Personal Data, source code, and customer information. The obligation survives termination of the engagement.

### 6.2 Background checks

a) Background checks are performed on Tale employees with production access, to the extent permitted by local law.

### 6.3 Training

a) New hires complete security and privacy training within their first 30 days.

b) All personnel complete refresher training at least annually, including topics such as phishing awareness, secure development, and data handling.

### 6.4 Offboarding

a) Access is revoked within one business day of departure or role change.

b) Equipment is wiped and recovered; physical credentials are returned and deactivated.

## 7. Sub-processor management

### 7.1 Selection

a) Sub-processors are selected after a security and privacy review covering their certifications, data protection commitments, and processing locations.

### 7.2 Contractual obligations

a) Each sub-processor is contractually bound — by written agreement — to data protection obligations no less protective than those set out in the [Data Processing Agreement](/legal/data-processing-agreement), including the no-training commitment in Section 5.

### 7.3 Ongoing review

a) Sub-processor certifications and audit reports are reviewed at least annually.

b) Material changes to a sub-processor's posture trigger notification to Customers under the 30-day mechanism in Section 6.2 of the DPA.

## 8. Data minimization, retention, and deletion

### 8.1 Data minimization

a) The platform collects only the Personal Data required to deliver the requested functionality.

b) Customers control what data they submit; Tale does not enrich Customer-submitted data with third-party sources without an explicit opt-in.

### 8.2 Retention

a) Retention periods for each data category are documented in Tale's [Privacy policy](https://tale.dev/legal/privacy-policy) and in the in-product retention configuration.

b) Audit-log retention floors are configured by the Customer; the platform default is 365 days with no upper bound.

### 8.3 Deletion

a) On termination of the Agreement, Personal Data is returned or deleted according to Section 13 of the [Data Processing Agreement](/legal/data-processing-agreement).

b) Deletion crosses every store that holds the data, including object storage and backups (the latter via key destruction within the backup retention window).

c) Customers may initiate erasure for individual Data Subjects through the in-product data-subject request workflow.

## 9. Governance

### 9.1 Policies

a) Tale maintains written information security and data protection policies, reviewed at least annually.

b) Policy changes are communicated to all personnel; material changes are accompanied by mandatory training.

### 9.2 Roles and responsibilities

a) Tale designates a person responsible for information security and a person responsible for data protection. Both report into senior leadership.

b) Their contact addresses are `security@tale.dev` and `privacy@tale.dev` respectively.

### 9.3 Risk management

a) Tale maintains a risk register covering technical, organizational, and legal risks.

b) Risks are reviewed at least quarterly and after any material incident, with mitigations tracked through completion.

## 10. Contact

For any questions regarding these TOMs or to request audit evidence, contact us via our [contact form](https://tale.dev/contact).

**Ruler GmbH**
Seestrasse 4
3700 Spiez
Switzerland
