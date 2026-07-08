# Conversations (email inbox automations) — Manual Test Plan

> **Purpose**: Exercise the conversation inbox as it ships today — the
> standalone `/conversations` pages and their legacy-redirect stubs are gone
> entirely (removed, not just redirecting); conversations render exclusively
> through three installable, org-scoped email automations (**Reply to Outlook
> emails** / `reply-outlook-emails`, **Reply to Gmail emails** / `reply-gmail-emails`,
> **Reply to emails via SMTP/IMAP** / `reply-imap-emails`).
> Covered: install + readiness, the four status tabs (Open / Closed / Spam /
> Archived), opening a conversation into the thread pane, reply + improve,
> single + bulk status transitions, and uninstall-keeps-data. Conversations
> are created by inbound email ingestion, which the **mock stack cannot
> drive**; see Prerequisites for the seeding pattern.

## Scope & routes

| Surface                    | Route                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Installed email automation | `/dashboard/{org}/automations/{reply-outlook-emails\|reply-gmail-emails\|reply-imap-emails}` |
| Automations (install)      | `/dashboard/{org}/automations`                                                               |
| Selection (in-page)        | selecting a conversation is **local view state** — the URL never changes                     |

The inbox UI itself is a PLATFORM builtin view: each email manifest declares
`builtinViews: [{ id: 'inbox' }]` and
`app/features/automations/builtin-views/inbox-view.tsx` renders it through the
connected blocks under `app/features/automations/registry/connected/`
(ConversationList / ConversationThread / MessageComposer) — the bundles ship
no view JSON.

> **i18n note**: in-app copy (the Inbox title, tab labels, empty states,
> placeholders, action verbs) lives in **platform i18n** under
> `automations.inbox.*` (`services/platform/messages/<locale>.json`) — the
> bundles' own catalogs keep only the `<ns>.title` / `<ns>.description` pair;
> the platform `conversations` namespace was deleted. Platform chrome
> (Install, Finish setup, Send, Improve) stays under platform `automations.*`
> / `common.*` keys.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). The SETUP.md bring-up
leaves `TALE_CONFIG_BUILTIN_DIR` unset, so the real product catalog at
`builtin-configs/automations/` renders in the hub — all three email automations are
installable. Installing needs the developer-settings capability (Owner /
Admin / Developer); an Editor or Member sees the inbox but no install
controls.

There is **no UI path and no public mutation** to create a conversation in the
mock stack (creation happens via inbound email/integration ingestion, which
the mock gateway does not deliver). To exercise the populated cases, seed rows
directly into **your own bootstrapped org** via the internal mutation (the
local self-hosted backend lets `convex run` call internal functions with the
admin key from `.convex/local/default/config.json`):

```bash
cd services/platform
bunx convex run conversations/internal_mutations:createConversationWithMessage \
  '{"organizationId":"<ORG>","subject":"QA conv","status":"open","priority":"high","channel":"email","direction":"inbound","type":"service-request","integrationName":"outlook","initialMessage":{"sender":"qa@example.com","content":"hello","isCustomer":true,"status":"delivered"}}'
```

Seed 3+ rows (vary `subject`) so bulk-select has material. **`integrationName`
decides which automation shows the row**: `outlook` → Reply to Outlook emails,
`gmail` → Reply to Gmail emails, `imap_smtp` → Reply to emails via SMTP/IMAP; a
row with a different (or missing)
`integrationName` appears in **no** automation (B2). A row's list title is its
`subject` — the full-row button's `aria-label` is the subject, falling back to
the sender (the old "Unknown Customer" naming is gone). Rows also render a
sender heading and a message preview: the heading is the customer's name when
the conversation has one (`senderName`, falling back to the subject), and the
latest message's content shows as a one-line snippet (`lastMessagePreview`,
capped server-side, HTML stripped client-side). The CLI seed above creates no
customer doc, so seeded rows lead with the subject.

> **Agent note**: status-transition and bulk mutations are RLS-wrapped and
> each writes an audit row via the internal `createAuditLog` — the
> audit-genesis denial that blocked every transition on the pre-automations
> build is now RESOLVED (see **Issues Found** #1).
> Verify a transition by **reload + read-back of the persisted status** (the
> row left its source tab and appears in the target tab after reload), never
> by the toast.

## Automated coverage

| Case(s)                                 | Status         | e2e spec                                                                           |
| --------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| F1 (install → tabs render)              | ✅ automated   | `email-automation.spec.ts` (hub card → wizard → 4 tabs, Open selected)             |
| F2 (readiness checklist)                | 🔶 partial     | `email-automation.spec.ts` (asserts the **Finish setup** alert; Connect is manual) |
| F3 (tabs + empty states)                | 🔶 partial     | `email-automation.spec.ts` (Spam empty state + thread placeholder; rest manual)    |
| F4 (open conversation)                  | ✅ automated   | `email-automation.spec.ts` (seeded row → thread pane + composer)                   |
| F10 (uninstall)                         | 🔶 partial     | `email-automation.spec.ts` (uninstall flow; data-survival read-back is manual)     |
| F5–F8, B1–B3 (reply/improve/verbs/bulk) | ⛔ manual-only | — (transitions need the seeded org)                                                |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                        | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                                                                  | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Install an email automation | `/dashboard/{org}/automations` → **Install** (`automations.install.install`) on the **Reply to Outlook emails** card → wizard **Set up Reply to Outlook emails** (`automations.installWizard.title`): **Next** on the Install step, **I'll do this later** (`automations.installWizard.skipForNow`) on the Outlook connect step, **Finish** (`automations.installWizard.finish`)                                                         | Automation installs (persists on reload). `/dashboard/{org}/automations/reply-outlook-emails` renders the **Inbox** page (`automations.inbox.title`) with a real tablist — **Open** / **Closed** / **Spam** / **Archived** (`automations.inbox.tab.*`), **Open** selected — in a split layout (list left, thread right)                                                                                                                                                                                                                                                                                                                                                                |
| F2  | Readiness checklist         | After F1 (integration skipped), open the automation page                                                                                                                                                                                                                                                                                                                                                                                 | Warning Alert **Finish setup** (`automations.readiness.title`) with **Connect** (`automations.readiness.connectButton`) for Outlook; connecting through it clears the alert (reload + read-back)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3  | Status tabs + empty states  | Click each of the four tabs on an unseeded org                                                                                                                                                                                                                                                                                                                                                                                           | Each tab shows its own empty copy: **No open conversations** / **No closed conversations** / **No spam** / **No archived conversations** (`automations.inbox.empty.*`); the thread pane shows **Select a conversation to view details** (`automations.inbox.thread.placeholder`)                                                                                                                                                                                                                                                                                                                                                                                                       |
| F4  | Open conversation           | In a seeded Open tab, click a row (`getByRole('button', { name: '<subject>' })`)                                                                                                                                                                                                                                                                                                                                                         | Thread pane replaces the placeholder with the message history; the row's unread dot clears — it is an `aria-hidden` dot paired with a visually-hidden (`sr-only`) **Unread** text (`common.aria.unread`), NOT a `role="status"` — assert the hidden text, not a status role; `markConversationAsRead` fires on open; the **URL does not change** (selection is view state)                                                                                                                                                                                                                                                                                                             |
| F5  | Reply                       | With a conversation selected on **Open**, type into the composer (`automations.inbox.composer.placeholder` = "Type a message") → **Send** (`automations.composer.send`); Cmd/Ctrl+Enter also sends                                                                                                                                                                                                                                       | **Precondition:** the reply needs the conversation to have a linked customer with a real email AND a non-empty `integrationName` — otherwise `replyToConversation` throws `customer_email_not_found` (or `conversation_integration_missing`). The CLI seed in Prerequisites sets `integrationName` but creates **no customer**, so extend it to link a customer with an email first. With those in place the reply lands in the thread (read-back after reload); recipient / `Re:` subject / integration are derived **server-side** from the conversation (`conversations/mutations:replyToConversation`) — there is nothing to address. The composer exists **only on the Open tab** |
| F6  | Improve with AI             | With a non-empty draft → **Improve** (`automations.composer.improve`)                                                                                                                                                                                                                                                                                                                                                                    | Draft is replaced by the improved text (`conversations/actions:improveMessage`; the mock stack returns the gateway's canned completion); **Undo** (`automations.composer.undo`) restores the original draft; failure shows **Couldn't improve the message.** (`automations.composer.improveFailed`)                                                                                                                                                                                                                                                                                                                                                                                    |
| F7  | Single status transitions   | Thread-pane action buttons per status: open → **Close conversation** / **Mark as spam**; closed & archived → **Reopen conversation**; spam → **Not spam** + **Delete** (`automations.inbox.action.*`)                                                                                                                                                                                                                                    | Row leaves the source tab and appears in the target **after reload** (read-back persisted status). **Delete** is the only destructive verb: spam-only, behind a confirm dialog, removes the conversation entirely. The audit-genesis blocker (Issues #1) is resolved — the transition persists on read-back                                                                                                                                                                                                                                                                                                                                                                            |
| F8  | Bulk transitions            | Check rows (checkbox aria **Select row**, `common.aria.selectRow`) → toolbar (role `toolbar`, label **{count} selected**, `common.labels.nSelected`) → per-tab actions: Open → **Close** / **Archive** / **Mark as spam**; Closed → **Reopen**; Spam → **Not spam**; Archived → **Unarchive** (`automations.inbox.bulk.*` — except Spam's **Not spam**, which reuses `automations.inbox.action.notSpam`; there is no `bulk.notSpam` key) | Selected rows leave the source tab and appear in the target **after reload**; the selection clears. **Clear all** (`common.actions.clearAll`) empties the selection without mutating anything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F10 | Uninstall keeps data        | Automation page or hub card ⋯ (**Manage Reply to Outlook emails**, `automations.install.menuLabel`) → **Uninstall** (`automations.install.uninstall`) → dialog **Uninstall automation** (`automations.install.uninstallTitle`) → confirm; then reinstall (F1)                                                                                                                                                                            | The dialog's warning names what goes (agents, workflows, pages, env/secrets) and what stays (integrations). `conversations*` tables are **never** touched by uninstall — after reinstall the same threads are back (read-back the seeded subjects)                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Boundary & error tests

| ID  | Test                       | Input                                                                                                     | Expected                                                                                                                                                                              |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Integration scoping        | Seed one row with `integrationName: "gmail"` while only Outlook is installed                              | The row appears in **no** installed automation; installing Gmail shows it there and **not** in Outlook (each tab queries `listConversationsPaginated` with its own `integrationName`) |
| B2  | Composer without selection | Open tab, nothing selected                                                                                | The composer area shows only the placeholder text ("Type a message") as muted copy — no textarea, no Send; selecting a row swaps in the editable composer                             |
| B3  | Attachment download        | Seed a message with an `attachments` array → open it → **Download** (`automations.inbox.action.download`) | The `downloadAttachments` mutation fires; on the mock stack verify no crash and no console error (real file delivery is env-gated)                                                    |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Status tabs    | A real ARIA `tablist`: each status is a `tab` with `aria-selected` tracking the active tab; keyboard-operable                                                                                                                                                                                                                                                                              |
| A2  | List rows      | Each row is a real full-width `<button>` whose accessible name is the subject (fallback: sender); the sender heading and latest-message preview render as row text, not as part of the accessible name; reachable and openable by keyboard; the unread indicator is an `aria-hidden` dot plus a visually-hidden (`sr-only`) **Unread** text (`common.aria.unread`) — not a `role="status"` |
| A3  | Bulk selection | Per-row checkboxes labelled **Select row** (`common.aria.selectRow`); the bulk bar is `role="toolbar"` labelled **{count} selected**                                                                                                                                                                                                                                                       |
| A4  | Composer       | The textarea carries the placeholder as its accessible name; Cmd/Ctrl+Enter sends; Send / Improve / Undo are real buttons with visible focus                                                                                                                                                                                                                                               |

## Performance

| ID  | Metric                                          | Target                                                            |
| --- | ----------------------------------------------- | ----------------------------------------------------------------- |
| P1  | Automation page first paint (mock stack, local) | Tabs + list panel (or empty state) within **2 s** of navigation   |
| P2  | Tab switch (warm)                               | The target tab's list + thread placeholder repaint within **1 s** |

## Issues Found

| #   | Test ID | Route / URL                                         | Severity | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Screenshot                                      |
| --- | ------- | --------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | F7, F8  | `/dashboard/{org}/automations/reply-outlook-emails` | resolved | **RESOLVED — status transitions persist.** The pre-automations audit-genesis denial (the `auditLogChainGenesis` insert being RLS-denied inside a user mutation) is off the write path: close/reopen/spam/read and every `bulk_*` route their audit through the raw internal `createAuditLog` (`audit_logs/emit.ts` → an `internalMutation` with raw ctx in `internal_mutations.ts`), and `conversations/status_transitions_rls.test.ts` (#1972) is a green regression driving the REAL RLS + audit chain. F7/F8 read-back = PASS. Caveat: the regression proves an _editor_; a plain _member_'s transition permission is governed by the separate `conversations` RLS rule. | `scratchpad/shots/conversations/probe-open.png` |

## Test summary

```
Area: Conversations (email inbox automations)
Functional: ___/9   Boundary: ___/3   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
