# Governance — Manual Test Plan

> **Purpose**: Exercise the governance controls — content models / model
> defaults, guardrails (content safety), policies & limits, run-code policy,
> feedback, legal hold, data-subject requests (DSAR), security monitoring,
> usage, logs, and trash. Most are admin/owner-gated, save-and-restore toggles.

## Scope & routes

| Surface             | Route (`/dashboard/{org}/settings/governance/…`)                         |
| ------------------- | ------------------------------------------------------------------------ |
| Index →             | redirects to `content-models`                                            |
| Content models      | `content-models` (group: `governance.groups.contentAndModels`)           |
| Guardrails          | `guardrails`                                                             |
| Policies & limits   | `policies-limits`                                                        |
| Run-code policy     | `run-code-policy`                                                        |
| Feedback            | `feedback`                                                               |
| Legal hold          | `legal-hold`                                                             |
| DSAR                | `data-subject-requests` · `…/{requestId}`                                |
| Security monitoring | `security-monitoring` (group: `governance.groups.securityAndMonitoring`) |
| Usage               | `usage`                                                                  |
| Logs                | `logs`                                                                   |
| Trash               | `trash`                                                                  |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md) as owner/admin. **Restore every
toggle you flip** — these are org-wide settings.

> **Agent note**: save → reload → assert the persisted control state, never the
> toast. Some governance effects (e.g. retention cleanup) need an admin Save to
> seed bounds before they run — a file value alone won't trigger them.

## Automated coverage

| Case(s)              | Status         | e2e spec                                                                     |
| -------------------- | -------------- | ---------------------------------------------------------------------------- |
| F2, F3, F5           | ✅ automated   | `governance.spec.ts` (voice/system-prompt, content-safety, run-code toggles) |
| F7, F8               | 🔶 partial     | `governance.spec.ts` (dialogs open; full lifecycle manual)                   |
| F11                  | ✅ automated   | `governance.spec.ts` (logs tabs)                                             |
| F1                   | ✅ automated   | `navigation.spec.ts` (governance redirect)                                   |
| F4, F6, F9, F10, F12 | ⛔ manual-only | —                                                                            |

## Functional tests

| ID  | Test                | Steps (route + control)                                                                                                                                                                         | Expected                                                                                                             |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F1  | Index redirect      | Open `…/governance`                                                                                                                                                                             | Redirects to `…/content-models`                                                                                      |
| F2  | Content models      | Toggle voice output (`governance.voiceOutput.enabledLabel`); set system-prompt prefix (`governance.systemPrompt.prefixLabel`); set **Default Models** (`governance.defaultModels.title`) → save | `…voiceOutput.saved` / `…systemPrompt.saved`; default model reflected in new chats; persists on reload               |
| F3  | Guardrails          | Enable content safety (`governance.contentSafety.enableLabel`) → save; then in chat send a prompt with clearly disallowed content                                                               | `governance.contentSafety.saved`; the disallowed prompt is blocked/filtered with a safety message (not a raw answer) |
| F4  | Policies & limits   | Set rate limit / token / cost caps → save                                                                                                                                                       | Persists; hitting a cap surfaces the documented error                                                                |
| F5  | Run-code policy     | Choose denylist (`governance.runCodePolicy.modeDenylistLabel`) or allowlist (`…modeAllowlistLabel`) → **Save** (`…save`)                                                                        | `governance.runCodePolicy.saved`; persists                                                                           |
| F6  | Feedback            | Configure feedback collection → save                                                                                                                                                            | Persists                                                                                                             |
| F7  | Legal hold          | `legal-hold` → **Place hold** (`governance.legalHold.actions.placeHold`); view active holds (`…sections.activeHolds.title`); request + approve release                                          | Hold appears; release flow gated by approval                                                                         |
| F8  | DSAR                | `data-subject-requests` → **File request** (`governance.dataSubjectRequests.actions.fileRequest`) → `…dialogs.fileRequest.title`; open a request (`…/{requestId}`); fulfill / deny / extend     | Request created; status transitions; audit trail recorded                                                            |
| F9  | Security monitoring | Configure alert/anomaly rules → save                                                                                                                                                            | Persists; the monitoring view lists configured rules                                                                 |
| F10 | Usage               | `usage`                                                                                                                                                                                         | Org-wide consumption + cost render                                                                                   |
| F11 | Logs                | `logs` → switch **Audit** (`settings.logs.auditLogs`) ↔ **Activity** (`settings.logs.activityLogs`)                                                                                             | Both tabs render; audit table has a caption (`settings.logs.audit.tableCaption`)                                     |
| F12 | Trash               | `trash` → restore an item; permanently delete another; check the **Memory audit** tab (`governance.trash.tab.memoryAudit`)                                                                      | Restore returns it; permanent delete removes it for good (confirmed)                                                 |

## Boundary & error tests

| ID  | Test                 | Input                                     | Expected                                                     |
| --- | -------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| B1  | Bad limit            | Negative / non-numeric cap                | Validation; save blocked                                     |
| B2  | DSAR required fields | File a request with empty required fields | Validation; submit blocked                                   |
| B3  | Trash safety         | Permanent delete                          | Requires explicit confirmation before removal                |
| B4  | Restore toggles      | After F2–F5, reload                       | Toggles are back to their original state (you restored them) |

## Accessibility (WCAG 2.1 AA)

| ID  | Check      | Expected                                                                            |
| --- | ---------- | ----------------------------------------------------------------------------------- |
| A1  | Toggles    | Each switch labelled; on/off state announced                                        |
| A2  | Tables     | Logs/usage tables have caption + `scope="col"`                                      |
| A3  | Dialogs    | DSAR / legal-hold dialogs trap focus; **Close** (`common.aria.close`) returns focus |
| A4  | Radiogroup | Run-code mode is arrow-key navigable                                                |

## Performance

| ID  | Metric     | Target                         |
| --- | ---------- | ------------------------------ |
| P1  | Tab switch | < 1 s between governance pages |
| P2  | Logs load  | First page of logs < 2 s       |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Governance
Functional: ___/12   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
