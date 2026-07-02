---
title: Audit-log integrity alerts
description: How to respond when the daily audit-log integrity check raises an alert — reading the finding, telling tampering from a benign configuration gap, and preserving evidence.
---

Tale verifies every organisation's audit-log hash chain on a schedule and raises an alert the moment a verification fails. This page is the runbook for the operator or admin who received that alert: how to read the finding, how to separate a genuine tamper signal from an ordinary retention or configuration artifact, and what to preserve before you touch anything. The alert is deliberately loud because a real break is rare and serious — but most breaks that fire in practice have an everyday explanation, so the work is to rule those out methodically rather than to panic.

## What triggers it

A daily cron walks every organisation's append-only audit chain along with its retention and scrub checkpoints. When a chain fails to verify, the run does two things. It writes an in-band `security` audit row — on every failing run, so the durable record is always complete — and it raises an out-of-band notification to the organisation's admins, in the notification bell and in your Slack channel when one is connected.

The out-of-band alert is deduplicated. You get one notification when a break is first detected, and one more only if it changes — a different broken row, or a different failing checkpoint — not a fresh alarm each day for the same break. A subsequent clean run clears the alert on its own; a later, different break raises a new one.

## Tampering or a configuration gap

The alert arrives in two shapes, and the title tells you which. **Audit log integrity check failed** is the critical one: the hash chain itself does not verify, or a signed checkpoint's signature does not match the configured key. Treat this as a possible tamper signal until you have explained it.

**Audit log signatures can't be verified** is a calm warning, not a breach: a checkpoint is signed, but the deployment has no `TALE_AUDIT_SIGNING_KEY` configured to check that signature against. Nothing was forged — Tale cannot prove the checkpoint is authentic until you restore the key. The in-product panel mirrors the split: a healthy chain shows a green **Verified** badge, an active incident shows a red **Integrity alert active** badge, and an organisation the cron has not reached yet shows **Not yet checked**.

## Open the integrity panel

An organisation's admins inspect the chain from **Settings > Governance > Audit logs**. The **Chain integrity** panel at the top of the page shows the status badge, the time of the last automated check, and a **Verify now** button that re-runs the same verification on demand. If you arrived from the notification, clicking the alert deep-links you straight to the flagged row in the audit table instead of the top of the log.

Run **Verify now** to see the structured finding. For a hash-chain break, the panel shows **Chain integrity broken** with the **Entry ID** of the first row that fails, when it **Occurred**, the **Expected hash**, and the **Stored hash** that did not match — plus an **Open this entry** button that reveals the row in the table. For a checkpoint problem, it shows **Checkpoint verification failed** with the **Checkpoint ID** and a **Reason**. Record these details before you change anything: they are the evidence.

## Rule out the benign causes

A hash break is a tamper signal only when nothing legitimate explains it, and the verifier already accounts for the three ordinary events that cause almost every alert — so confirming one of them is your first move.

**A retention cut.** When retention hard-deletes old rows, the surviving chain head points at a row that no longer exists. The verifier re-anchors across the cut using a signed retention checkpoint, so a clean cut verifies normally. If instead you see **Audit log signatures can't be verified**, the cut itself is fine — the deployment is missing the `TALE_AUDIT_SIGNING_KEY` that authenticates the checkpoint. That is a configuration gap, not tampering.

**A GDPR scrub.** Erasing a data subject blanks their fields in place, which would change those rows' hashes — so a scrub writes a signed scrub checkpoint covering the affected rows, and the verifier trusts them on that basis. A scrub should never surface as a break on a deployment that has a signing key.

**Legacy pre-chain rows.** Rows written before audit hash-chaining existed carry no integrity hash. The verifier skips them automatically; they are not a break.

A genuine tamper signal is a hash mismatch with none of these explanations: no retention cut at that point, no scrub covering the row, and the signing key present and correct.

## Respond to a real break

If the finding survives that triage — a hash mismatch you cannot account for — treat it as a security incident and preserve evidence first. Audit rows are append-only by design; do not delete or edit any row, including the flagged one, because that destroys the record an investigation depends on.

1. Record the finding verbatim — the **Entry ID**, **Occurred** time, **Expected hash**, and **Stored hash** (or the **Checkpoint ID** and **Reason**) shown in the panel. Copy or screenshot them rather than relying on the alert alone.
2. Confirm whether the signing key is configured on the host, so you can tell a real mismatch from an unverifiable checkpoint. This reports presence without printing the secret:
   ```bash
   grep -q '^TALE_AUDIT_SIGNING_KEY=' .env && echo configured || echo missing
   ```
3. Correlate the break's timestamp with recent activity — a retention sweep, a data-subject scrub, a deploy, a database restore, or direct database access. A break that lines up with a maintenance action usually has an ordinary cause you can now name.
4. If nothing explains it, escalate through your security incident policy and treat the database as potentially compromised until proven otherwise. Keep a backup snapshot from before and after the detected break for forensics.

## Clear the alert

The alert is incident-based, not a recurring event. Once the break is resolved or explained — the key restored, the retention artifact understood, a tampered database rebuilt from a clean backup — the next daily run verifies cleanly and clears the alert on its own, and the **Chain integrity** badge returns to **Verified**. There is no acknowledge or dismiss step to remember. If a different break appears later, the check raises a fresh alert for that one, so muting is never necessary.

## Where this fits

An integrity alert is a prompt to investigate, not a verdict — the daily check runs loud so a rare real break cannot hide among the logs, and this runbook is how you separate that rare case from the retention and scrub artifacts behind most alerts. The mechanism the verifier checks — the SHA-256 hash chain and the HMAC-signed checkpoints — is documented in [Cryptography](/self-hosted/operate/security/cryptography), and the retention cuts that legitimately re-anchor it are in [Retention](/self-hosted/configuration/retention). The panel, columns, and export you use to read a flagged row live on the [Audit logs](/platform/admin/governance/audit-logs) reference; the [Hardening](/self-hosted/operate/security/hardening) checklist is where this monitoring gets switched on in the first place.
