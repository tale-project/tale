---
title: Investigate audit-log integrity
description: Check the audit chain, understand the verification limits, and preserve evidence when a check fails.
---

Use this runbook when **Chain integrity** reports a break or you receive an audit integrity notification. You need an Admin or Owner account to follow the settings workflow, and access to your deployment operator for database investigation.

## Check the reported range

1. Open **Settings > Governance > Logs** and find **Chain integrity**.
2. Record the status and last automated check. **Not yet checked** means there is no scheduled-check result; it is not a successful verification.
3. Select **Verify now**. A successful result reports how many entries were checked. This on-demand check covers at most 1,000 entries from the beginning of the retained chain.
4. If the result is truncated, ask the operator to verify the remaining range. Clicking again starts the same range; it does not advance a cursor. A clean first page does not establish that the entire history is intact.

The on-demand result and scheduled-check status are separate. Clicking **Verify now** does not update the timestamp of the last automated check.

## Understand what is checked

The current PostgreSQL backend checks the SHA-256 hash of each retained, unscrubbed audit entry and the links between entries. The first surviving row supplies the starting hash link. This detects many changes within the retained chain, but it is not an independently signed record of everything that ever existed.

Retention can remove a prefix of the chain. The scheduled check can resume from its recorded progress; if retention legitimately removed its old anchor, it starts from the first surviving link. A missing anchor inside the retention window is not excused in this way.

For rows scrubbed during personal-data erasure, the verifier checks linkage without recomputing the erased content. It also counts scrubbed rows without a matching erasure request. Investigate such a warning against the erasure records; the current backend does not verify HMAC-signed checkpoints or use an audit signing key to repair these findings.

<Warning title="Keep an independent record">
Hash chaining does not prevent database edits or prove that every action was recorded. Protect database access and retain independent evidence appropriate to your investigation. A complete rewrite of the stored chain is outside what this check alone can establish.
</Warning>

## Preserve a failure

A hash or linkage mismatch shows **Chain integrity broken**, the **Entry ID**, occurrence time, **Expected hash** and **Stored hash**. Use **Open this entry** to inspect the event.

1. Save the finding and the affected organization, entry ID, time and deployed version. Preserve the values exactly.
2. Keep database snapshots and relevant deployment, access and backup logs before making repairs. Restrict access to copies containing personal data.
3. Compare the timing with retention, erasure, restore and maintenance operations. An operation occurring at the same time is a lead to investigate, not proof that the mismatch is harmless.
4. Follow your incident procedure if the mismatch remains unexplained. Do not edit or delete the flagged row to make verification pass.

The [audit-log guide](/platform/admin/governance/audit-logs) explains event fields and exports. Its filtered, capped export is not a full backup or necessarily a complete chain.

## Follow the scheduled result

A daily job checks organizations with audit entries incrementally. A detected hash break records an active integrity incident and sends a security notification to organization admins. Repeated checks deduplicate the same finding; a changed finding can produce another notification.

After repair or recovery, confirm the affected range verifies successfully. A subsequent successful scheduled check clears the active incident. Explaining a failure to a colleague or dismissing a notification does not repair the chain.

For deployment controls, see [Hardening](/self-hosted/operate/security/hardening). For the limits that remove old evidence, see [Retention](/self-hosted/configuration/retention).
