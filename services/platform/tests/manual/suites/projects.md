# Projects & tasks

> **Prefix** `PROJ-` · **Reset** none · **Cost** 31 boxes

Exercise projects (identity edit, sharing/visibility), their tabs (files,
threads, agents, instructions, secrets, metrics, automations), and the task
board/list (backlog is the leftmost lane) with the task detail sheet and the
cascade-delete confirmation. Mock-LLM stack; no real provider needed for these
flows.

## Scope & routes

Every per-project route below was render-smoked (HTTP 200, no console/page
errors, no error boundary) against a seeded org on 2026-06-23.

| Surface         | Route                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| List            | `/dashboard/{org}/projects`                                                                                               |
| Landing         | `/dashboard/{org}/projects/{projectId}` → redirects to `…/tasks` (Tasks is the default tab)                              |
| General         | `/dashboard/{org}/projects/{projectId}/overview` (identity edit + Sharing live here)                                     |
| Files           | `/dashboard/{org}/projects/{projectId}/files`                                                                             |
| Threads         | `/dashboard/{org}/projects/{projectId}/threads`                                                                           |
| Agents          | `/dashboard/{org}/projects/{projectId}/agents`                                                                            |
| Instructions    | `/dashboard/{org}/projects/{projectId}/instructions` → redirects to General                                              |
| Secrets         | `/dashboard/{org}/projects/{projectId}/secrets`                                                                           |
| Metrics         | `/dashboard/{org}/settings/metrics/projects?project={projectId}` (the one metrics home; linked from the tasks toolbar)    |
| Automations     | `/dashboard/{org}/projects/{projectId}/automations/{automationSlug}` (and `…/automations/{automationSlug}/runs/{execId}`) |
| Tasks (board)   | `/dashboard/{org}/projects/{projectId}/tasks` → redirects to `…/tasks/board`                                              |
| Tasks (list)    | `/dashboard/{org}/projects/{projectId}/tasks/list`                                                                        |
| Tasks (backlog) | `/dashboard/{org}/projects/{projectId}/tasks/backlog` → redirects to `…/tasks/board`                                      |
| Task detail     | `…/tasks/board?task={taskId}` (deep link)                                                                                 |
| Settings (gone) | `…/{projectId}/settings` redirects to General (identity/Sharing merged into General)                                      |

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Create a throwaway
project for the run with the **Create project** action and cascade-delete it
at the end (PROJ-F15). Opening a project lands on **Tasks**; the **General**
tab replaces the old Settings tab: rename + Sharing are in the General body
(with a global **Save** / **Discard** bar), Archive/Delete are in the
projects-list row ⋯ menu.

> **Agent note**: the General identity form uses a GLOBAL save bar, not
> blur-to-save — edit the field, then click **Save** (`common.actions.save`)
> and reload to assert persistence; do not rely on Tab/blur. Cascade delete is
> gated: the destructive submit stays disabled until you type the exact
> project name into the confirmation field.

## Functional tests

- [ ] `PROJ-F1` · **Create project** — `/dashboard/{org}/projects` → **Create
  project** (`projects.list.createButton`) → in the **Create project** dialog
  (`projects.create.title`) fill **Project name**
  (`projects.create.nameLabel`) → **Create project**
  (`projects.create.submit`) → URL settles on
  `/dashboard/{org}/projects/{16+charId}/tasks/board` (Tasks is the default
  tab)
- [ ] `PROJ-F2` · **General rename** — General (`…/{projectId}/overview`) →
  edit **Name** (`projects.settings.name`, id `project-overview-name`) →
  **Save** (`common.actions.save`) → The Save button flashes **Saved**
  (`common.actions.saved`) and settles back to a disabled **Save** — no
  success toast; after reload the Name field rehydrates to the new value.
- [ ] `PROJ-F3` · **Sharing / visibility** — General → **Sharing** section
  (`projects.overview.sharingHeading`) → set **Owning team**
  (`projects.settings.owningTeam`) to a team or **Org-wide**
  (`projects.list.sharingOrgWide`), optionally add teams under **Also shared
  with** (`projects.settings.alsoSharedWith`) → Narrowing access opens a
  confirmation dialog with the warning "This change narrows access…"
  (`projects.settings.sharingNarrowingWarning`) — confirm it; the success
  toast (`projects.settings.saveSuccess`) appears and after reload the
  selected sharing persists.
- [ ] `PROJ-F4` · **Files** — Files tab (rail label **Knowledge**,
  `projects.navigation.files`; page heading **Files**, `projects.files.title`)
  → **Add file** (`projects.files.addButton`) → attach a document; row actions
  **Preview file** (`projects.files.previewAction`) and **Remove from
  project** (`projects.files.detachAction`) → Attach shows toast "Document
  added to project" (`projects.files.attachSuccess`) and the file row is
  visible by name; the row's RAG badge shows **Queued**
  (`projects.files.ragStatusQueued`) then **Failed**
  (`projects.files.ragStatusFailed`) on the hermetic stack (same indexing seam
  as knowledge.md KNOW-F1 — Queued is transient, sub-second: catch it with an
  observer, not by eye; a **Retry indexing** row action appears on Failed);
  **Preview file** opens the document preview; **Remove from project** opens a
  confirmation dialog — confirm it (toast "Document removed from project",
  `projects.files.detachSuccess`) + reload → the row is gone.
- [ ] `PROJ-F5` · **Threads / agents** — Threads tab → **New chat** → send
  `hello`, wait for Send to re-enable; Agents tab (rail label **Agents**,
  `projects.navigation.agents`) → **New agent** (`projects.agents.newAgent`) →
  fill **Name** (`projects.agents.nameLabel`), pick a **Harness**
  (`projects.agents.harnessLabel`) and a **Model**
  (`projects.agents.modelLabel`; a searchable list — type to filter, every
  entry shows the serving provider underneath, and subscription-served entries
  appear only for their own harness), optionally equip **Skills & connectors**
  (`projects.agents.equipmentLabel`) and write **Instructions**
  (`projects.agents.instructionsLabel`) → **Create agent**
  (`projects.agents.createSubmit`) → The new thread is listed in the Threads
  tab after reload; toast "Agent created" (`projects.agents.createSuccess`);
  the agent row (name + harness label + provider + model) persists in the
  Agents tab after reload; **Edit agent** (`projects.agents.rowEdit`) saves
  changes (toast `projects.agents.editSuccess`), **Delete agent**
  (`projects.agents.rowDelete`) confirms in a dialog and removes the row
  (toast `projects.agents.deleteSuccess`)
- [ ] `PROJ-F6` · **Instructions** — Instructions tab
  (`projects.instructions.label`, textbox id `project-instructions`) → edit
  text → save → After reload the Instructions textarea rehydrates the saved
  text.
- [ ] `PROJ-F7` · **Secrets (Environment tab)** — **Environment** tab
  (`projectSecrets.title`) → in the shared env editor add a row: key
  (placeholder `envEditor.keyPlaceholder`), value (placeholder
  `envEditor.valuePlaceholder`), tick **Secret** (`envEditor.secret`) →
  **Add** (`envEditor.add`) → **Save** (`envEditor.save`) → The editor
  confirms the save (`envEditor.saved`); reload → the key row is present with
  its value masked (values are never shown after saving —
  `projectSecrets.description`). The **Available to agents** explainer
  (`projectSecrets.agentAccessTitle`) renders. Non-admin members get the
  access-denied state instead (`projectSecrets.errors.accessDeniedTitle`)
- [ ] `PROJ-F8` · **Metrics** — Metrics tab → The metrics page renders (HTTP
  200, no error boundary); at least one usage stat card is visible (zeros are
  acceptable)
- [ ] `PROJ-F9` · **Create task** — `…/tasks/board` → **Create task**
  (`tasks.actions.create`) → **Title** (`tasks.fields.title`) → **Create
  task** (`tasks.actions.create`, dialog submit) → After reload the task card
  is visible on the board by its title.
- [ ] `PROJ-F10` · **Task fields** — Open a task → **Status**
  (`tasks.fields.status` → **In progress** `tasks.status.in_progress`),
  **Priority** (`tasks.fields.priority` → **High** `tasks.priority.p1`), **Add
  label…** (`tasks.labels.add`) → **Change color**
  (`tasks.labels.changeColor`) → After reload the task shows the updated
  status, priority, and label color.
- [ ] `PROJ-F11` · **Task deep link** — Navigate directly to
  `…/tasks/board?task={taskId}` → The task detail sheet opens for that task
  (its title is visible in the sheet)
- [ ] `PROJ-F12` · **Board ↔ list** — Create/edit a task on `…/tasks/board`,
  then open `…/tasks/list` → The same task title is visible in the list view
  (edit reflected in both views)
- [ ] `PROJ-F13` · **Review flow** — Reviewer designation is hermetic: task
  sheet → **Reviewer** field (`tasks.fields.reviewer`) → pick an editor (only
  editors are listed; the footer hint `tasks.reviewer.editorsOnly` explains) —
  allowed even while a run is live; **Clear reviewer**
  (`tasks.reviewer.clear`) unsets. The pending-review half stays **env-gated**
  (a review is minted when a task-agent run settles into In review; needs a
  stack with a live task-agent runner). With a pending review: the reviewer
  gets a `task_review_requested` bell; the board card shows the **Waiting on
  {name}** chip (`tasks.review.waitingOn`, or `tasks.review.waitingOnYou` for
  yourself); the board's **Review** filter (`tasks.review.filterTitle`) option
  **Needs my review** (`tasks.review.needsMyReview`) reduces the board to
  tasks waiting on you. Decide by status — approve: sidebar **Status**
  (`tasks.fields.status`) → **Done** (`tasks.status.done`), or drag the card
  to **Done**; send back: comment with an **@-mention** of the assignee agent
  → Approve: after reload the task status is **Done** (`tasks.status.done`),
  the status change is attributed to the approving user in Activity, and the
  **Waiting on** chip and the reviewer's bells clear. Send back: the feedback
  appears as YOUR comment on the task, the agent driver re-runs with it, and
  the task leaves In review when the rerun starts — the pending review is
  withdrawn (chip + bells clear) and the next settle asks afresh. Dragging the
  card to any other column also withdraws the request.
- [ ] `PROJ-F14` · **Archive** — Projects list → row ⋯
  (`common.actions.openMenu`) → **Archive**; toggle the archived view;
  **Unarchive** → Archived project leaves the active list and appears under
  archived; unarchive returns it to the active list (survives reload)
- [ ] `PROJ-F15` · **Cascade delete** — Projects list → row ⋯
  (`common.actions.openMenu`) → **Delete** (`projects.rowActions.delete`) → in
  the **Delete project** dialog (`projects.settings.deleteDialogTitle`) tick
  **Also delete attached files…** (`projects.settings.deleteCascadeCheckbox`)
  + type the project name into **Type the project name to confirm**
  (`projects.settings.deleteConfirmPhrase`) → **Delete project**
  (`projects.settings.deleteSubmit`) → The project row is gone from the list
  after the dialog closes and survives a reload; its tasks are also removed.
- [ ] `PROJ-F16` · **List + board basics** — Create a project + task, view
  board & list, then cascade-delete → Mirrors the automated happy path in
  `projects.spec.ts`
- [ ] `PROJ-F17` · **Task attachments** — Mode A: open a task →
  **Attachments** (`tasks.attachments.label`) → **Add attachments**
  (`tasks.attachments.add`) → drop an image + a PDF onto the drop zone "Drop
  images or documents, or click to browse" (`tasks.attachments.dropHint`) →
  **Uploading…** (`tasks.attachments.uploading`) shows, then an attachment
  chip renders per file; after reload both attachments persist on the task;
  **Remove attachment** (`tasks.attachments.remove`) + reload removes the
  attachment.
- [ ] `PROJ-F18` · **Task comments & mentions** — Mode A (an agent actually
  replying is env-dependent — the mock stack may not run the mentioned agent):
  task detail sheet → **Comments** (`tasks.detail.comments`; empty state "No
  comments yet." `tasks.detail.noComments`) → type text containing `@` → the
  mention picker **Mention a member or agent** (`tasks.mentionPicker.title`;
  empty state **No matches** `tasks.mentionPicker.empty`) inserts a handle
  (tip: a query containing a space dismisses the popup — type `@qa`, not `@QA
  Team`; the inserted `@handle` renders as the display name after posting); an
  agent handle shows the preview chip "{slug} will respond"
  (`tasks.mentionPreview.willRespond` — the substitution is the agent's
  **display name**, e.g. "Assistant will respond") or the queued variant
  (`tasks.mentionPreview.willQueue`) → **Comment** (`tasks.actions.comment`) →
  The comment renders in the thread and survives reload; deleting it asks
  **Delete this comment?** (`tasks.comment.deleteConfirm`) and after
  confirming + reload the comment is gone.
- [ ] `PROJ-F19` · **Backlog column** — `…/tasks/board` — precondition: a task
  with status **Backlog** (create via **Create task** → set **Status** →
  **Backlog** `tasks.status.backlog`) → The task appears in the leftmost
  **Backlog** lane on the board and the **Backlog** section on the list — same
  card and detail sheet as other statuses; no **Start** / **Close** row verbs;
  promote it via drag or **Status** → **To do** (`tasks.status.todo`); dismiss
  via **Status** → **Cancelled** (`tasks.status.cancelled`); `…/tasks/backlog`
  redirects to the board.
- [ ] `PROJ-F20` · **Agents: harness & model** — Agents tab → open an agent
  (`projects.agents.rowEdit`) → **Harness** (`projects.agents.harnessLabel`)
  and **Model** (`projects.agents.modelLabel`) pickers → The Harness picker
  lists only harnesses the org can actually run managed (#2902 — e.g. Cursor
  is absent without its own vendor credential); the chosen harness + model
  persist on reload. (The Recommended/Restricted model-access modes were
  retired with the model-access rework.)
- [ ] `PROJ-F21` · **Task agent-run visibility** — Open a task that an agent
  ran (or start one via the task's **Start** — `tasks.agentRun.start`): task
  sheet → run status line (`tasks.agentRun.status`) → **Details**
  (`tasks.run.details`, dialog `tasks.run.detailsTitle`, full page via
  `tasks.run.openFull`) → The run dialog shows the step timeline advancing
  (also on tool-only activity), a live transcript while running, and
  finished-run **Outputs** (`tasks.outputs.label`) as attachments; **Retry**
  (`tasks.agentRun.retry`) and **Cancel** (`tasks.agentRun.cancel`) render per
  state. Timeline rows label the run (`tasks.timeline.runLabel`). Deep
  coverage of the task board/run loop lives in [tasks.md](tasks.md)

## Boundary & error tests

- [ ] `PROJ-B1` · **Empty name** — Create-project dialog → leave **Project
  name** empty → submit → Required validation; submit blocked, dialog stays
  open (NOTE: validation fires on first keystroke — known eager-validation
  quirk)
- [ ] `PROJ-B2` · **Delete gating** — Open Delete dialog, leave the
  confirm-phrase field empty / mismatched → **Delete project** submit stays
  disabled until the typed phrase matches the project name exactly.
- [ ] `PROJ-B3` · **Duplicate secret** — Add two secrets with the same name →
  Second submit rejected with an inline/toast error; only one secret with that
  name persists.
- [ ] `PROJ-B4` · **Empty task title** — Create-task dialog → leave **Title**
  empty → submit → Required validation; task not created (dialog stays open or
  shows the field error)

## Accessibility (WCAG 2.1 AA)

- [ ] `PROJ-A1` · **Board DnD** → A keyboard path exists to move/reorder a
  task (not drag-only)
- [ ] `PROJ-A2` · **Task sheet** → The task detail dialog has an accessible
  name, traps focus, returns focus on close.
- [ ] `PROJ-A3` · **Secret masking** → Stored secret value is masked; the
  reveal control has an accessible name.
- [ ] `PROJ-A4` · **Tabs** → Project tabs (Files/Threads/Agents/…) are
  labelled as a tablist and keyboard reachable.

## Performance

- [ ] `PROJ-P1` · **Project Tasks open** → First paint < 1.5 s (warm route,
  mock stack, local backend)
- [ ] `PROJ-P2` · **Task board render** → < 1.5 s with a seeded project of ≤
  20 tasks (mock stack)
