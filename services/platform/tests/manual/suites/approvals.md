# Approvals

> **Prefix** `APV-` · **Reset** none · **Cost** 22 boxes

Exercise the cross-cutting human-in-the-loop surface — every place a run or
agent parks for a human decision and what that decision does downstream. After
the AI-backend rewrite the **live** surfaces are: the automation-run
**approval card** (a connector write parked behind the approval gate) and
**ask card** (`ask_human` from an agent node) — each mounted on the run-detail
page _and_ the task sheet — plus the **task review** gate
([tasks.md](tasks.md) F15) and the governance **DSAR dual-approval**
([governance.md](governance.md) F8). The chat approval badges are
[chat.md](chat.md) F35's case — cross-referenced here, not duplicated. > The seven pre-rewrite approval namespaces (approvalCommon,
planApproval, documentWriteApproval, knowledgeWriteApproval,
connectorApproval, humanInputRequest, locationRequest) were **deleted
outright** from `en.yml` in #2919 — no reserve remains — so this guide carries
no cases for document-write, knowledge-write, plan, location, or form-based
human-input approvals. If one of those surfaces returns, it returns with new
keys and new cases here.

## Scope & routes

| Surface                      | Route                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Automation run detail        | `/dashboard/{org}/automations/{automationSlug}/runs/{runId}`                      |
| Project-scoped run detail    | `/dashboard/{org}/projects/{projectId}/automations/{automationSlug}/runs/{runId}` |
| Task sheet (cards + review)  | `/dashboard/{org}/projects/{projectId}/tasks/board` + `?task={taskId}`            |
| Chat thread (read-only rows) | `/dashboard/{org}/chat/{threadId}`                                                |
| DSAR dual-approval           | `/dashboard/{org}/settings/governance/data-subject-requests`                      |

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Most rows here are
**env-gated** (mode B and beyond) because the producers are real side-effects:

- **Approval card** (APV-F1–APV-F4): there is **no approval node type** — the
gate
  fires when a **write-effect connector action** runs in a **live** run of a
  **deployed** automation with a connected connector (extend automations.md's
  probe with a write-action connector node, deploy, **Run live**). Mock test
  runs perform no IO and never park.
- **Ask card** (APV-F5–APV-F7): `ask_human` is a sandbox-bridge tool — it
needs an
  **agent** node, a live sandbox, and a real model provider.
- **Task review** (APV-F8–APV-F9): produced by a settling task-agent run
  ([tasks.md](tasks.md) TASK-F14) or by parking a task at **In review** by hand;
  the decision is a status move, not a dialog.
- **DSAR dual-approval** (APV-F10): needs `requireDualApproval` in the org's
  `dsar_governance` config and a second admin account.

Mark any row you cannot produce **ENVIRONMENT** with the missing precondition,
per the guides' convention. Mode A drives only the rendering/regression
checks.

> **Agent note**: a decision is the event — approving/rejecting pokes the
> parked run immediately; watch the run's status badge leave **Waiting**
> without reloading (Convex-reactive, never poll by reload). A **terminal**
> run renders no cards at all — only the outcome alerts; if you see neither a
> card nor an alert, check the run status first. Approval state is four-valued
> (`pending` → `executing` → `completed`, or `rejected`); the card shows
> buttons only in `pending`.

## Functional tests

- [ ] `APV-F1` · **Approval card renders** — Park a live run on a connector
  write (Prerequisites) → open the run at
  `…/automations/{automationSlug}/runs/{runId}` → The run status is
  **Waiting**; the card titles **Waiting for your approval: {operation}**
  (`automations.runs.approval.title`, the operation being the connector name
  dot action); the subtitle names the requesting node
  (`automations.runs.approval.node`) or the generic line
  (`automations.runs.approval.pending`); the exact call parameters render as
  JSON under **The step would call with** (`automations.runs.approval.input`)
- [ ] `APV-F2` · **Approve → write executes** — On APV-F1's card click
  **Approve** (`automations.runs.approval.approve`) → The card is replaced by
  the info alert (`automations.runs.approval.approved`); the run leaves
  **Waiting** without a reload (the decision pokes it), the step performs the
  write (verify at the connector's target), and the run reaches a terminal
  status; reopening the run page shows the alert, never the buttons.
- [ ] `APV-F3` · **Reject → step fails** — Park a second run the same way →
  **Reject** (`automations.runs.approval.reject`) → The destructive alert
  (`automations.runs.approval.rejected`) replaces the card; the step fails and
  the run stops (**Failed**, `automations.runs.status.*`); the write did
  **not** happen at the connector's target.
- [ ] `APV-F4` · **Approval card on the task sheet** — Bind the parked
  automation to a task ([automations.md](automations.md) AUTO-F32) → open the
  task (`?task=` deep link) → The **same** approval card renders inside the
  task sheet's run panel; deciding there behaves exactly like APV-F2/APV-F3 —
  one approval, two mounts (run page and task sheet stay consistent without
  reload)
- [ ] `APV-F5` · **Ask card renders** — Run an automation whose agent node
  calls `ask_human` (Prerequisites) → open the parked run → Status
  **Waiting**; the card titles **The agent needs your answer to continue**
  (`automations.runs.ask.title`) and shows the agent's question verbatim; the
  answer box carries its label/placeholder (`automations.runs.ask.answerLabel`
  / `…ask.placeholder`); **Send answer & resume**
  (`automations.runs.ask.submit`) is disabled while the box is blank.
- [ ] `APV-F6` · **Answer → same session resumes** — Type an answer → **Send
  answer & resume** → The run leaves **Waiting** without reload and the
  agent's next output demonstrably uses your answer (same conversation
  resumed, not a fresh run); the card is gone on the now-running/terminal run.
- [ ] `APV-F7` · **Ask mirrors to the task** — With the automation bound to a
  task: answer the ask from the task sheet → The sheet's state line reads
  **{name} paused with a question…** (`tasks.run.waitingAnswer`) while parked;
  your answer is written into the task's comment thread **before** the resume
  (the mirror is the record) and survives reload.
- [ ] `APV-F7b` · **Ask alerts the project** — With APV-F7's parked ask: open
  the project board as another member who can see the project, and their bell
  → The task card swaps the working pulse for the amber **Waiting for your
  answer** glyph (`tasks.agentRuns.needsAnswer`); the bell carries **Agent
  needs your answer** (`inbox.agentQuestionAsked`) for every project-visible
  member ([notifications.md](notifications.md) NOTIF-F13); answering clears
  the glyph and flips the rows to read without reload.
- [ ] `APV-F8` · **Review request surfaces** — Let a task-agent run settle
  ([tasks.md](tasks.md) TASK-F14); as the task's creator open the bell → A
  **Review requested** notification (`inbox.taskReviewRequested`) deep-links
  to the task sheet (`?task=`); the board/list card wears the **Waiting on
  you** chip (`tasks.review.waitingOnYou`, or **Needs review**,
  `tasks.review.needsReview`, when nobody resolves)
- [ ] `APV-F9` · **Review decision persists** — Decide the review — set
  **Status** to **Done** (approve), or send it back with a comment
  **@-mention** of the assignee → Done completes the task (Done after reload)
  and clears the pending review notifications; the mention kick restarts the
  agent from your feedback and the task leaves **In review** — full flow depth
  is [tasks.md](tasks.md) TASK-F15 / [notifications.md](notifications.md)
  NOTIF-F7b–NOTIF-F7c; here assert the **approvals-side** invariant: the
  decision is recorded once on the approval row and a decided round never
  comes back.
- [ ] `APV-F10` · **DSAR dual-approval** — With `requireDualApproval` enabled:
  as admin A file an erasure request ([governance.md](governance.md) GOV-F8);
  try to confirm it as A; then confirm as admin B → The filer cannot approve
  their own request (filer ≠ approver is enforced); admin B's confirmation
  schedules the erasure and the request's status transition survives reload —
  config-gated: mark **ENVIRONMENT** if the flag is off.
- [ ] `APV-F12` · **Chat approval row (mode B)** — Mode B: drive a chat write
  that requires approval per [chat.md](chat.md) CHAT-F35 → The chat-side
  rendering (badges `chat.parts.approvalPending` → `…approvalApproved` /
  `…approvalRejected`, status line `chat.generation.waitingApproval`) is
  chat.md CHAT-F35's case — here only cross-check that the underlying approval
  reaches the same terminal state you decided (no orphaned **Pending** row
  after the decision)
- [ ] `APV-F13` · **No credential → no card** — In an organization with NO
  credential for a connector (Settings › Connectors), deploy an automation
  with a write node of that connector (e.g. a mail `send`) and **Run live** →
  the run never parks Waiting and no approval card is minted; it reads
  **Failed** (`automations.runs.status.failed`) and its alert is one readable
  sentence — "no usable credential for …", naming Settings → Connectors and
  ending with the hint "connect the connector, or mark one of its credentials
  as the default" — never a raw `{"code":…}` JSON blob; the node inspector's
  run section shows the same sentence as the node's error. REST `GET
  /api/v1/runs/{id}` answers `failureCode: connector_error`.

## Boundary & error tests

- [ ] `APV-B1` · **Double decision race** — Open APV-F1's parked run in two
  tabs; **Approve** in one, then **Reject** in the other → The second decision
  is refused gracefully (the backend accepts transitions from `pending` only)
  — no crash, no state flip; the second tab settles on the first decision's
  alert.
- [ ] `APV-B2` · **Blank / whitespace answer** — On the ask card: submit with
  an empty box, then whitespace only → **Send answer & resume** stays disabled
  — no mutation fires, no mirror comment appears in the task thread.
- [ ] `APV-B3` · **Terminal run shows no card** — Open a run that finished (or
  was stopped) while an approval/ask was pending → No decidable card renders
  on a terminal run — only the outcome alert (approved/rejected) or the run's
  failure state; an unanswered ask simply never resumes the run (asks expire
  server-side after 7 days — note, don't wait for it)
- [ ] `APV-B4` · **Unreadable approval** — On APV-F1's parked run, block the
  approval read in DevTools (Network → block the request URL
  `…/api/app/approvals/{approvalId}`) and reload → While the read retries the
  card already reads **Waiting for approval** (`automations.runs.waiting.approval`);
  once it gives up it says **Couldn't load this approval.**
  (`automations.runs.approval.loadFailed`) with **Try again**
  (`automations.runs.approval.retry`) — never an empty space, and no
  **Approve**/**Reject** while the operation is unreadable; unblock and press
  **Try again** → the card returns with the operation, its input and both
  decisions, without a reload.
- [ ] `APV-B5` · **A failed decision stays with its approval** — Park runs for
  a task A and for its subtask B, each on its own approval (APV-F4); open A's
  sheet, block `…/approvals/{approvalId}/decide` in DevTools and press
  **Approve** → **Couldn't record your decision.**
  (`automations.runs.approval.decideFailed`) shows under A's card with both
  buttons still enabled, never a raw `Request failed with status …`; open B
  from A's subtask list in the same sheet → B's card shows B's operation and
  input and no error; open A again (**Part of**), unblock and press **Approve**
  → A reads approved (`automations.runs.approval.approved`) at once, without
  waiting for a reload.

## Accessibility (WCAG 2.1 AA)

- [ ] `APV-A1` · **Card controls** → **Approve** / **Reject** / **Send answer
  & resume** are real buttons, keyboard reachable with visible focus; the ask
  textarea has an accessible name (`automations.runs.ask.answerLabel`)
- [ ] `APV-A2` · **State as text** → Pending/approved/rejected is conveyed by
  text (card titles, alerts, badges — e.g. `chat.parts.approvalPending`),
  never by color alone; the decided card's replacement alert is announced
  (alert semantics)
- [ ] `APV-A3` · **Deep-link focus** → Following the bell's review deep link
  opens the task sheet with focus moved into the dialog; Escape closes it and
  returns focus — the sidebar **Status** picker is reachable in tab order.

## Performance

- [ ] `APV-P1` · **Decision → resume** → After Approve / Send answer, the
  run's status leaves **Waiting** in < 5 s without a reload (event-poke, not
  the poll backstop)
