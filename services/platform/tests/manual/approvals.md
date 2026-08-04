# Approvals — Manual Test Plan

> **Purpose**: Exercise the cross-cutting human-in-the-loop surface — every
> place a run or agent parks for a human decision and what that decision does
> downstream. After the AI-backend rewrite the **live** surfaces are: the
> automation-run **approval card** (a connector write parked behind the
> approval gate) and **ask card** (`ask_human` from an agent node) — each
> mounted on the run-detail page _and_ the task sheet — plus the **task
> review** gate ([tasks.md](tasks.md) F15) and the governance **DSAR
> dual-approval** ([governance.md](governance.md) F8). The chat rows
> (approval / human-input badges) are [chat.md](chat.md) F18/F35's cases —
> cross-referenced here, not duplicated.
>
> Seven legacy approval namespaces (`approvalCommon.*`, `planApproval.*`,
> `documentWriteApproval.*`, `knowledgeWriteApproval.*`,
> `connectorApproval.*`, `humanInputRequest.*`, `locationRequest.*`) exist in
> `en.yml` but **nothing in `app/` consumes them** — they are deliberately
> retained for rebuilt surfaces (`lib/i18n/keys-dynamic.yml`), so this guide
> carries no cases for document-write, knowledge-write, plan, location, or
> form-based human-input approvals.

## Scope & routes

| Surface                      | Route                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Automation run detail        | `/dashboard/{org}/automations/{automationSlug}/runs/{runId}`                      |
| Project-scoped run detail    | `/dashboard/{org}/projects/{projectId}/automations/{automationSlug}/runs/{runId}` |
| Task sheet (cards + review)  | `/dashboard/{org}/projects/{projectId}/tasks/board` + `?task={taskId}`            |
| Chat thread (read-only rows) | `/dashboard/{org}/chat/{threadId}`                                                |
| DSAR dual-approval           | `/dashboard/{org}/settings/governance/data-subject-requests`                      |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Most rows here are
**env-gated** (mode B and beyond) because the producers are real side-effects:

- **Approval card** (F1–F4): there is **no approval node type** — the gate
  fires when a **write-effect connector action** runs in a **live** run of a
  **deployed** automation with a connected connector (extend automations.md's
  probe with a write-action connector node, deploy, **Run live**). Mock test
  runs perform no IO and never park.
- **Ask card** (F5–F7): `ask_human` is a sandbox-bridge tool — it needs an
  **agent** node, a live sandbox, and a real model provider.
- **Task review** (F8–F9): produced only by a settling task-agent run
  ([tasks.md](tasks.md) F14); there is no manual "request review" control.
- **DSAR dual-approval** (F10): needs `requireDualApproval` in the org's
  `dsar_governance` config and a second admin account.

Mark any row you cannot produce **ENVIRONMENT** with the missing
precondition, per the guides' convention. Mode A drives only F11 (the
`e2e:humaninput` chat probe) and the rendering/regression checks.

> **Agent note**: a decision is the event — approving/rejecting pokes the
> parked run immediately; watch the run's status badge leave **Waiting**
> without reloading (Convex-reactive, never poll by reload). A **terminal**
> run renders no cards at all — only the outcome alerts; if you see neither a
> card nor an alert, check the run status first. Approval state is
> four-valued (`pending` → `executing` → `completed`, or `rejected`); the
> card shows buttons only in `pending`.

## Automated coverage

No e2e spec drives any approval flow (the pre-rewrite automation/chat specs
were retired in #2857). Component and backend tests cover slices:

| Case(s)          | Status         | e2e spec                                                                                                              |
| ---------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| F5–F6 (ask card) | 🔶 component   | — (no e2e; `run-ask-card.test.tsx`: mirror-first submit, blank-answer disable)                                        |
| F1–F3, B1        | 🔶 backend     | — (no e2e; `convex/approvals/gate.test.ts`, `policy.test.ts`, `error_codes.test.ts`; no approval-card component test) |
| F6–F7 (resume)   | 🔶 backend     | — (no e2e; `convex/automations/human_asks.test.ts`)                                                                   |
| F8–F9            | 🔶 backend     | — (no e2e; `convex/tasks/review_mutations.test.ts`, `pending_reviews.test.ts`)                                        |
| F4, F10–F12      | ⛔ manual-only | —                                                                                                                     |
| B2–B3, A1–A3, P1 | ⛔ manual-only | —                                                                                                                     |

Legend: ✅ fully automated · 🔶 partially automated / component or backend
test only · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                            | Steps (route + control)                                                                                                                                     | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Approval card renders           | Park a live run on a connector write (Prerequisites) → open the run at `…/automations/{automationSlug}/runs/{runId}`                                        | The run status is **Waiting**; the card titles **Waiting for your approval: {operation}** (`automations.runs.approval.title`, the operation being the connector name dot action); the subtitle names the requesting node (`automations.runs.approval.node`) or the generic line (`automations.runs.approval.pending`); the exact call parameters render as JSON under **The step would call with** (`automations.runs.approval.input`) |
| F2  | Approve → write executes        | On F1's card click **Approve** (`automations.runs.approval.approve`)                                                                                        | The card is replaced by the info alert (`automations.runs.approval.approved`); the run leaves **Waiting** without a reload (the decision pokes it), the step performs the write (verify at the connector's target), and the run reaches a terminal status; reopening the run page shows the alert, never the buttons                                                                                                                   |
| F3  | Reject → step fails             | Park a second run the same way → **Reject** (`automations.runs.approval.reject`)                                                                            | The destructive alert (`automations.runs.approval.rejected`) replaces the card; the step fails and the run stops (**Failed**, `automations.runs.status.*`); the write did **not** happen at the connector's target                                                                                                                                                                                                                     |
| F4  | Approval card on the task sheet | Bind the parked automation to a task ([automations.md](automations.md) F32) → open the task (`?task=` deep link)                                            | The **same** approval card renders inside the task sheet's run panel; deciding there behaves exactly like F2/F3 — one approval, two mounts (run page and task sheet stay consistent without reload)                                                                                                                                                                                                                                    |
| F5  | Ask card renders                | Run an automation whose agent node calls `ask_human` (Prerequisites) → open the parked run                                                                  | Status **Waiting**; the card titles **The agent needs your answer to continue** (`automations.runs.ask.title`) and shows the agent's question verbatim; the answer box carries its label/placeholder (`automations.runs.ask.answerLabel` / `…ask.placeholder`); **Send answer & resume** (`automations.runs.ask.submit`) is disabled while the box is blank                                                                            |
| F6  | Answer → same session resumes   | Type an answer → **Send answer & resume**                                                                                                                   | The run leaves **Waiting** without reload and the agent's next output demonstrably uses your answer (same conversation resumed, not a fresh run); the card is gone on the now-running/terminal run                                                                                                                                                                                                                                     |
| F7  | Ask mirrors to the task         | With the automation bound to a task: answer the ask from the task sheet                                                                                     | The sheet's state line reads **{name} paused with a question…** (`tasks.run.waitingAnswer`) while parked; your answer is written into the task's comment thread **before** the resume (the mirror is the record) and survives reload                                                                                                                                                                                                   |
| F8  | Review request surfaces         | Let a task-agent run settle ([tasks.md](tasks.md) F14); as the task's creator open the bell                                                                 | A **Review requested** notification (`inbox.taskReviewRequested`) deep-links to the task sheet (`?task=`), where the **Needs review** card (`tasks.review.needsReview`) poses the agent's question (default `tasks.review.defaultQuestion`); board/list cards wear the same badge                                                                                                                                                      |
| F9  | Review decision persists        | Decide the card — **Approve** (`tasks.review.approve`) or **Request changes** (`tasks.review.requestChanges`) with feedback                                 | Approval completes the task (Done after reload) and clears the pending review notifications; request-changes restarts the agent from your feedback — full flow depth is [tasks.md](tasks.md) F15 / [notifications.md](notifications.md) F7b–F7c; here assert the **approvals-side** invariant: the decision is recorded once and the card never reappears for that round                                                               |
| F10 | DSAR dual-approval              | With `requireDualApproval` enabled: as admin A file an erasure request ([governance.md](governance.md) F8); try to confirm it as A; then confirm as admin B | The filer cannot approve their own request (filer ≠ approver is enforced); admin B's confirmation schedules the erasure and the request's status transition survives reload — config-gated: mark **ENVIRONMENT** if the flag is off                                                                                                                                                                                                    |
| F11 | Chat human-input probe (mode A) | Mode A: send `e2e:humaninput` in a chat                                                                                                                     | Judge against [chat.md](chat.md) F18's expectation (human-input row + **Your answer is needed**, `chat.parts.humanInputPending`). **Known gap**: the mock emits a `request_human_input` tool call, but no such tool is registered in the live chat registry — if the turn renders only a generic tool-call row (or errors), record it in Issues Found as the F18 discrepancy rather than silently passing                              |
| F12 | Chat approval row (mode B)      | Mode B: drive a chat write that requires approval per [chat.md](chat.md) F35                                                                                | The chat-side rendering (badges `chat.parts.approvalPending` → `…approvalApproved` / `…approvalRejected`, status line `chat.generation.waitingApproval`) is chat.md F35's case — here only cross-check that the underlying approval reaches the same terminal state you decided (no orphaned **Pending** row after the decision)                                                                                                       |

## Boundary & error tests

| ID  | Test                       | Input                                                                              | Expected                                                                                                                                                                                                                             |
| --- | -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Double decision race       | Open F1's parked run in two tabs; **Approve** in one, then **Reject** in the other | The second decision is refused gracefully (the backend accepts transitions from `pending` only) — no crash, no state flip; the second tab settles on the first decision's alert                                                      |
| B2  | Blank / whitespace answer  | On the ask card: submit with an empty box, then whitespace only                    | **Send answer & resume** stays disabled — no mutation fires, no mirror comment appears in the task thread                                                                                                                            |
| B3  | Terminal run shows no card | Open a run that finished (or was stopped) while an approval/ask was pending        | No decidable card renders on a terminal run — only the outcome alert (approved/rejected) or the run's failure state; an unanswered ask simply never resumes the run (asks expire server-side after 7 days — note, don't wait for it) |

## Accessibility (WCAG 2.1 AA)

| ID  | Check           | Expected                                                                                                                                                                                                   |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Card controls   | **Approve** / **Reject** / **Send answer & resume** are real buttons, keyboard reachable with visible focus; the ask textarea has an accessible name (`automations.runs.ask.answerLabel`)                  |
| A2  | State as text   | Pending/approved/rejected is conveyed by text (card titles, alerts, badges — e.g. `chat.parts.approvalPending`), never by color alone; the decided card's replacement alert is announced (alert semantics) |
| A3  | Deep-link focus | Following the bell's review deep link opens the task sheet with focus moved into the dialog; Escape closes it and returns focus — the review card's buttons are reachable in tab order                     |

## Performance

| ID  | Metric            | Target                                                                                                                         |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Decision → resume | After Approve / Send answer, the run's status leaves **Waiting** in < 5 s without a reload (event-poke, not the poll backstop) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Approvals
Functional: ___/12   Boundary: ___/3   A11y: ___/3   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
