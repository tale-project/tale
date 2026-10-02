# Tasks

> **Prefix** `TASK-` · **Reset** none · **Cost** 116 boxes

Exercise a project's task workspace — the board and list views with
drag-and-drop across status lanes, the task sheet (description, comments with
mentions, attachments, dependencies, assignee), and the agent loop: start a
run, watch the step timeline and live transcript, receive outputs, and decide
the review — plus the **task page**, where Home opens a task: the same task
read as a conversation, beside the Home panel. Deepens projects.md F21 (run
visibility) and owns the board/run loop; project/agent creation is
[projects.md](projects.md)'s job, the notification side of reviews is
[notifications.md](notifications.md)'s.

## Scope & routes

| Surface        | Route                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| Tasks (alias)  | `/dashboard/{org}/projects/{projectId}/tasks` (redirects to the last-used view) |
| Board          | `/dashboard/{org}/projects/{projectId}/tasks/board`                             |
| List           | `/dashboard/{org}/projects/{projectId}/tasks/list`                              |
| Backlog (gone) | `/dashboard/{org}/projects/{projectId}/tasks/backlog` (redirects to `…/board`)  |
| Task page      | `/dashboard/{org}/tasks/{taskId}` (Home's rows open a task here)                |

The backlog **tab** was retired — Backlog is a status lane on the board/list
again (TASK-F1 asserts the redirect). On the board a task deep-links via
`?task={taskId}` (the target of notification rows) and opens in the task
dialog; Home opens a task on its own page, `/dashboard/{org}/tasks/{taskId}`,
which carries the same fields in a different frame (TASK-F20–TASK-F27).

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md), and create a
project ([projects.md](projects.md)). Task CRUD, DnD, comments, dependencies,
and assignment are pure Convex — **mode A suffices** for TASK-F1–TASK-F11 and
TASK-B1/TASK-B3–TASK-B4. The agent-run loop (TASK-F12–TASK-F15, TASK-B2) needs
a project **agent** whose sandboxed harness can actually run — a live
environment concern; without one, drive what you can (Start refusals surface
in the run-failure banner) and mark the undrivable rows **ENVIRONMENT**.
Mentions/assignment notifications need a second member (SETUP.md extras).
The repeating-task boxes (TASK-F37–TASK-F44, TASK-B12–TASK-B24,
TASK-A8–TASK-A11) need no agent; TASK-F43 alone needs a second member, and
TASK-B24 an organization owner or admin, who alone may delete a task.
TASK-B14 and TASK-B22 set due dates in the past, which the date picker
accepts. The due-date scan runs every five minutes, so TASK-F40, TASK-F44,
TASK-B22 and TASK-B24 wait up to five minutes for each next task it creates.
TASK-B17 and TASK-B29 need a deployed automation with a task contract bound to
the project (as in AUTO-F32). TASK-F47 needs a project agent on Claude Code
whose credential is a subscription broker on a local Tale AI gateway
(`services/ai-gateway`) holding one Claude account. The member boxes
(TASK-F49, TASK-F50, TASK-B26, TASK-B27) need a second account whose role is
**Member**, the default of **Add member** (SETUP.md extras); TASK-F50 also
needs a project agent that can run, and TASK-B27 a team the member is not in.

> **Agent note**: board DnD is `dnd-kit` — a single `dragTo` drops the card
> back at its source; drag with stepped mouse moves (down → several small
> moves over the target lane → up). Run state is Convex-reactive: never poll
> by reload; a run is settled when the status pill leaves **Queued/Working…**
> (`tasks.agentRun.status.*`). Verify every persisted edit by reloading and
> reopening the task (`?task=` survives reload). Field edits in the sheet save
> per change — there is no Save button.

## Functional tests

- [ ] `TASK-F1` · **View switch & redirects** — Open `…/tasks/board`, switch
  the view pills **Board** / **List** (`tasks.views.board` /
  `tasks.views.list`); then hit the bare `…/tasks` and `…/tasks/backlog` URLs
  → The pills swap the URL between `…/board` and `…/list`; the bare `…/tasks`
  replaces to the **last-used** view (persisted per project);
  `…/tasks/backlog` bounces to `…/board` — Backlog exists only as a lane,
  never a tab.
- [ ] `TASK-F2` · **Create a task** — In either view: header **Create task**
  (`tasks.actions.create`) → **Title** (`tasks.fields.title`) → submit → Toast
  **Task created** (`tasks.actions.created`); the card lands in **To do**
  (`tasks.status.todo`, the create default) and is present in **both** views
  and after reload; the same header button is the only create affordance (no
  per-lane +)
- [ ] `TASK-F3` · **Board lanes** — `…/tasks/board` → Six lanes render in
  order — **Backlog / To do / In progress / In review / Done / Cancelled**
  (`tasks.status.backlog` … `tasks.status.cancelled`); an empty lane shows
  **No tasks** (`tasks.board.noTasks`) and still accepts drops.
- [ ] `TASK-F4` · **Board drag-and-drop** — Drag a card across lanes (e.g. To
  do → In progress → Done), including into an empty lane → The card re-homes
  and the new status survives reload **and** shows in the list view; dragging
  an agent-assigned card over **In progress** shows the drop hint **Dropping
  here starts the agent run.** (`tasks.agentRun.willStart`) in the column
  header.
- [ ] `TASK-F5` · **List grouping & archived** — `…/tasks/list` →
  collapse/expand a status section; toggle **Show archived**
  (`tasks.list.showArchived`) → Sections mirror the six lanes with the same
  DnD; the collapse state survives reload (persisted per project); archived
  tasks appear only with the toggle on, wearing the **Archived** badge
  (`tasks.archived.badge`)
- [ ] `TASK-F18` · **Show archived survives a search** — With **Show archived**
  on and an archived task visible, type part of its title into **Search tasks**
  (`tasks.searchPlaceholder`) → The archived task stays in the results. Clear
  the search, turn **Show archived** off, search again → it is gone. The
  search narrows the board read itself, so **Show archived** governs it like
  every other filter and typing never drops rows the toggle just revealed.
- [ ] `TASK-F52` · **A search reaches every match** — In a project with more
  than 25 tasks whose titles share one word, where the only **Urgent**
  (`tasks.priority.p0`) one is the oldest: **Filter** → **Priority** →
  **Urgent**, then type the word into **Search tasks**
  (`tasks.searchPlaceholder`); clear the priority; pick **Assignee** → **You**
  (`tasks.assignee.you`); last, type a word no task holds → The Urgent task
  stays, alone; without the priority every match shows, a task whose only match
  is a comment included, and the lane counts add up to the number of matches;
  **You** keeps exactly your matches; the unmatched word leaves six **No
  tasks** (`tasks.board.noTasks`) lanes and no alert. DevTools → Network shows
  the query on the board read (`q=`) and no `/tasks/search` request.
- [ ] `TASK-F6` · **Backlog lane semantics** — **Create task** → open the
  **Status** picker (`tasks.fields.status`) in the dialog → **Backlog**; later
  open the task and promote it to **To do** → The task lands in the Backlog
  lane in both views; promoting through the same status picker moves it to To
  do — persisted after reload.
- [ ] `TASK-F7` · **Sheet fields live-edit** — Open a task → edit
  **Description** (`tasks.detail.addDescription`), **Priority**
  (`tasks.fields.priority`, e.g. `tasks.priority.p1`), **Labels**
  (`tasks.labels.add`), **Due date** (`tasks.dueDate.label`); expand **More
  fields** (`tasks.detail.moreFields`) → Each edit saves on change (no Save
  button) and survives reload in both views; the priority icon and label chips
  render on the card; More fields reveals read-only **Author** / **Created**
  (`tasks.fields.author` / `tasks.fields.created`); an overdue due date badges
  **Overdue** (`tasks.dueDate.overdue`)
- [ ] `TASK-F54` · **Close a task, every way** — Open a task from the board
  and close it with the dialog's **X**, then **Escape**, a click on the
  backdrop and the browser's **Back**; open one of its subtasks from the
  dialog and close that; repeat 390 px wide, where the task is a drawer → Each
  close fades out the task that was open, at the height it had, and hands the
  focus back to its card; the empty **Create task** (`tasks.actions.create`)
  form never shows on the way out, and **Create task** in the header still
  opens it.
- [ ] `TASK-F8` · **Comments & mentions** — In the sheet: write a comment
  (**Comment**, `tasks.actions.comment`) containing `@` → the mention listbox
  (`tasks.mentionPicker.title`) → pick a member; edit then delete a comment →
  The listbox offers only actors with project access (members + this project's
  agents, `tasks.assignee.agents` section); the posted comment renders the
  mention highlighted; a mentioned agent shows the preview chip **{slug} will
  respond** (`tasks.mentionPreview.willRespond`); an edited comment is marked
  (`tasks.comment.edited`); delete confirms (`tasks.comment.deleteConfirm`);
  the thread survives reload (`tasks.detail.comments`)
- [ ] `TASK-F34` · **Mentions in the description** — With a second member B
  and a project agent: **Create task** (`tasks.actions.create`) with a
  **Description** (`tasks.fields.description`) that mentions the agent, then
  open the task, edit the description to add `@B` and save; then reword the
  text around both mentions and save again → Before the create, the chip
  **{slug} will respond** (`tasks.mentionPreview.willRespond`) shows under the
  field; the new task is assigned to the agent and moves to **In progress**
  (`tasks.status.in_progress`) with a run (the run itself is env-gated: mark
  **ENVIRONMENT** without a runnable harness); after the first edit B's bell
  shows **You were mentioned** (`inbox.mention`) and the row opens the task;
  the rewording shows no chip while editing, and brings B no second row and the
  agent no second run. Then **Create task** straight into **In review**
  (`tasks.status.in_review`) with a description that mentions the agent → the
  card lands in **In progress** with a run, and the reviewer gets no review
  request that is withdrawn again
- [ ] `TASK-F9` · **Attachments** — Sheet → **Attachments**
  (`tasks.attachments.label`) → add via **Add attachments**
  (`tasks.attachments.add`) or the drop hint (`tasks.attachments.dropHint`);
  remove one (`tasks.attachments.remove`) → The upload shows
  `tasks.attachments.uploading` then the file chip; chips persist across
  reload; removal persists too.
- [ ] `TASK-F10` · **Dependencies** — Sheet side panel → **Dependencies**
  (`tasks.detail.dependencies`) → **Link a task…** (`tasks.detail.linkTask`)
  under **Blocked by** (`tasks.detail.blockedBy`) and **Blocks**
  (`tasks.detail.blocks`); remove one (`tasks.detail.removeDependency`) → The
  linked task lists under the right direction and the inverse shows on the
  other task; a task with an open blocker wears the **Blocked** indicator
  (`tasks.detail.blocked`) which clears when the blocker reaches
  Done/Cancelled; the picker never offers self or already-linked tasks; empty
  state reads **None** (`tasks.detail.noDependencies`)
- [ ] `TASK-F11` · **Assignee picker** — Sheet → the assignee control
  (**Assign**, `tasks.actions.assign`) → search (`tasks.assignee.search`);
  inspect the sections; assign yourself (`tasks.assignee.assignToMe`), then
  **Unassign** (`tasks.assignee.unassign`) → You are listed first with the
  **You** badge (`tasks.assignee.you`); below: org members with project
  access, then **Agents** (`tasks.assignee.agents`, only this project's agents
  — hint `tasks.assignee.liveAgentsOnly`) and **Automations**
  (`tasks.assignee.automations`); the assignment persists after reload and
  notifies the assignee ([notifications.md](notifications.md))
- [ ] `TASK-F12` · **Start an agent run** — Assign a project agent → the
  panel's **Run** row (`tasks.agentRun.label`) → **Start agent**
  (`tasks.agentRun.start`) — or drag the card to In progress → Toast
  `tasks.agentRun.started`; the task moves to **In progress** and the Run row
  shows **Queued** then **Working…** (`tasks.agentRun.status.queued` /
  `…status.running`); if the run cannot start, the banner **Agent couldn't
  start this task** (`tasks.runFailure.title`) names the reason and the status
  is unchanged — env-gated: mark **ENVIRONMENT** without a runnable harness.
- [ ] `TASK-F13` · **Run details & live transcript** — On a running (or
  finished) run: **Details** (`tasks.run.details`) → the dialog
  (`tasks.run.detailsTitle`) → The dialog streams the execution log while
  running (tool-only activity renders as collapsed per-tool rows, not silence;
  an empty log reads `automations.runs.agentLog.empty`); for an
  automation-owned task the property panel's **Run** row (`tasks.run.label`)
  shows the latest run's state badge (`automations.runs.status.*`) and its
  **Details** in every state — after the run finished too, when the subject
  panel's own Details is gone — and the dialog shows the step timeline
  (`automations.runs.timeline.label`) with the current step marked, titled in
  the past tense once nothing moves; **Open the full run**
  (`tasks.run.openFull`) navigates to the run page under
  `…/projects/{projectId}/automations/…`
- [ ] `TASK-F14` · **Outputs & settle** — Let a run finish → The Run row flips
  to **Finished** (`tasks.agentRun.status.settled`); the result is posted as
  an agent comment and the task parks at **In review** (agents never complete
  work themselves); files the agent wrote appear as the read-only **Output**
  block (`tasks.outputs.label`) and survive reload.
- [ ] `TASK-F15` · **Review decision** — On the parked task: first send it
  back — comment with an **@-mention** of the assignee agent carrying concrete
  feedback; after the rerun parks again, approve — sidebar **Status**
  (`tasks.fields.status`) → **Done** (`tasks.status.done`), or drag the board
  card from **In review** to **Done** → The mention comment starts a new run
  from your feedback and the task leaves **In review** while it runs —
  **resumed**, not fresh (prompts never render in the transcript, so verify
  behaviorally): the rerun addresses the feedback directly without
  re-analyzing the whole brief, references its earlier deliverable instead of
  redoing it, and revises the same file names; dev backstop: the backend logs
  NO `[task-agent] --resume launch … failed — restarting fresh` line for the
  run (that line = the fresh fallback, expected only when the previous
  conversation is gone). Setting **Done** completes the review: the status
  change is attributed to you in Activity (the audit trail records the action
  task.review_responded with your response), the task
  reaches **Done** after reload, and any project **editor** can decide — the
  gate is not locked to one reviewer; pending review notifications clear
  ([notifications.md](notifications.md) NOTIF-F7b/NOTIF-F7c)
- [ ] `TASK-F16` · **Activity timeline & archive** — Sheet → **Activity**
  (`tasks.detail.activity`); then **Archive** (`tasks.actions.archive`) →
  confirm (`tasks.archive.confirmTitle`); restore via list + **Show archived**
  → **Restore** (`tasks.actions.restore`) → The timeline records
  status/assignee changes, comments, and dependency edits
  (`tasks.activity.*`), and labels agent runs (`tasks.timeline.runLabel`) with
  their trigger and cost; archiving toasts `tasks.archive.success` and removes
  the card from the default views; restoring (`tasks.archive.restoreSuccess`)
  returns it — both persisted across reload.
- [ ] `TASK-F51` · **History names what a change left** — On a task you can
  edit that has no due date, set **Due date** to 1 October 2026 and clear it
  with its ✕ (`common.datePicker.clear`); assign a member and choose
  **Unassign** (`tasks.assignee.unassign`); write a **Description** and clear
  it; rename the task to `todo` and then to `done`; move it from **To do** to
  **Done**. Meanwhile a second member keeps the same task open (its **Copy
  link** link, pasted in their own session). Then read **Activity**
  (`tasks.detail.activity`) in English, **Deutsch** and **Français** → Setting
  the date reads **due date changed: No due date → 10/01/2026**, and each clear
  reads as the old value and then its absence: **due date changed: 10/01/2026
  → No due date** (`tasks.activity.empty.dueDate`), **Unassigned**
  (`tasks.assignee.unassigned`), **No description**
  (`tasks.activity.empty.description`); the renames read `todo → done` in
  every language, while the move reads **To do → Done** (`tasks.status.*`),
  **Zu erledigen → Erledigt** and **À faire → Terminé**; the second member's
  view shows each new line without a reload, and a reload shows the same lines.
- [ ] `TASK-F33` · **Delete a task** — As an organization owner or admin, open
  a task that has a subtask → **Delete** (`tasks.actions.delete`) under
  **Details** → confirm (`tasks.delete.confirmTitle`) → The toast reads
  `tasks.delete.success`, the task view closes, and the task and its subtask
  are gone from the board, the list and Home — also after a reload. Signed in
  as a member without an admin role, **Delete** is not offered.
- [ ] `TASK-F17` · **Retry after switching the agent's harness** — Let a run
  fail mid-work (stop the sandbox's spawner while the CLI is busy), then
  change the agent's **Harness** (e.g. Claude Code → Codex) and **Retry**
  (`tasks.agentRun.retry`) → The new run starts a fresh conversation on the
  preserved workspace (the transcript opens by inspecting the delivery box
  rather than resuming), and the previous CLI process is gone before the new
  one launches: `docker exec` into the agent's session container shows a
  single harness process, and the backend log carries the
  `predecessor … reap` line ahead of the new exec's start — never two CLIs
  writing one workspace.
- [ ] `TASK-F19` · **A missing skill fails once, without auto-retry** — Equip
  a project agent with a skill, then narrow that skill's visibility so the
  project no longer sees it (do not delete it); start a task with the agent
  → The run fails at once with **the agent run could not start: the skill
  "‹slug›" is not available to this run …**, stays at one run — no
  **Auto-retry 1 of 3** — and the task's runs list shows a single failed row;
  after unticking the unavailable skill in the agent dialog, **Retry**
  starts a run that reaches the harness.
- [ ] `TASK-F47` · **A token refresh resumes the run, and says so** — With
  the gateway-served agent from the preconditions, **Start agent**
  (`tasks.agentRun.start`) on a task that asks for ten minutes of work; while
  it works, restart the gateway with
  `AI_GATEWAY_TOKEN_REFRESH_SKEW_SECONDS=86400`, give its start-up pass ten
  seconds to refresh the account, then restart it without the setting → at
  its next model call the run fails on the vendor's 401 (`OAuth access token
  has been revoked`) and its retry starts at once, continuing the same
  conversation; while the retry works, its **Run** field
  (`tasks.agentRun.label`) reads **Resumed after a token refresh**
  (`tasks.agentRun.resumedAfterTokenRefresh`) under the status, never
  **Auto-retry 1 of 3** (`tasks.agentRun.autoRetrying`), both in the task
  dialog and on the task page. Switch the language to German, then French:
  the caption is translated in both places, and where it wraps (German, on
  the task page) its second line stays inside the field, clear of **Details**
  (`tasks.run.details`) and **Cancel run** (`tasks.agentRun.cancel`) below
  it — env-gated: mark **ENVIRONMENT** without a gateway account.
- [ ] `TASK-F36` · **A connector on the agent runs for the run's starter** —
  Give the organization an active credential for a connector with a read
  action (GlitchTip or GitHub) under **Settings > Connectors**
  (`navigation.connectors`) and equip it on a project agent under **Skills,
  connectors & tools** (`projects.agents.equipmentLabel`). Signed in as a
  second member with project edit access, **Start agent**
  (`tasks.agentRun.start`) on a task that asks the agent to call that read
  action and report what came back → In **Details** (`tasks.run.details`)
  the agent's `connectors` tool call answers `ok` with the service's data,
  never `unavailable` / `no_user_context`, and the report quotes it; on
  `/dashboard/{org}/settings/governance/logs` the **Audit logs** tab
  (`settings.logs.auditLogs`) lists the call as a **Connector** row
  (`settings.logs.audit.resourceTypeLabels.connector`) whose actor is the
  member who started the run, not the task's creator — env-gated: mark
  **ENVIRONMENT** without a runnable harness and a connector credential.
- [ ] `TASK-F30` · **A Claude Code agent on Claude Opus 5.5 and Fable 5.1** —
  With a provider credential that serves `claude-opus-5-5` (the Anthropic
  connector, or a Claude Code subscription broker), set a project agent's
  **Agent type** (`projects.agents.harnessLabel`) to Claude Code and its model
  to `claude-opus-5-5`, then **Start agent** (`tasks.agentRun.start`) on a
  task that asks it to list the workspace, have a subagent summarise one file,
  and report back; @mention the agent with a follow-up once it settles; repeat
  both runs with `claude-fable-5-1` → Every run settles **Completed**
  (`tasks.agentRuns.status.completed`); **Details** (`tasks.run.details`)
  shows the tool calls, the subagent's call and the report; the follow-up
  continues the same conversation; no step reads a provider 400 — env-gated:
  mark **ENVIRONMENT** without a credential that serves the models.
- [ ] `TASK-F31` · **Drop into an empty lane lands there** — On the board,
  with an empty lane (e.g. **Cancelled**) beside a lane holding cards, drag a
  card and release it just inside the empty lane's body, level with a card
  of the neighbouring lane (~150 px below the lane header) → The card takes
  the lane under the pointer (the drag live region names the card's key and
  that lane's status, `tasks.drag.dropped`, never an id), the lane
  highlights while hovered,
  and the status reads back after reload; releasing between two cards of a
  populated lane still slots the card between them, and a drop below a
  lane's last card appends it.
- [ ] `TASK-F32` · **Back walks the task trail; a subtask names its parent**
  — From the board (URL without `?task`) open a task A, then click one of
  its subtasks B (URL `?task=B`), then press browser **Back** twice → The
  first Back reopens A (`?task=A`), the second closes the dialog on the
  board — never the projects list; B's dialog header shows **Part of
  {A's key}** (`tasks.detail.partOf`) above its identifier, and clicking it
  opens A; closing a dialog then pressing **Forward** does not reopen it.
- [ ] `TASK-F35` · **Every harness has the built-in visual-aspect-analyzer** —
  Set a project agent with no skills equipped to an **Agent type**
  (`projects.agents.harnessLabel`) other than Claude Code (e.g. Codex or
  Gemini CLI), then **Start agent** (`tasks.agentRun.start`) on a task that
  asks it to list the skills it has and to quote the first sentence of the
  visual-aspect-analyzer's instructions; repeat with Claude Code → Both runs
  settle **Completed** (`tasks.agentRuns.status.completed`) and each report
  names `visual-aspect-analyzer` and quotes "Run this as the FINAL review
  step…"; **Details** (`tasks.run.details`) shows the skill read from its
  `SKILL.md`, not a search of the workspace — env-gated: mark
  **ENVIRONMENT** without a credential that serves both harnesses.
- [ ] `TASK-F46` · **Document skills work with the registries blocked** —
  Set `SANDBOX_EGRESS_ALLOWLIST=^example\.invalid$` in the stack's `.env`,
  recreate `sandbox-egress` and stop the project agent's running session so
  the next run starts a fresh one; equip the agent with the `docx` and `pptx`
  skills under **Skills, connectors & tools**
  (`projects.agents.equipmentLabel`), then **Start agent**
  (`tasks.agentRun.start`) on a task that asks for a one-page Word memo and a
  three-slide deck with an icon on every slide → The run settles
  **Completed** (`tasks.agentRuns.status.completed`) with a `.docx` and a
  `.pptx` under **Deliverables** (`tasks.outputs.label`) that open with the
  memo text and the slides' icons; **Details** (`tasks.run.details`) may show
  the skills' `npm install -g` refused by the egress proxy, and the scripts
  that `require('docx')` and `require('pptxgenjs')` run anyway; remove the
  allowlist afterwards — env-gated: mark **ENVIRONMENT** without a runnable
  harness.
- [ ] `TASK-F48` · **An agent creates an image into the task's deliverables**
  — With **Image generation** on ([governance.md](governance.md) GOV-F38) and
  an OpenRouter or OpenAI credential, signed in as a second member with
  project edit access, **Start agent** (`tasks.agentRun.start`) on a task that
  asks for "a square cover image for the launch post, saved as cover.png" →
  **Details** (`tasks.run.details`) shows the agent's `workspace_tool` call to
  `generate_image` answering `ok` with the saved path; when the run settles,
  **Deliverables** (`tasks.outputs.label`) lists `cover.png` (or the same name
  ending in .jpg or .webp, whichever format the model returned) and it opens
  as the image; on `/dashboard/{org}/settings/metrics/usage` the image model appears
  under **Top models** (`analytics.usage.tables.topModels.title`) with one
  request per image, and **Per-user usage** books it to the member who started
  the run, not to the task's creator — env-gated: mark **ENVIRONMENT** without
  a runnable harness and an image-capable credential.

### The task page

- [ ] `TASK-F28` · **Your tasks in Home** — Assign yourself an open task in two
  projects, make a third task (assigned to someone else) wait **In review**
  with you as its reviewer, and set a fourth task of yours to **Done**; then
  pick **Tasks** (`home.views.tasks`) in the Home panel → It lists the first
  three and not the Done one — only open work (Backlog, To do, In progress,
  In review) assigned to you or waiting on your review, never an archived
  task — each row with its status glyph, its title, its key (such as
  `WEB-12`, when the project has a key) and its status; the review task reads
  **Waiting for your review**
  (`home.row.awaitingReview`) with the accent dot, and the **Tasks** option
  carries the attention dot until you decide it. Clicking a row opens
  `/dashboard/{org}/tasks/{taskId}`.
- [ ] `TASK-F29` · **Task details in a narrower window** — At 900 px (a
  tablet, or a desktop window at half width) open a task → The conversation
  takes the full width beside the Home panel with no docked **Details**
  (`tasks.detail.details`); **Show details** (`tasks.detail.showDetails`)
  opens them as a sheet from the right over the conversation, Escape closes it
  and focus returns to the button; widen the window past 1280 px → the panel
  docks beside the thread again, as `TASK-F23` left it.
- [ ] `TASK-F20` · **The page's frame** — Open a task from Home → Beside the
  Home panel, one header: the **Hide sidebar** toggle (`home.panel.hide`),
  the task's status glyph, its title (click it, type, Enter — the new title
  survives a reload), and under it the project · key · status line (plus
  **Archived** for an archived task); at the right **Copy link**
  (`tasks.detail.copyLink`, TASK-F26), a **Board** button
  (`tasks.detail.openBoard`, icon only on a phone) and the details toggle
  (`tasks.detail.hideDetails` / `tasks.detail.showDetails`). A card with the
  brief — description, attachments, subtasks — leads the column, the
  conversation follows, and the composer sits at the foot; the page opens
  scrolled to the newest end. The browser tab reads the task's title, then
  the organization's name (NAV-F40).
- [ ] `TASK-F21` · **The task's conversation** — On a task with a few comments,
  a status change, an assignment and an agent run spread over several days →
  Under **Conversation** (`tasks.detail.conversation`) the comments and what
  happened to the task read as one column, oldest first with the newest at
  the foot, each day under its own date pill; a comment never appears a
  second time as a "comment added" event; with more comments than the first
  page holds, **Show earlier comments** (`tasks.detail.showEarlierComments`)
  sits at the top and loads them, and no event older than the loaded
  comments shows until it has. An empty thread invites the first comment
  (`tasks.detail.conversationEmpty`); a reader who may not comment sees
  `tasks.detail.noComments` instead.
- [ ] `TASK-F22` · **Comment from the page** — In the composer (placeholder
  `tasks.actions.commentPlaceholder`) write a comment with an `@`-mention of a
  member; send it with ⌘/Ctrl+Enter, then write another and send it with the
  round button (**Comment**, `tasks.actions.comment`) → A bare Enter adds a
  line; the hint under the field names the shortcut
  (`tasks.actions.commentShortcut`); the send button stays disabled while the
  field is empty; each comment lands at the foot of the conversation, in
  view, and survives a reload; an agent mention shows its chip
  (`tasks.mentionPreview.willRespond`) before sending, as in the board
  dialog. A reader who may not comment gets no composer.
- [ ] `TASK-F23` · **Details panel** — Press **Hide details**
  (`tasks.detail.hideDetails`), reload, open another task, then **Show
  details** (`tasks.detail.showDetails`) → The side panel **Details**
  (`tasks.detail.details`) — status, assignee, reviewer, priority, labels,
  dates, dependencies, the run — folds away and back; the choice survives the
  reload and holds for every task page on this device; a field edited there
  saves on change, as in the board dialog. Its **Project** field
  (`tasks.fields.project`) links to the task on its project's board
  (`?task=`), where the dialog opens on it.
- [ ] `TASK-F24` · **From the page to the board** — Press **Board**
  (`tasks.detail.openBoard`) → You land on the project's tasks
  (`/dashboard/{org}/projects/{projectId}/tasks`, the last-used view) with the
  Home panel still beside you and the project's row current in its Projects
  section; open the same task there → it opens in the board's task dialog,
  unchanged, with the same values the page showed.
- [ ] `TASK-F25` · **Task details on a phone** — At 390 px open a task from the
  Home list and press **Show details** (`tasks.detail.showDetails`) → The
  details (`tasks.detail.details`) slide up as a bottom sheet over the
  conversation — no docked panel; Escape or a swipe down closes it and focus
  returns to the **Show details** button; the header's back arrow
  (`common.aria.back`) returns to `/dashboard/{org}/home`.
- [ ] `TASK-F26` · **Copy the task's link or its key** — On the page of a task
  whose project has a key, press **Copy link** (`tasks.detail.copyLink`)
  beside **Board** and paste into a new tab; then click the key in the line
  under the title (tooltip **Copy {key}**, `tasks.detail.copyKey`) and paste
  → The toast reads **Link copied** (`tasks.detail.linkCopied`) and the link
  is exactly `{origin}/dashboard/{org}/tasks/{taskId}` — no query — opening
  the same task; the key copies bare (e.g. `WEB-2`), with the toast **WEB-2
  copied** (`tasks.detail.keyCopied`). Both are buttons Tab reaches with a
  focus ring, named **Copy link** and **Copy WEB-2**; a task in a project
  without a key has no key to copy.
- [ ] `TASK-F27` · **A comment draft stays with its task** — Type a comment on
  a task page without sending, open another task from Home, then come back;
  press **Board** and open the same task in the board's dialog; reload; then
  send the comment and reload again → The unsent text is back each time — on
  the page, in the board dialog, after the reload — and only on its own task
  (the other task's composer is empty); sending clears it, and the reload
  after sending shows an empty composer. Local storage keeps it under
  `task-comment-draft-{userId}-{orgId}-{taskId}` until it is sent.
- [ ] `TASK-F45` · **Dates read in the UI language** — Give a task a start
  and a due date, then switch the language to **Deutsch** and to
  **Français** and open the task and its **Due date** calendar each time → The
  dates read like `29. Sep. 2026` and `29 sept. 2026`, never the English
  `Sep 29, 2026`; the calendar's month and weekday names are German or French
  and its week starts on Monday (in English, on Sunday); a screen reader
  names the month group and day choices in that language too; the stored day does
  not move — switching back to English shows the same date.

### Repeating tasks

- [ ] `TASK-F37` · **Pick a preset on a task without a due date** — Open a task
  in **To do** with no **Due date** (`tasks.dueDate.label`) and no **Start
  date** (`tasks.startDate.label`), open **Repeat** (`tasks.repeat.label`)
  below it and pick **Weekly on** today's weekday; on a second such task pick
  **Every weekday** (`recurrence.sentence.weekdays`); then **Create task**
  (`tasks.actions.create`) with **Repeat** set to **Daily** → The popover lists
  **Never** (`recurrence.never`) checked, **Daily**, **Every weekday** with the
  badge **Mon–Fri** (`recurrence.workweekRange`), **Weekly on** today's
  weekday, **Monthly on day** today's day and **Yearly on** today's date, then
  **Custom** (`recurrence.custom`), and under them **No due date yet. Picking a
  repeat sets it to the first matching day.** (`tasks.repeat.noDueDateHint`);
  one click saves and closes it, focus back on the trigger; **Due date** then
  holds the first matching day on or after today — today for **Weekly on**, and
  for **Every weekday** today on a weekday or the coming Monday on a weekend —
  and the trigger reads the rule in short (**Weekly · Tue**, **Weekdays**,
  `recurrence.compact.weekdays`); reopened, the pick is checked and **Next due
  dates** (`tasks.repeat.nextDueDates`) lists the three due dates after this
  one; the card on **Board** and the row on **List** show the repeat icon,
  whose tooltip reads **Repeats: Weekly on {weekday}**
  (`tasks.repeat.indicator`); Activity records one **Repeat changed**
  (`tasks.activity.repeatChanged`) from **Never** to the rule per pick; the
  rule, the due date and the icon survive a reload. The created task carries
  **Daily** with today as its due date.
- [ ] `TASK-F38` · **Closing brings back one next task** — On a task that does
  not repeat and is due today or later, pick **Repeat** → **Weekly on** its due
  date's weekday; give it a **Start date** (`tasks.startDate.label`) two days
  before its due date, a priority, a label, you as assignee, a reviewer, an
  attachment, a comment and a **Blocked by** link (`tasks.detail.blockedBy`) to
  another task, then set **Status** (`tasks.fields.status`) to **Done**
  (`tasks.status.done`) → The toast **Next task created**
  (`tasks.repeat.nextCreated`) reads **Due {date}** (`tasks.dueDate.due`) with
  a **Stop repeating** button (`tasks.repeat.stop.action`) — leave it; exactly
  one new task sits at the foot of **To do** with the next key, the same title,
  description, priority, labels, assignee, reviewer, attachments (the file
  opens) and repeat, a due date one week after the closed one and a start date
  two days before that — and no comments, no **Blocked by** link and no
  **Deliverables** (`tasks.outputs.label`); its Activity opens with **Created**
  (`tasks.activity.created`). The closed task stays in **Done**; its card loses
  the repeat icon, which the copy now carries; its **Repeat** still reads the
  rule but opens nothing, its tooltip ending **This series continues on {key}.
  Change the repeat there.** (`tasks.repeat.reason.continued`), and under it
  **Next task: {key}** (`tasks.repeat.nextTask`) opens the copy, with **Stop
  repeating** (`tasks.repeat.stop.action`) beside it; its Activity records
  **Next task created** (`tasks.activity.repeatNext`) naming that key — all
  after a reload. Dragging another repeating card into **Done** on the board
  brings back one copy and the toast the same way.
- [ ] `TASK-F39` · **A custom repeat, saved once** — On a task due on a Tuesday
  that does not repeat yet: **Repeat** → **Custom** (`recurrence.custom`); in
  the Custom view keep **Week** (`recurrence.editor.units.weekly`), raise the
  step to 2 with **+** (`common.numberStepper.increase`), press **Th**
  (`recurrence.weekdayChip.thursday`) beside the pressed **Tu**, go back with
  **Back to presets** (`recurrence.back`), then open **Custom** again and
  **Save** (`common.actions.save`) → The view opens on **Week** with the due
  date's weekday pressed and the step between **Every** and **weeks**; **Next
  due dates** follows every edit; back in the list the draft is kept — the
  **Custom** row is checked with **Every 2 weeks on Tuesday and Thursday**
  under it, and **Cancel** / **Save** show — and nothing is written before
  **Save**. After it the popover closes, the trigger reads **Every 2 weeks**,
  followed by **· Tue, Thu** only where the column has room (the tail drops
  whole, never cut mid-word), the card's tooltip reads the whole sentence, and
  Activity has exactly one **Repeat changed** row for the session; after a
  reload **Custom** reopens on 2, weeks, Tuesday and Thursday. **Month** asks
  **On day** (`recurrence.editor.onDay`) with the due date's day and, from 29
  up, notes **Shorter months use their last day.**
  (`recurrence.editor.lastDayHint`); **Year** asks **On** a month and a day and
  notes **In other years, this falls on Feb 28.**
  (`recurrence.editor.leapDayHint`) for 29 February; the step stays within 1 to
  99 (a typed 0 or 100 is corrected on blur) and the last pressed weekday
  cannot be turned off, so **Save** is never disabled.
- [ ] `TASK-F40` · **Create the next task on the due date** — On a task that
  repeats **Daily** and is due today, open **Repeat**, tick **Create the next
  task on the due date** (`tasks.repeat.onDue.label`) and **Save**; do the same
  on a second **Daily** task due in three days, then set it to **Done** before
  its due date → The first task's checkbox reads **This one is already due, so
  the next task is created right away.** (`tasks.repeat.onDue.descriptionNow`),
  the second's **Even if this one is still open on {date}.**
  (`tasks.repeat.onDue.description`) naming its due date; ticking brings
  **Cancel** / **Save** into the preset view, and saving writes one **Repeat
  changed** row; the trigger's icon becomes a calendar, its tooltip adds **The
  next task is created on the due date, or sooner if this one is done or
  cancelled first.** (`tasks.repeat.mode.dueDate`), and the card's tooltip
  reads **Repeats: Daily, next task on the due date**
  (`tasks.repeat.ruleOnDue`). Within five minutes, with no toast, the first
  task — still open in its lane — gets its next task, due tomorrow and carrying
  the same rule; both timelines credit **System**
  (`tasks.timeline.systemActor`); the first task's **Repeat** locks with **Next
  task: {key}** and **Stop repeating** under it and its card loses the icon,
  and closing it later brings back nothing and no toast. The second task's
  close brings back its next task at once, with the toast, as a close always
  does.
- [ ] `TASK-F41` · **Subtasks come back with their parent** — On a task that
  repeats **Weekly on** its due date's weekday, add subtasks
  (`tasks.detail.addSubtask`) A, with a due date two days before the parent's,
  and B; make A block B (**Blocks**, `tasks.detail.blocks`), make B **Blocked
  by** an unrelated task, comment on A, add a third subtask and archive it;
  close A and B, then the parent → The next task holds copies of A and B only —
  none of the archived one — each in **To do** (`tasks.status.todo`) whatever
  its status was, with its title, description, priority, labels and people and
  no comments; the copy of A is due one week after A was, two days before the
  next task's due date; the copy of A blocks the copy of B, and neither is
  blocked by the unrelated task; each copy names the new parent (**Part of
  {key}**, `tasks.detail.partOf`), has no rule of its own and reads **With
  {key}** (`tasks.repeat.withParent`) under **Repeat**; the original A and B
  stay closed under the closed parent. A subtask under A comes back under the
  copy of A the same way.
- [ ] `TASK-F42` · **Stop repeating from the toast** — Close a repeating task
  and press **Stop repeating** (`tasks.repeat.stop.action`) in the toast; close
  a second one, switch to another tab (the toast waits while the window is in
  the background), move its new next task to **In progress**
  (`tasks.status.in_progress`) there, come back and press **Stop repeating**;
  do the same with a third, but only rename its next task, leaving it in **To
  do** → The first toast turns into **Repeat stopped**
  (`tasks.repeat.stop.done`) — **The next task was removed.**
  (`tasks.repeat.stop.removed`) — and the next task is gone from **To do** with
  any subtasks, also after a reload, while the closed task's **Repeat** reads
  **Never** with neither a **Next task** link nor **Stop repeating**, its
  tooltip **This series has stopped.**
  (`tasks.repeat.reason.stopped`), and its Activity records **Repeat
  changed** to **Never**; reopened, its **Repeat** stays locked with that
  reason, and closing it again brings back nothing. The second and the third
  read **{key} was already changed, so it stays — it just won't repeat.**
  (`tasks.repeat.stop.kept`): the next task stays where it was — in **In
  progress**, or renamed in **To do** — its **Repeat** reads **Never** and its
  card shows no repeat icon, closing it brings back nothing, and the closed
  task keeps its **Next task** link, with no **Stop repeating** beside it and
  its **Repeat** reading **Never**, its tooltip **This series has stopped.**
  (`tasks.repeat.reason.stopped`).
- [ ] `TASK-F43` · **Watchers follow the series** — With a second member B who
  can see the project: as B open a repeating task you created and press
  **Watch** (`tasks.watch.watch`); as yourself press **Unwatch**
  (`tasks.watch.unwatch`) on it, then close it; as B comment on the next task,
  then comment on it as yourself → On the next task B's details show
  **Unwatch** — B watches it without pressing anything; until you comment,
  yours show **Watch** — your unwatch carried over, although you created the
  series — and B's comment rings no bell of yours unless it mentions you; B's
  bell gets your comment. A watcher who lost access to the project before the
  close does not follow the next task.
- [ ] `TASK-F44` · **Stop repeating stays on the task** — Close a repeating
  task and let its toast go; open the closed task and press **Stop repeating**
  (`tasks.repeat.stop.action`) beside **Next task: {key}**
  (`tasks.repeat.nextTask`) under **Repeat**; close a second one, move its next
  task to **In progress** (`tasks.status.in_progress`), open the closed one on
  its task page (`/dashboard/{org}/tasks/{taskId}`) and press **Stop
  repeating** there; last, open the first task of a due-date series once the
  scan has continued it (as in `TASK-F40`) and press it → The button sits
  beside the **Next task** link in the board's dialog and on the task page
  alike, spins while the stop runs, then disappears; the first stop shows
  **Repeat stopped** (`tasks.repeat.stop.done`) with **The next task was
  removed.** (`tasks.repeat.stop.removed`), and the next task and its link are
  gone, also after a reload, while **Repeat** reads **Never** with **This
  series has stopped.**
  (`tasks.repeat.reason.stopped`); the second reads **{key} was already
  changed, so it stays — it just won't repeat.** (`tasks.repeat.stop.kept`),
  its link staying while **Repeat** reads **Never** with **This series has
  stopped.** (`tasks.repeat.reason.stopped`); the due-date task, still open,
  offers the button too, and after its stop it shows no repeat icon, its
  **Repeat** reads **Never** and stays locked, and no further next task appears
  within ten minutes.

### A member's own tasks

- [ ] `TASK-F49` · **A member creates a task** — Signed in as the member, open
  an organization-wide project's **Tasks** tab and press **Create task**
  (`tasks.actions.create`) in the header; create a task with a title and an
  attachment → The card lands in **To do** (`tasks.status.todo`); after a
  reload its dialog names the member as **Author** (`tasks.fields.author`),
  the title is an editable field, **Status** (`tasks.fields.status`) opens its
  picker and **Archive** (`tasks.actions.archive`) is offered, while the
  **Labels** field has no **Manage labels** (`tasks.labels.manage`) and there
  is no **Delete** (`tasks.actions.delete`).
- [ ] `TASK-F50` · **A member puts a project agent on their task and closes
  it** — On the task from `TASK-F49`, pick a project agent under **Assignee**
  (`tasks.fields.assignee`) and press **Start agent** (`tasks.agentRun.start`)
  → The card moves to **In progress** (`tasks.status.in_progress`) and the Run
  field reads **Working…** (`tasks.agentRun.status.running`); once the run
  settles, the agent's report is a comment, its files are listed under
  **Deliverables** (`tasks.outputs.label`), the task sits in **In review**
  (`tasks.status.in_review`) and the member's bell announces the move; the
  member moves it to **Done** (`tasks.status.done`) and it stays there after a
  reload, and the member's **Usage** page (`navigation.usage`) counts the
  run's spend.
- [ ] `TASK-F53` · **One agent puts another to work** — As an editor, give a
  manager agent **Start other agents on tasks**
  (`projects.agents.tool.task_start_agent`) under **Skills, connectors &
  tools**, leave a second task unassigned in **To do**, and start the manager
  on a task whose description asks it to start the second agent on that task
  with a one-line answer as its message → the second task is assigned to the
  second agent and sits in **In progress** (`tasks.status.in_progress`), its
  history names the manager for both changes, and its timeline lists the run
  (`tasks.timeline.runLabel`) as `tasks.agentRuns.trigger.delegated`, **started
  by** (`tasks.timeline.startedByAgent`) the manager; the manager's own report
  keeps the run id. An automation agent node's picker does not offer the tool.

- [ ] `TASK-F55` · **A project with no agent, in Assignee** — With the
  organization's standard agent switched off ([governance.md](governance.md)
  `GOV-F52`), as the member, on a task of theirs in a project with no agent,
  open **Assignee**
  (`tasks.fields.assignee`) → there is no **Agents** section
  (`tasks.assignee.agents`), the footer reads `tasks.assignee.noAgentsReader`,
  and nothing navigates away. As an editor of the same project, open **Create
  task** (`tasks.actions.create`), type a title and a description, then open
  **Assignee** → **Create an agent…** (`tasks.assignee.createAgent`) with
  `tasks.assignee.createAgentHint`; choose it → **New agent**
  (`projects.agents.dialogCreateTitle`) opens over the form; fill it and press
  **Create agent** (`projects.agents.createSubmit`) → the form still holds its
  title and description and **Assignee** names the new agent; after **Create
  task** and a reload, the task is assigned to that agent.
- [ ] `TASK-F56` · **Assigning an agent does not start it, and says so** — As
  the member, assign a project agent to a task of theirs in **To do**
  (`tasks.status.todo`) → the Run field offers **Start agent**
  (`tasks.agentRun.start`) above **The agent waits until you start it.**
  (`tasks.agentRun.notStartedYet`), no run starts, and the task is still in
  **To do** after a reload. A second member who opens the task sees neither.
- [ ] `TASK-F57` · **A run that fails for good says so, in the task and the
  bell** — As an admin, add a monthly cost rule on
  `/dashboard/{org}/settings/governance/policies-limits` (**Budget rules**,
  `governance.budgets.title`) that caps the member below what they have spent;
  as the member, press **Start agent** on a task of theirs → the task shows
  **The agent couldn't finish this task** (`tasks.agentRun.failureTitle`) with
  `tasks.agentRun.failure.budget` and **Retry** (`tasks.agentRun.retry`); the
  Run field's **Details** (`tasks.run.details`) opens the same sentence above
  **What the run reported** (`tasks.agentRun.reported`) and the cap's own
  reason; the member's bell holds **Agent run failed**
  (`inbox.agentRunFailed`) with `inbox.agentRunFailedBudgetBody`, which opens
  the task (and an email arrives when actionable email is on). Delete the rule
  and press **Retry** → the notice leaves the task and the bell row turns read
  without a click or a reload.
- [ ] `TASK-F58` · **An open task follows its run** — Keep a task open while
  its agent starts and works → the Run field moves from **Queued**
  (`tasks.agentRun.status.queued`) to **Working…**
  (`tasks.agentRun.status.running`) to its end, and the run's row under
  **Activity** changes with it, without a reload.
- [ ] `TASK-F59` · **A Gemini CLI task continues after a tool turn** — Set a
  project agent's **Agent type** (`projects.agents.harnessLabel`) to Gemini
  CLI and **Start agent** (`tasks.agentRun.start`) on a task that asks it to
  run `echo hello` with its shell tool and report; once it settles
  **Completed** (`tasks.agentRuns.status.completed`), comment on the task
  mentioning the agent with a follow-up question, then **Retry**
  (`tasks.agentRun.retry`) a later run you cancelled mid-work → Both later
  runs settle, each as a fresh conversation over the preserved workspace
  (the run re-reads the task brief and the earlier rounds; no
  `--resume` launch, the backend logs no resume), and neither fails with a
  provider refusal about a `tool` message or function response parts; the
  gateway log shows one `tool` message per tool call on every request —
  env-gated: mark **ENVIRONMENT** without a credential that serves Gemini
  CLI.
- [ ] `TASK-F60` · **Create a task and start its agent in one step** — On
  a project board, **Create task** (`tasks.actions.create`) with a project
  agent under **Assignee** and **Status** **To do** → the footer adds
  **Create and start agent** (`tasks.actions.createAndStart`, with a play
  icon) beside **Create task**; clicking it closes the dialog, and the new
  card's run is queued or working without a reload. **Create task** instead
  leaves the run waiting for **Start agent** (`tasks.agentRun.start`). With
  **Status** set to **In progress**, the primary button itself reads
  **Create and start agent** — an agent's task created in progress starts
  at once; with a person as the assignee, only **Create task** is offered.
  With task automation switched off for the organization, **Create and start
  agent** creates nothing: the dialog stays open with a toast saying why the
  agent cannot start, and **Create task** still creates the task.
- [ ] `TASK-F61` · **A Member hands a task to the standard agent** — As the
  member, in a project without agents of its own (the docs demo seed's
  **Customer onboarding portal**), open **Assignee** (`tasks.fields.assignee`)
  on a task of theirs → under **Agents** (`tasks.assignee.agents`) it offers
  **Standard agent** (`tasks.assignee.standardAgent`) with
  `tasks.assignee.standardAgentHint`, the footer reads
  `tasks.assignee.standardAgentFooter`, and there is no **Create an agent…**
  (`tasks.assignee.createAgent`), which an editor sees beside it. Choose it →
  the assignee reads **Standard agent** at once and after a reload, and the
  project's **Agents** tab lists it ([projects.md](projects.md) `PROJ-F37`);
  **Start agent** (`tasks.agentRun.start`) runs it to **In review**
  (`tasks.status.in_review`), with a requested Word, PowerPoint, Excel or PDF
  file under the task's deliverables — env-gated: mark the run
  **ENVIRONMENT** without a runnable harness.

- [ ] `TASK-F62` · **Let a manager triage without starting work** — As an editor, enable **Change task priority and agent assignment** (`projects.agents.tool.task_update_metadata`) on a project agent, using the keyboard in **Skills, connectors & tools**; save and reopen it → the named option remains checked with its **Writes data** badge and visible focus, fits at desktop and phone widths in EN/DE/FR, and an automation agent node never offers it. Let that manager change an idle task’s priority and agent assignment, then watch the task from a second browser session → both values refresh, the activity names the manager, status and run history stay unchanged, and a reload keeps the values.

## Boundary & error tests

- [ ] `TASK-B1` · **Dependency cycle** — Build a chain A blocks B, B blocks C,
  then on C try to add **Blocks** → A (the picker pre-excludes direct 2-node
  cycles, so a 3-hop chain is needed) → The link is refused with the
  destructive toast **That would create a circular dependency.**
  (`tasks.detail.dependencyCycle`); no edge is added after reload.
- [ ] `TASK-B2` · **Cancel & retry** — With a live run: drag the card out of
  In progress; separately use **Cancel run** (`tasks.agentRun.cancel`) → The
  drag opens the confirm (`tasks.subject.cancelConfirmTitle`, body
  `tasks.subject.cancelConfirmMove`) — cancelling the dialog leaves the run
  alive; confirming (or Cancel run) toasts `tasks.agentRun.cancelled`, the Run
  row shows **Cancelled**, and **Retry** (`tasks.agentRun.retry`) appears
  (also on **Failed**); Retry of a run whose turn had started **resumes the
  same harness conversation** (every harness but Gemini CLI, which starts
  fresh — `TASK-F59`) — the agent picks up mid-work without redoing
  environment setup or finished steps (prompts never render in the transcript;
  judge by behavior) — and keeps the unpublished delivery box; a
  failed-at-launch or foreign-incarnation predecessor falls back to the full
  brief, observable as the run re-inspecting the workspace from scratch plus
  the backend's `--resume launch … failed — restarting fresh` log line.
- [ ] `TASK-B3` · **Reassign guard** — Reassign a task owned by an
  agent/automation — once idle, once mid-run → The confirm **Reassign this
  task?** (`tasks.assignee.handoffConfirmTitle`) explains the detach
  (`tasks.assignee.handoffConfirm`); mid-run it warns the live run is
  cancelled first (`tasks.assignee.handoffConfirmLiveRun`); cancelling changes
  nothing (assignee unchanged after reload)
- [ ] `TASK-B4` · **Close guards** — Give a task an open subtask
  (`tasks.detail.addSubtask`) and set the parent to Done → The parent is
  blocked with **Finish all subtasks before closing this task.**
  (`tasks.detail.parentCloseGuard`) and keeps its status after reload.
- [ ] `TASK-B5` · **Spend cap refuses a run** — Under **Settings > Governance
  > Policies & Limits**, add an org-scoped monthly budget rule whose max cost
  is below the org's spend so far this month; then **Start agent** on a task
  of a managed-credential agent → The Run row flips to **Failed** and the task
  shows **The agent couldn't finish this task** (`tasks.agentRun.failureTitle`)
  with `tasks.agentRun.failure.budget`; **Details** (`tasks.run.details`)
  names the cap (`Cost limit reached for this monthly period …`); **Retry** is
  offered but no automatic retry follows (the run stays failed); raising the
  rule and retrying starts the run, and the run's cost then appears under
  **Governance > Usage** for the person who started it.
- [ ] `TASK-B6` · **A harness that cannot start names its cause** — Make the
  CLI refuse to start (e.g. point the agent at a Codex run whose
  `CODEX_HOME` directory is missing, or break the harness's config) and
  **Start agent** → The Run row flips to **Failed** and its reason reads
  **The harness exited unexpectedly (exit code 1) without completing the
  turn. Last output: …** followed by the CLI's own last stderr lines (for
  Codex: `Error finding codex home …`) — never the bare exit code alone; no
  credential appears in the quoted output. With a healthy runtime, Codex +
  DeepSeek starts, reaches the model and completes a tool-using run (a task
  that asks the agent to list the workspace and report back settles
  **Completed**; **Details** shows Codex announcing its thread, the tool
  call and the report). A run the model's provider refuses mid-way names the
  provider's own sentence and status as its reason (e.g. **… must be passed
  back to the API. (API status 400)**) — never the agent's last narration
  sentence.
- [ ] `TASK-B7` · **A task page that leads nowhere** — Open
  `/dashboard/{org}/tasks/{taskId}` for a task that was deleted, for an id
  that never existed, and for a task in a project you cannot read → Once the
  read answers, the page shows **Page not found** (`common.notFound.title`)
  with **Back to Home** (`common.notFound.backToDashboard`), which leads
  to `/dashboard/{org}`, beside the Home panel — never a blank column without
  a header or a way back. While the read is still on its way the page shows
  no dead end.
- [ ] `TASK-B8` · **Deep link to a missing task** — Open the board with
  `?task=00000000-0000-4000-8000-000000000000`, then with
  `?task=not-a-uuid`, then with the id of a task that was deleted → The
  dialog opens titled **Tasks** and reads **We couldn't find that task. It
  may have been deleted.** (`tasks.detail.notFound`) with a **Close**
  button that returns to the board (the URL loses `?task`); while the read
  is in flight the dialog shows a skeleton, never the message; a task you
  may not see (another member's private project) reads the same, not a
  blank sheet.
- [ ] `TASK-B9` · **A mention that names no one** — In a task comment, pick a
  teammate from the mention listbox, type `@nobody-here` by hand, and send →
  The comment posts and the teammate gets the mention; a toast **Mention not
  recognized** (`common.mentions.unresolvedTitle`) names `@nobody-here` and
  says no notification was sent (`common.mentions.unresolvedDescription`).
- [ ] `TASK-B10` · **A starter who left is not acted for** — Set up as in
  TASK-F36 and start the run as the second member; while it works, remove
  that member on `/dashboard/{org}/settings/members` (**Remove member**,
  `settings.organization.removeMember`), then @mention the agent in a comment
  asking for the same read → The agent's next `connectors` call answers
  `unavailable` with the code `access_denied`, and the agent relays that the
  member it acts for is no longer active and that a current member can cancel
  the run (or let it finish) and start it again; that call adds no
  **Connector** row to the audit log. After **Cancel run**
  (`tasks.agentRun.cancel`), your own **Start agent** (`tasks.agentRun.start`)
  gives a run whose call succeeds and is logged under you.
- [ ] `TASK-B11` · **A description past the cap, seen** — In German and in
  English, at desktop width and at 390 px, open a task's description
  (**Edit**, `common.actions.edit`) and paste 20,005 characters → The line
  under the field (`tasks.errors.TASK_DESCRIPTION_INVALID`) reads in the UI
  language with the cap's number grouping (`20.000`, `20,000`), a red
  counter with the same grouping (`20.005 / 20.000`, `20,005 / 20,000`) sits
  between the field and that line, both wrap inside the dialog without
  clipping or pushing **Save** (`common.actions.save`) out of view, and a
  screen reader announces the line once and reads the counter when the field
  takes focus — deleting characters moves only the counter and announces
  nothing more; add two blank lines after the text and the counter stays put,
  since it counts what a save keeps; delete five, **Save**, reload → the line
  and the counter are gone and the description reads back at 20,000
  characters.
- [ ] `TASK-B12` · **Reopen and close again** — On the task `TASK-F38` closed,
  set **Status** back to **In progress** (`tasks.status.in_progress`); while it
  is open, copy the `orgId` of any `…?orgId=` request in DevTools → Network and
  run `fetch('/api/app/tasks/{taskId}?orgId={orgId}', {method: 'POST', headers:
  {'content-type': 'application/json'}, body: JSON.stringify({repeat:
  {frequency: 'daily', interval: 1, timezone: 'Europe/Zurich'}})})` in the
  console; then set it to **Done** again, then drag its card to **Cancelled** →
  No second copy appears in **To do** and no toast shows; while it is open
  again its **Repeat** stays locked with **This series continues on {key}.**
  (`tasks.repeat.reason.continued`) and its card shows no repeat icon, and the
  hand-built rule answers 400 `TASK_REPEAT_INVALID` with `This task already
  created its next task` — its **Repeat** keeps the rule it had and Activity
  gains no **Repeat changed** row, also after a reload; **Next task** still
  names the copy `TASK-F38` brought back.
- [ ] `TASK-B13` · **Cancelled continues the series too** — Move a repeating
  task from **To do** to **Cancelled** (`tasks.status.cancelled`) with the
  **Status** picker, and drag another repeating card into **Cancelled** on the
  board → Each brings back exactly one copy in **To do**, dated and filled as
  for **Done**, with the toast.
- [ ] `TASK-B14` · **A late or early close keeps the series on its days** —
  Close a **Daily** task whose due date is a week ago (it badges **Overdue**,
  `tasks.dueDate.overdue`); close a weekly task due three weeks ago; close a
  weekly task due next week; close a **Monthly on day** 31 task due on a coming
  31st whose next month has 30 days, then its copy → The daily copy is due
  today and is the only copy — never yesterday or one per missed day; the late
  weekly copy is due on the first matching weekday on or after today; the early
  weekly copy is due one week after the closed task's due date, not on this
  week's matching day; the monthly copy is due on the 30th, and its own copy on
  the 31st again.
- [ ] `TASK-B15` · **Never stops the series** — On an open copy choose
  **Repeat** → **Never** (`recurrence.never`), then set it to **Done** → The
  repeat icon leaves the card, the trigger reads **Never** in muted text, and
  Activity records **Repeat changed** from the rule to **Never**; closing
  brings back no copy and no toast; the tasks closed earlier keep their locked
  repeat and their **Next task** link, and the one right before the copy no
  longer offers **Stop repeating** (`tasks.repeat.stop.action`), its tooltip
  now **This series has stopped.** (`tasks.repeat.reason.stopped`).
- [ ] `TASK-B16` · **A subtask comes back with its parent, never on its own** —
  On a task that repeats **Daily**, add a subtask (`tasks.detail.addSubtask`),
  add a subtask under it, and open both; add a second subtask, archive it
  (`tasks.actions.archive`) and open it; open a subtask of a task that does not
  repeat; then close the subtasks and the parent → The first subtask names its
  parent (**Part of {task}**, `tasks.detail.partOf`) and its **Repeat** reads
  **With {parent key}** (`tasks.repeat.withParent`) at full contrast: a button
  named **Repeat: With {parent key}** that opens nothing, its tooltip and
  description **This subtask comes back with {parent}: each time {parent}
  repeats, its next task gets a fresh copy of it.**
  (`tasks.repeat.reason.subtask`); the subtask under it, the archived one and
  the subtask of the task that does not repeat have no **Repeat** row; no
  subtask card shows a repeat icon; closing a subtask brings back no copy and
  no toast; the parent's close brings back one next task with fresh copies of
  both levels (`TASK-F41`), while the closed subtasks stay under the closed
  parent.
- [ ] `TASK-B17` · **Handing a repeating task to an automation ends its
  series** — (env-gated: a deployed automation with a task contract bound to
  the project, e.g. a triage pack as in AUTO-F32, so the assignee picker lists
  it under **Automations**, `tasks.assignee.automations`; without one mark
  **ENVIRONMENT**) On a task in **To do** that repeats **Daily**, pick that
  automation as **Assignee** (`tasks.fields.assignee`), then drag its card to
  **Cancelled** (confirm if asked); in **Create task** pick **Daily** under
  **Repeat**, then that automation as **Assignee** → The task's **Repeat**
  reads **Never** and opens nothing, its tooltip **An automation runs this
  task, so it doesn't repeat.** (`tasks.repeat.reason.automation`) — the first
  row inside **More fields** (`tasks.detail.moreFields`) once the task shows
  its automation, else under **Due date** — its card loses the repeat icon, and
  Activity records **Repeat changed** from the rule to **Never**, also after a
  reload; the cancel brings back no copy and no toast; in the dialog **Repeat**
  stays in place but locks, reading **Never** with the same reason, once the
  automation is picked, and the created task's card shows no repeat icon.
- [ ] `TASK-B18` · **A closed task takes no new repeat** — Open a **Done** task
  that never repeated, then set it back to **To do**; in **Create task** pick
  **Daily** under **Repeat**, set **Status** (`tasks.fields.status`) to
  **Done**, then **Cancelled**, then **To do**; pick **Daily** again, set
  **Status** to **Done** and **Create task** → While **Done**, the task's
  **Repeat** reads **Never** and opens nothing, its tooltip **Reopen this task
  to change how it repeats.** (`tasks.repeat.reason.closed`); back in **To do**
  it opens the popover again. In the dialog **Repeat** stays in place but
  locks, reading **Never** with **Only open tasks repeat.**
  (`tasks.repeat.reason.notOpen`), while **Status** is **Done** or
  **Cancelled**, and under **To do** it reads **Never** again, the earlier pick
  dropped; the task created into **Done** carries no repeat — its **Repeat**
  reads **Never** and its card shows no repeat icon — and brings back no copy.
- [ ] `TASK-B19` · **A later start date moves the first due date** — On an open
  task with no **Due date** and a **Start date** a week from today, open
  **Repeat** and pick **Daily**; in **Create task** set **Start date** to a
  coming Saturday, pick **Every weekday** under **Repeat** and **Create task**
  → The popover's **Weekly on** names the start date's weekday, not today's;
  after the pick **Due date** holds the start date, not today, and the change
  saves with no **Start date must be on or before the due date.** toast
  (`tasks.startDate.afterDue`); the dialog fills **Due date** with the Monday
  after that Saturday and creates the task with it; both dates survive a
  reload.
- [ ] `TASK-B20` · **German and French in the create dialog** — Switch the
  language to Deutsch, open **Create task** (`tasks.actions.create`) in a 1280
  px window, set **Due date** (`tasks.dueDate.label`), then set **Repeat**
  (`tasks.repeat.label`) to every 2 weeks on Tuesday and Thursday through
  **Custom**; repeat in French → The side panel is 17rem (272 px) wide and the
  due date reads in full, never clipped; the **Wiederholen** / **Répéter**
  trigger stays on one line — **Alle 2 Wochen** / **Toutes les 2 semaines**,
  the weekday tail dropped whole, a French head too long for the column ending
  in an ellipsis; in the popover the presets (**Jeden Werktag** with **Mo–Fr**,
  **Tous les jours ouvrés** with **lun.–ven.**), the units, the step's words,
  the weekday chips (**Mo Di Mi …** / **Lu Ma Me …**), **Nächste Fälligkeiten**
  / **Prochaines échéances** (`tasks.repeat.nextDueDates`) with dates in the
  language, and the due-date checkbox all fit without horizontal scrolling or
  clipping.
- [ ] `TASK-B21` · **Escape, a click outside and Cancel keep the saved repeat**
  — On a repeating task open **Repeat** → **Custom**, change the unit and the
  step, then press Escape; reopen it, tick **Create the next task on the due
  date** (`tasks.repeat.onDue.label`), then click outside the popover; reopen
  it, change the step in **Custom** and press **Cancel**
  (`common.actions.cancel`); last, on **Year** open the month list and press
  Escape → Each time the popover closes with focus back on the trigger, the
  trigger, its icon and **Next due dates** read the saved rule, and Activity
  gains no **Repeat changed** row, also after a reload; Escape in the month
  list closes only the list, leaving the Custom view open with its draft.
- [ ] `TASK-B22` · **A due-date series stops at 10 open tasks** — On a task
  that repeats **Daily** with **Create the next task on the due date**
  (`tasks.repeat.onDue.label`), set **Due date** to yesterday; each time the
  series' newest task appears, set its **Due date** to yesterday too, until 10
  of its tasks are open; wait ten minutes, then close one of the older ones →
  Each re-dating adds one or two open tasks within ten minutes (the scan runs
  every five), each due today or later; with 10 open the newest due one waits —
  no 11th appears and the backend logs, at most once an hour for that task,
  that its series already has 10 open tasks; within five minutes of the close
  its next task appears.
- [ ] `TASK-B23` · **A repeating task whose due date was cleared** — On a task
  that repeats **Daily**, clear **Due date** (`tasks.dueDate.label`); open
  **Repeat** and click the checked **Daily**; open it again, tick **Create the
  next task on the due date** (`tasks.repeat.onDue.label`) with Space, untick
  it, tick it again and **Save** (`common.actions.save`) → Opened, the popover
  shows no **This task becomes due on {date}.** line
  (`tasks.repeat.becomesDue`), and the checkbox is described by **No due date:
  its next task is dated from the day this one closes.**
  (`tasks.repeat.noDueDateSaved`); clicking **Daily** closes the popover and
  writes nothing — **Due date** stays empty and Activity gains no **Repeat
  changed** row, also after a reload; ticking brings **This task becomes due on
  {date}.** naming today and the description **This one is already due, so the
  next task is created right away.** (`tasks.repeat.onDue.descriptionNow`),
  unticking brings the first description back without the line, and focus stays
  on the checkbox throughout; **Save** writes the rule with today as **Due
  date** and one **Repeat changed** row, also after a reload.
- [ ] `TASK-B24` · **Deleting a task never splits a series** — As an
  organization owner or admin, close a task A that repeats **Daily**, then its
  next task B, which brings back C; **Delete** (`tasks.actions.delete`) B from
  **Details**, reopen A and close it again, then close C; delete the task C
  brought back, then reopen C and close it again; last, let a **Daily** task
  due today with **Create the next task on the due date**
  (`tasks.repeat.onDue.label`) get its next task (as in `TASK-F40`), delete
  that next task, wait ten minutes, then close the first → A's second close
  creates no task and no toast, and while A is open again its **Repeat** stays
  locked, with no **Next task** link and no **Stop repeating**; C keeps the
  repeat icon and its close brings back one next task with the toast; once that
  task is deleted, C's **Repeat** tooltip reads **Its next task was deleted.
  This task cannot repeat again.** (`tasks.repeat.reason.nextDeleted`) with no **Next
  task** link, and reopened, C shows no repeat icon, keeps **Repeat** locked,
  and its second close creates nothing and no toast; once the due-date task's
  next task is deleted, no new one appears while the first stays open and due —
  its card shows no repeat icon, and its **Repeat**, still reading its rule, is
  locked with the same reason — and its close creates nothing and no toast —
  each also after a reload.
- [ ] `TASK-B26` · **A member cannot change someone else's task** — As the
  member, open a task an editor created and assigned to someone else → Its
  title is plain text, **Status** shows a badge without a picker, there is no
  **Archive**, and its card on the board does not drag; the comment box still
  posts, and typing `@` and picking a project agent shows the chip **… won't
  respond — you can't start agents on this task**
  (`tasks.mentionPreview.notPermitted`); after posting, the task keeps its
  status and assignee, also after a reload.
- [ ] `TASK-B27` · **No task in a team project the member cannot see** — As an
  admin, restrict a project to a team the member is not in (**General >
  Sharing**) and copy its board URL; sign in as the member → The project is
  missing from Home's **Projects**, and the copied URL answers **We couldn't
  find that project. It may have been deleted.**
  (`projects.errors.PROJECT_NOT_FOUND`) with no **Create task**.
- [ ] `TASK-B25` · **A reached spend cap refuses the image, not the run** —
  With **Image generation** on, **Start agent** (`tasks.agentRun.start`) on a
  task that asks the agent to research for a minute and then create an image
  for the result; while it researches, add a monthly cost rule on
  `/dashboard/{org}/settings/governance/policies-limits` (**Budget rules**,
  `governance.budgets.title`) that caps the starting member below what they
  have already spent → The agent's `generate_image` call answers
  `unavailable` with `budget_exceeded` and the cap's own sentence ("Usage
  limit reached. Your monthly cost limit is used up until …"), the agent's
  report says no image was generated, no image lands under **Deliverables**
  (`tasks.outputs.label`), and the usage page shows no new request for the
  image model; the run itself still settles. Restore: delete the rule —
  env-gated: mark **ENVIRONMENT** without a runnable harness and an
  image-capable credential.
- [ ] `TASK-B32` · **A failed board read** — DevTools → Network → block the
  request URL `*/api/app/tasks/by-project/*`, open **Board**, then **List**;
  unblock and press **Try again** (`common.actions.tryAgain`) → Once the
  retries settle, an alert **Couldn't load the tasks, so none are shown. Your
  search and filters stay as they are.** (`tasks.read.tasksFailed`) takes the
  lanes' place — never six **No tasks** (`tasks.board.noTasks`); **Filter** and,
  for an editor, **Create task** (`tasks.actions.create`) stay usable; while
  the retry runs the alert reads **Trying again…** (`tasks.read.retrying`), and
  the tasks come back without a reload, the search and filters as they were.
- [ ] `TASK-B33` · **A failed refresh, a failed search** — With the board
  loaded, block `*/api/app/tasks/by-project/*` and rename a task from a second
  session; then type a search; unblock, press **Try again**, and while it runs
  type another search → The tasks stay on screen under **Couldn't refresh the
  tasks. They are shown as they were last loaded.** (`tasks.read.tasksStale`);
  the failed search replaces the rows with the failed-read alert — never the
  unsearched tasks — and the search box keeps the query; the board ends on the
  last search's matches, and a late answer for the earlier one never replaces
  them.
- [ ] `TASK-B30` · **Failed dependencies and activity** — On a project where
  one task blocks another, block `*/api/app/tasks/dependencies/by-project/*`
  and reload; then unblock it, block `*/api/app/tasks/ops-indicators/*`,
  reload, and turn on **Needs my review** (`tasks.review.needsMyReview`) → The
  board stands under a warning **Couldn't load the dependencies, so blocked
  tasks may not be marked as blocked.** (`tasks.read.dependenciesFailed`), and
  its **Try again** brings the **Blocked** (`tasks.detail.blocked`) mark back
  with no new board read in the Network panel; the activity warning
  (`tasks.read.activityFailed`) says **Needs my review** may leave tasks out
  (`tasks.read.activityFailedReviewFilter`) once that filter is on.
- [ ] `TASK-B31` · **Past the board's cap** — Open a project with more than
  2,000 tasks, then search for a task past the first 2,000 → A note **Showing
  the first 2,000 tasks. Search to find the others.** (`tasks.read.truncated`)
  stands above the board; the search finds the task and the note goes.
- [ ] `TASK-B29` · **Moving a live automation's parent task** — (env-gated
  like TASK-B17; without one mark **ENVIRONMENT**) Give two tasks that
  automation owns an open subtask each (`tasks.detail.addSubtask`) and start
  their runs so they work, or wait on a question, at **In progress**; drag the
  first to **Done** (`tasks.status.done`) and confirm the dialog
  (`tasks.subject.cancelConfirmTitle`); drag it again, now between two cards in
  **To do** (`tasks.status.todo`), and confirm; last, on the second, press
  **Cancel run** (`tasks.subject.cancel`) in its automation panel and confirm →
  The move to **Done** is refused with **Finish all subtasks before closing this
  task.** (`tasks.detail.parentCloseGuard`): the card snaps back to **In
  progress** and the run keeps working (its question still takes an answer);
  the move to **To do** toasts **The run was cancelled.** (`tasks.run.cancelled`),
  the card stays where it was dropped, its subtask stays open, and its history
  shows one status change, In progress to To do, never Cancelled in between;
  **Cancel run** is refused with the same sentence and stops nothing — each also
  after a reload, and the same through the **Status** picker
  (`tasks.fields.status`) in German and French.
- [ ] `TASK-B34` · **Automated restarts stop at three an hour** — With the
  manager from `TASK-F53`, have it start, cancel and start the second agent on
  the same task until it has been started three times within the hour, then
  ask for a fourth → the fourth answers `paused` with a time, nothing starts,
  and the task's history shows **Run refused**
  (`tasks.activity.agentRunRefused`): **agent runs are paused on this task**
  (`tasks.agentRuns.refused.task_circuit_breaker`); **Start agent**
  (`tasks.agentRun.start`) pressed by a person still starts it.

- [ ] `TASK-B35` · **A retry is not a failure** — Make a run fail on a
  recoverable fault, such as stopping its sandbox mid-run → while the caption
  reads `tasks.agentRun.autoRetrying`, the task shows no
  `tasks.agentRun.failureTitle` notice and no bell row arrives; only once the
  automatic retries are used up does the notice appear, with **Agent run
  failed** (`inbox.agentRunFailed`) in the starter's bell.
- [ ] `TASK-B36` · **Only people who can still open the project are told** —
  Have a second member watch the member's task (**Watch**,
  `tasks.watch.watch`), remove that member from the organization, then let
  the member's run fail for good (`TASK-F57`) → the member's bell gets
  **Agent run failed** (`inbox.agentRunFailed`); the removed member gets no
  row and no email.
- [ ] `TASK-B37` · **A standard agent that can't run for you says why** —
  Under **Model access**, block every model for the Member role, with the
  standard agent's **Model** on **Automatic**. As the member, open
  **Assignee** (`tasks.fields.assignee`) on a task of theirs in a project
  without agents → it offers no **Standard agent**
  (`tasks.assignee.standardAgent`), and its footer reads
  `tasks.assignee.noAgentsReader`. As the owner, give that task to
  **Standard agent**; as the member, **Start agent** (`tasks.agentRun.start`)
  → the toast `tasks.agentRun.standardAgent.noModel` says to ask an Admin,
  and no run appears under **Activity**. Restore the rule.

## Accessibility (WCAG 2.1 AA)

- [ ] `TASK-A1` · **Keyboard status path** → Every DnD outcome is reachable
  without a pointer: the sheet's status picker (`tasks.fields.status`) is
  keyboard-operable and equivalent to a drag; the drag drop-hints render in a
  `role="status"` region announced to assistive tech.
- [ ] `TASK-A2` · **Sheet dialog** → The task sheet traps focus and closes on
  Escape returning focus to the card; the assignee trigger carries its
  accessible name (**Assign**, `tasks.actions.assign`); form fields are
  labelled (`tasks.fields.*`)
- [ ] `TASK-A3` · **Mentions** → The mention popup is a labelled listbox
  (`tasks.mentionPicker.title`) navigable by arrows/Enter.
- [ ] `TASK-A4` · **Task page structure** → The page has one `h1` naming the
  task, and the editable title's control is named **Title**
  (`tasks.fields.title`); the conversation is a region named
  **Conversation** (`tasks.detail.conversation`); the details panel is an
  `aside` named **Details** (`tasks.detail.details`) that leaves the tab order
  while folded; the details toggle exposes `aria-expanded` and
  `aria-controls`; the round send button is named **Comment**
  (`tasks.actions.comment`); everything is reachable by keyboard in reading
  order, header first.
- [ ] `TASK-A5` · **Due-date calendar inside the task dialog** → Open a task
  (or **Create task**), click **Due date** → the calendar is a
  `role="dialog"` named **Calendar** (`common.datePicker.calendar`) that
  neither it nor any ancestor carries `aria-hidden="true"` (inspect the
  accessibility tree: the month grid, day cells and month buttons are
  listed); before the calendar opens, `document.body` holds no
  `[data-tale-datepicker-popper]` node at all.
- [ ] `TASK-A6` · **Board passes axe; a card is one button** → Run axe
  (wcag2a/aa + wcag21a/aa) on the board with cards that carry an assignee →
  No `aria-valid-attr-value` on the **Board**/**List** tab triggers (they
  carry no `aria-controls`), no `nested-interactive` (a card's title is its
  only button — Tab lands on the title, **Enter** opens the task, **Space**
  lifts it for a keyboard drag, the Priority and Assign buttons are siblings
  beside it and still open their pickers on click), and no
  `aria-prohibited-attr` on the assignee chips (each is a named
  `role="img"`); clicking any blank part of the card still opens the task.
- [ ] `TASK-A7` · **A keyboard drag is spoken by name** — With a screen
  reader on (VoiceOver `Cmd+F5` or NVDA), Tab to an editable task's title on
  **Board**, then on **List**; press **Space**, move with the arrow keys into
  another status and into an empty one, press **Space**; pick it up again and
  press **Escape**; repeat in German and French → On focus the reader speaks
  the title and then the instructions (`tasks.drag.instructions`: Enter
  opens, Space picks up and drops, the arrow keys move, Escape cancels); the
  pickup names the task's key and title with its status and position
  (`tasks.drag.pickedUp`) and is not cut off by a move line; each move speaks
  the status and position (`tasks.drag.over`); the drop
  (`tasks.drag.dropped`) and the cancel (`tasks.drag.cancelled`) name the key;
  no id is ever spoken and focus stays on the title. Note the reader and its
  version: the Chromium specs read the live region's text, not the speech.
- [ ] `TASK-A8` · **Repeat presets by keyboard** → Tab to **Repeat** in the
  task details and open it with Enter; move with the arrow keys and pick with
  Enter; open it again and press Escape; then Tab to a locked **Repeat** (a
  closed task's) → The trigger is a button named **Repeat:**
  (`recurrence.namePrefix`) followed by what it shows, e.g. **Repeat: Never**
  or **Repeat: Weekly, Tue**, and described by the whole sentence and the mode;
  the popover is a dialog named **Repeat** that opens with focus on the checked
  preset; the presets are one radio group named **Presets**
  (`recurrence.presets`) — the arrows move and loop, Home and End jump, and
  moving never saves — then **Custom**, the checkbox and, when shown,
  **Cancel** and **Save** follow in Tab order; Enter or Space saves the focused
  preset and closes, Escape closes with nothing changed, and both times focus
  returns to the trigger without its tooltip popping up; the locked trigger
  stays focusable, is announced as unavailable with its reason, and Enter opens
  nothing; a card's repeat icon is named like its tooltip (**Repeats: {rule}**,
  `tasks.repeat.indicator`).
- [ ] `TASK-A9` · **The Custom view by keyboard** → From the presets Tab to
  **Custom** and press Enter; Tab through the view, switch the unit with the
  arrow keys, type a step, toggle two weekdays with Space and press Enter in
  the step field; reopen **Custom**, change the step, press **Back to presets**
  (`recurrence.back`), enter **Custom** again and press Ctrl+Enter (⌘+Enter on
  a Mac); repeat both saves inside **Create task** (`tasks.actions.create`) →
  Entering puts focus on the checked unit; the view is a group named **Custom**
  (`recurrence.custom`); Tab reaches **Back to presets**, the unit radio group
  named **Unit** (`recurrence.editor.unit`, one stop, ← / →), the step
  spinbutton named as it reads (**Every 2 weeks**), then the weekday chips — a
  group named **On** (`recurrence.editor.onWeekdays`), one stop with roving
  arrows, each a toggle button named by its full weekday that announces its
  pressed state — then the checkbox, **Cancel** and **Save**; the stepper's −
  and + are not Tab stops; a polite status reads the draft's sentence once
  typing pauses, not on every key; Enter in the step field saves and closes,
  **Back to presets** keeps the draft and returns focus to the **Custom** row,
  and Ctrl+Enter / ⌘+Enter saves (**Save** carries `aria-keyshortcuts`); in
  **Create task** neither key submits the dialog.
- [ ] `TASK-A10` · **Repeat on a phone** → At 390 px open a task from Home,
  press **Show details** (`tasks.detail.showDetails`), open **Repeat**, go to
  **Custom** and back, press Escape, then open it again and pick a preset → The
  popover opens over the bottom sheet inside the viewport and scrolls within
  itself when the screen is short; focus stays in it; Escape closes the popover
  only, leaving the sheet open with focus back on the **Repeat** trigger; the
  preset saves, closes the popover and keeps the sheet; every target is at
  least 24 px (preset rows 36, weekday chips 32).
- [ ] `TASK-A11` · **Stop repeating by keyboard** → With a screen reader on,
  open a repeating task from **Board** with Tab and Enter, set **Status**
  (`tasks.fields.status`) to **Done** by keyboard, then Tab on to **Stop
  repeating** (`tasks.repeat.stop.action`) and press Enter; on a second series,
  with the network throttled (DevTools → Network → Slow 4G), press Enter on
  **Stop repeating** and then Tab while it spins → The reader announces the
  toast with its action's alternative text **You can also stop the repeat
  later: open the task and choose "Stop repeating" under "Repeat".**
  (`tasks.repeat.stop.altText`); the button follows the **Next task: {key}**
  link in Tab order, is announced as a button named **Stop repeating**, shows a
  visible focus ring and is at least 24 px tall; Enter stops the series — the
  reader announces **Repeat stopped** (`tasks.repeat.stop.done`) — and the
  button goes, focus landing on the **Repeat** trigger — never on the dialog or
  the page — with its focus ring; the reader announces it as unavailable, and
  once the task refreshes it reads **Repeat: Never** with **This series has
  stopped.** (`tasks.repeat.reason.stopped`) as
  its reason; Tab moves on within the dialog, and Escape still closes it and
  returns focus to the card. On the second series focus stays on the control
  Tab reached, inside the dialog, once the button goes.
- [ ] `TASK-A12` · **Clear a date from the keyboard** — On a task you can edit
  that has a due date, Tab to the date, then once more; press **Enter**; then
  open a task you can only read → The second Tab lands on a button of its own
  beside the date, named **Clear date** (`common.datePicker.clear`), with its
  own focus ring while the field's ring goes out; **Enter** clears the date,
  the ✕ goes away and focus is back on the date button, now **Pick a date**
  (`common.datePicker.placeholder`), with no calendar opening; a screen
  reader names the ✕ in German and French too; the read-only task shows no ✕.
- [ ] `TASK-A13` · **Recover a failed board from the keyboard** — Block
  `*/api/app/tasks/by-project/*`, load **Board** with a screen reader on, Tab
  to **Try again**, unblock and press **Enter**; repeat 390 px wide → The alert
  is announced when it appears; **Try again** is a named button with a visible
  focus ring; while it retries it keeps the focus, marked busy, and the alert
  reads **Trying again…**; when the tasks arrive the focus lands on the board,
  announced as **Board** (`tasks.views.board`), with a visible ring, and
  **Tab** moves on into the first card; 390 px wide the alert and its button
  fit without horizontal scrolling.

- [ ] `TASK-A14` · **The failure notice by keyboard and screen reader** —
  With a screen reader on, open the task from `TASK-F57` → the notice's title
  and sentence are read as one warning; **Tab** reaches **Retry**
  (`tasks.agentRun.retry`) with a visible focus ring, and **Enter** starts the
  agent. In a project with no agent and the standard agent switched off, the
  member's **Assignee** list is followed by its footer,
  `tasks.assignee.noAgentsReader`, read as text rather than skipped as a
  disabled option; with the standard agent on, **Standard agent**
  (`tasks.assignee.standardAgent`) is read as an option with its description,
  and the footer `tasks.assignee.standardAgentFooter` as text.

## Performance

- [ ] `TASK-P1` · **Board first render** → Board or list renders (cards or
  empty lanes) in < 3 s on the mock stack at ~50 tasks.
- [ ] `TASK-P2` · **Drag settle** → A dropped card re-homes optimistically (<
  200 ms perceived) and the persisted status reads back on reload in < 2 s.
- [ ] `TASK-P3` · **A slow task keeps its frame** — Throttle the network
  (DevTools → Network → Slow 4G) and open a task from Home → Before it
  arrives the page already stands: its header (the Home panel toggle, a
  phone's back arrow, **Copy link** and the details toggle all usable), the
  brief card, the composer's frame and the **Details** names (Project,
  Status, Priority …) with pulsing values where the task will land; when it
  arrives nothing moves. Open `…/tasks/board?task={taskId}` the same way →
  the dialog shows the key, the title, the brief and the details masked in
  place, never an empty panel, and no focus ring frames the dialog itself.
- [ ] `TASK-P4` · **A big board keeps its dialog quick** — On a production
  build (see [performance.md](performance.md) Preconditions), in a project
  with 2,000 tasks (the board's cap), record DevTools → Performance while you
  open a task from the board, then close it with **Escape** → Neither the
  click nor the key re-renders the cards (a dev build's React Profiler shows
  the dialog, the route and the Home panel in the commits, never a card).
  Target: the task shows < 1 s after the click, and the close ends with its
  exit animation.
