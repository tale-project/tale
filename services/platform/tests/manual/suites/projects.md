# Projects & tasks

> **Prefix** `PROJ-` · **Reset** none · **Cost** 63 boxes

Exercise projects (identity edit, sharing/visibility), their tabs (files,
threads, agents, instructions, secrets, metrics, automations), the task
board/list (backlog is the leftmost lane) with the task detail sheet and the
cascade-delete confirmation, and the **Projects** section of the Home panel —
the doors into every project, beside every Home route. Projects have no rail
tile of their own: they live in Home. Mock-LLM stack; no real provider needed
for these flows.

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
- [ ] `PROJ-F3` · **Sharing / visibility** — General → **Audience**
  (`projects.settings.audience`) → pick one or more teams, or clear the
  selection for **Org-wide** (`projects.list.sharingOrgWide`) → Narrowing
  access (organization-wide to some teams, or dropping a team) opens the
  **Sharing** confirmation (`projects.overview.sharingHeading`) warning "This
  change narrows access…" (`projects.settings.sharingNarrowingWarning`) —
  confirm it; widening saves at once. The success toast
  (`projects.settings.saveSuccess`) appears and after reload the audience
  persists. With project readback delayed after a successful addition, keep
  the picker open and add another team → both additions remain selected and
  persist; removing either saved team still asks for confirmation. A member
  who cannot administer the project sees the read-only
  **Effective audience** (`projects.sharing.effectiveAudience`) instead.
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
  label…** (`tasks.labels.add`) → type a new name → **Create "{name}"**
  (`tasks.labels.createNamed`) → After reload the task shows the updated
  status, priority, and the label with its dot — the colour derives from the
  label's name, there is no colour picker.
- [ ] `PROJ-F11` · **Task deep link** — Navigate directly to
  `…/tasks/board?task={taskId}` → The task detail sheet opens for that task
  (its title is visible in the sheet)
- [ ] `PROJ-F12` · **Board ↔ list** — Create/edit a task on `…/tasks/board`,
  then open `…/tasks/list` → The same task title is visible in the list view
  (edit reflected in both views)
- [ ] `PROJ-F13` · **Review a task as a person** — In a project whose **Default reviewer** (`projects.taskReview.defaultReviewer`) is **Person** (`projects.taskReview.humanDefault`), use **Reviewer** (`tasks.fields.reviewer`) to choose an eligible editor; **Project default · person** (`tasks.reviewer.projectDefaultHuman`) restores inheritance → the chosen value survives reload. For a pending human review, the reviewer receives **Review requested** (`inbox.taskReviewRequested`), the card names them with **Waiting on {name}** (`tasks.review.waitingOn`), and **Needs my review** (`tasks.review.needsMyReview`) keeps the task for them. Accept via **Status** → **Done** (`tasks.status.done`) → after reload, Activity attributes the status change to the person and the pending chip and unread request clear. In a separate pending review, post feedback with an authorized **@mention** of the assigned agent → the person's feedback appears, a rework run starts, and the old pending review is withdrawn; the next settled run asks afresh. The live rework half requires a configured local runner.
- [ ] `PROJ-F32` · **Hand a waiting review to someone else** — Two sessions,
  A and B, both project editors; the project default is **Person**
  (`projects.taskReview.humanDefault`). As the OWNER, set a task's **Reviewer**
  (`tasks.fields.reviewer`) to A and move it to **In review**
  (`tasks.status.in_review`) — reaching the column opens the review, no agent
  run needed — then, while A's **Review requested**
  (`inbox.taskReviewRequested`) bell is still unread, pick B as **Reviewer** →
  B's bell gets **Review requested** with your name in its text
  (`inbox.taskReviewRequestedByBody`), not the **You're the reviewer**
  heads-up (`inbox.taskReviewerAssigned`), and A's stops ringing; the card's
  chip reads **Waiting on you** (`tasks.review.waitingOnYou`) on B's board
  and **Waiting on {name}** naming B (`tasks.review.waitingOn`) on A's, and
  **Needs my review** (`tasks.review.needsMyReview`) keeps the card for B and
  drops it for A — both boards follow without a reload. Choose **Project
  default · person** (`tasks.reviewer.projectDefaultHuman`) → the chip names the task creator (you: **Waiting
  on you**) and B's request bell clears.
- [ ] `PROJ-F33` · **Change the reviewer before review** — Two sessions, A
  and B, both project editors, with the project default set to **Person**
  (`projects.taskReview.humanDefault`). As the OWNER, on a task in **To do**
  (`tasks.status.todo`) set **Reviewer** (`tasks.fields.reviewer`) to A → A's
  bell shows an unread **You're the reviewer** (`inbox.taskReviewerAssigned`);
  pick B as **Reviewer** → A's heads-up turns read and A's unread count drops
  without a reload, while B's bell shows the heads-up unread; **Project
  default · person** (`tasks.reviewer.projectDefaultHuman`) → B's heads-up turns read too.
- [ ] `PROJ-F34` · **An erased reviewer's waiting review moves on** — As the
  OWNER, with the project default set to **Person**
  (`projects.taskReview.humanDefault`), create a task (you are its creator), set **Reviewer**
  (`tasks.fields.reviewer`) to editor A and move the task to **In review**
  (`tasks.status.in_review`); then at
  `/dashboard/{org}/settings/governance/data-subject-requests` with a zero
  cooling-off window, **File request**
  (`governance.dataSubjectRequests.actions.fileRequest`) against A and wait
  for the receipt to complete → On the board the card's chip reads **Waiting
  on you** (`tasks.review.waitingOnYou`), never an unknown name, **Needs my
  review** (`tasks.review.needsMyReview`) keeps the card for you, the task's
  **Reviewer** reads **Project default · person**
  (`tasks.reviewer.projectDefaultHuman`), and your bell
  holds **Review requested** (`inbox.taskReviewRequested`) reading
  "… is ready for your review" (`inbox.taskReviewRequestedBodyHuman`).
- [ ] `PROJ-F14` · **Archive** — Projects list → row ⋯
  (`common.actions.openMenu`) → **Archive**; toggle the archived view;
  **Unarchive** → Archived project leaves the active list and appears under
  archived; unarchive returns it to the active list (survives reload)
- [ ] `PROJ-F22` · **Archived project says so on every tab** — Archive a
  project, then open it and walk its tabs (Overview, Chats, Tasks, Knowledge,
  Agents) → An **Archived** badge (`projects.archived.badge`) sits beside the
  project name in the breadcrumb on every tab, and stays legible in dark mode
  and at 400px. Unarchive → the badge is gone. Previously an archived project
  announced itself only in the Projects list, so a retired project looked live
  from inside.
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

- [ ] `PROJ-F23` · **Audience in the list** — With an org-wide project, one
  scoped to two teams and one scoped to three → The **Sharing** column
  (`projects.list.columnSharing`) reads `projects.list.sharingOrgWide` with a
  globe for the first, one team NAME (never an id) in a chip plus `+1`
  (`projects.list.sharingMoreTeams`) for the second, and one name plus `+2`
  for the third with every name in the cell's title; the cell is the one the
  documents list's **Teams** column uses (KNOW-F21), so the glyph and the text
  beside it sit on the same offset on both screens; the column's filter offers
  `projects.list.sharingOrgWide`, **My teams** (`projects.list.filterMyTeams`,
  only for a caller in ≥1 team) and each team by name, lands in the URL as
  `?teams=…` and survives a reload.
- [ ] `PROJ-F24` · **Audience on create and on General** — **New project** →
  **Who can see it** (`projects.create.audienceLabel`, help
  `projects.create.audienceHelp`) as a non-admin editor in team A and as an
  owner; then on the project's **General** page the **Audience** field
  (`projects.settings.audience`) → The editor's picker lists only their own
  teams, the owner's every team of the org; a project created for A is hidden
  from a member outside A (404 on its URL) and visible to the owner; removing
  a team on **General** asks for confirmation that members outside the
  remaining teams lose access before it saves; clearing every team makes the
  row read `projects.list.sharingOrgWide`.
- [ ] `PROJ-F28` · **Projects in the Home panel** — With four projects, one
  pinned, open the Home panel's **All** view and click a project row → The
  **Projects** section (`home.projects.title`) lists every project you can
  see, the pinned one first and the rest A→Z, each with its avatar; the row
  opens `/dashboard/{org}/projects/{projectId}` and stays marked current
  (`aria-current="page"`) while you are anywhere in that project; **All
  projects** (`home.projects.allProjects`) opens `/dashboard/{org}/projects`;
  **New project** (`home.projects.newProject`) opens the **Create project**
  dialog (`projects.create.title`), and the new project joins the section
  without a reload. The section's header collapses it (the count shows beside
  the title) and the choice survives a reload; a member of no project reads
  **No projects yet** (`home.projects.empty`); only the Inbox view hides the
  section.
- [ ] `PROJ-F26` · **A project row's menu** — Hover a project row and open
  **Actions for {project}** (`home.projects.actions`) → **New chat**
  (`chat.newChat`) opens a fresh composer bound to that project
  (`/chat?projectId=…`), whose first message files the chat under the project
  (its row and header then name the project); **Pin project**
  (`chat.pinProject`) lifts it to the top of the section with a pin mark and
  survives a reload, and **Unpin project** (`chat.unpinProject`) puts it back
  in A→Z order.
- [ ] `PROJ-F27` · **The Chats tab lists chats the way Home does** — Open a
  project's **Chats** tab (`projects.navigation.threads`,
  `/dashboard/{org}/projects/{projectId}/threads`) holding chats of yours and
  one another member shared with the project; click a row beside its title,
  then flip a row's **Share with project** switch
  (`projects.threads.shareToggle`) → Under **Your chats**
  (`projects.threads.yourChats`) each row shows the speech-bubble glyph, its
  title — **Untitled chat** (`home.row.untitledChat`) for one without, never
  its id — and how long ago it last moved; under **Shared with project**
  (`projects.threads.sharedWithProject`) the row adds its author's name. A
  click anywhere on a row opens `/dashboard/{org}/chat/{threadId}`, while the
  switch changes the sharing without opening the chat; **New chat**
  (`projects.overview.newChatCta`) carries the pencil Home's **New chat**
  wears.
- [ ] `PROJ-F31` · **A project member reads a chat shared with the project**
  — Two sessions. As the OWNER, in a project chat with a reply, open the
  first message's **Edit message** (`chat.editMessage`), change its text and
  send (the row now reads ‹2/2›), then flip the chat's **Share with project**
  switch (`projects.threads.shareToggle`) on the project's **Chats** tab. As
  ANOTHER member of the project, open that row under **Shared with project**
  (`projects.threads.sharedWithProject`) → `/dashboard/{org}/chat/{threadId}`
  shows **Shared with the project — read-only** (`chat.readOnlyShared`)
  above the messages — the EDITED message and its reply, never the original
  and never the empty **What are we working on?** (`chat.welcomeEmpty`); a
  reply offers Copy and message info only (no rating, no **Edit message**,
  no **Fork chat** (`chat.forkChat`), no **Try again** (`chat.tryAgain`), no
  version arrows); the message box is disabled; the conversation menu
  offers **Export** (`chat.export.button`) but no **Share**
  (`chat.share.button`). Owner flips the switch off → the reader's reload
  reads **This chat is not available.** (`chat.notFound`).

- [ ] `PROJ-F25` · **A failed list read is an error, not an empty list** — In
  DevTools, block `GET /api/app/projects/overview` (or answer it 500) and
  open `/dashboard/{org}/projects` → After the retries the table shows the
  error state **Something went wrong** with **Try again**
  (`common.errors.somethingWentWrong`, `common.errors.tryAgain`) — never
  **"No projects yet"** for an organization that has projects. Unblock the
  request and click **Try again** → the rows appear without navigating away;
  alternatively switch tabs and back → the list refetches on its own.

- [ ] `PROJ-F29` · **Icon and color on create and on General** — **Create
  project** → **Icon and color** (`projects.identity.label`) → **Change icon
  and color** (`projects.identity.trigger`) → pick a color and an icon →
  create; then on the project's **General** page the same row → pick another
  pair → **Save** → The popover is named **Icon and color** and holds two
  radio groups, **Color** (`projects.identity.colorLabel`, 19 swatches) and
  **Icon** (`projects.identity.iconLabel`, 30 icons); the trigger's avatar
  previews the pair live; the new project's row in the Projects list and its
  folder in the chat sidebar show the picked icon on the picked color; on
  General the Save cluster wakes on a pick, **Discard** restores the saved
  pair, **Save** flashes **Saved** and the list/sidebar follow; a project
  never touched keeps the gray folder.

- [ ] `PROJ-F30` · **Deleting an agent unassigns its tasks** — Agents tab →
  create an agent, assign it two tasks and start one so a run exists (it
  may fail); then row menu → **Delete agent** → confirm → Both tasks read
  **Unassigned** in the Assignee field and on their cards (never the raw
  agent id); each task's Activity shows **Assignee changed** from **Deleted
  agent** (`tasks.timeline.deletedAgent`) to nobody, and the run's earlier
  Activity/comments keep the **Deleted agent** label; the task's **Run**
  strip still offers **Details** but no **Retry**/**Start agent**; a stale
  tab that still shows the agent and clicks **Retry** gets **The assigned
  agent no longer exists…** (`tasks.agentRun.agentMissing`); assigning a
  person or another agent brings the verbs back.
- [ ] `PROJ-F35` · **New agents start with the document skills** — Agents tab
  with all four document skills available → **New agent** → open **Skills,
  connectors & tools** (`projects.agents.equipmentLabel`) → `docx`, `pptx`,
  `xlsx` and `pdf` are already ticked and no other skill, connector or tool
  is; untick `pdf`, fill the required fields and create the agent → its row
  counts three skills, and reopening it shows `pdf` unticked. Editing an
  existing agent leaves its equipment exactly as saved. (The catalog
  lifecycle cases are automated: see `reference/automation.md`.)

- [ ] `PROJ-F36` · **A member reads the Agents tab** — With the
  organization's standard agent switched off ([governance.md](governance.md)
  `GOV-F52`), as a member of a project with no agent, open **Agents**
  (`projects.navigation.agents`) → the
  header reads `projects.agents.sectionDescriptionReader`, there is no **New
  agent** (`projects.agents.newAgent`), and the empty state reads
  `projects.agents.emptyReaderTitle` above `projects.agents.emptyReaderBody`;
  an editor of the same project sees `projects.agents.emptyTitle` and **New
  agent**.
- [ ] `PROJ-F37` · **The standard agent on the Agents tab** — With the
  standard agent on (the default), open **Agents** in a project without
  agents of its own → the empty state reads
  `projects.agents.standard.emptyTitle` above
  `projects.agents.standard.emptyBody` for an editor, who also gets **New
  agent** (`projects.agents.newAgent`), and above
  `projects.agents.standard.emptyReaderBody` for a member. Give one of its
  tasks to **Standard agent** ([tasks.md](tasks.md) `TASK-F61`) and return →
  one row, named `projects.agents.standard.name` in the organization's
  default language, carries the badge **Standard**
  (`projects.agents.standard.badge`) and the note
  `projects.agents.standard.managedNote`, names its agent type, provider and
  model, counts the document skills available to the project, and offers
  **Delete agent** (`projects.agents.rowDelete`) but no **Edit agent**
  (`projects.agents.rowEdit`).
- [ ] `PROJ-F38` · **The standard agent gives way to the project's own** —
  **Delete agent** on the standard agent's row and confirm → the row leaves,
  the standard empty state returns, and the tasks it worked keep their
  history; giving a task to **Standard agent** again sets up a new one. Now
  add an agent with **New agent** and delete the standard agent → **Assignee**
  (`tasks.fields.assignee`) in this project lists only the project's own
  agents and no **Standard agent**.

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
- [ ] `PROJ-B5` · **Mixed upload names the skipped file** — Files tab →
  **Add file** → select three supported files plus one unsupported (e.g.
  `.bin`) in ONE pick → No error toast flashes before the upload; once it
  settles a single toast reads **3 of 4 files added**
  (`projects.files.attachPartial`) with **Skipped: ‹name› — ‹reason›**
  (`projects.files.skippedList`, the unsupported-format sentence) and stays
  until dismissed; the three files appear in the tree. Picking the `.bin`
  alone still shows the destructive **Unsupported file type** toast; a pick
  with no refusal reads **Document added to project · 4 / 4**.
- [ ] `PROJ-B6` · **Archived project is read-only everywhere** — Open a
  project's Agents, Tasks and Files tabs in a second tab, then on
  **General** → **Archive** → confirm → In the fresh tabs every write
  control is gone: no **New agent**, no **Create task**, no **Add file** /
  folder actions, the task dialog's fields are read-only, and General shows
  the **This project is archived** banner
  (`projects.readOnlyBanner.archivedTitle`) above a read-only summary with
  **Restore** (`projects.rowActions.restore`) still offered and the Sharing
  section read-only; in the STALE tabs submit **New agent**, **Create task**
  and a file drop → each is refused with **This project is archived.
  Restore it to make changes.** (`projects.errors.PROJECT_ARCHIVED`; the
  task one reads `tasks.errors.PROJECT_ARCHIVED`), never the generic
  "Couldn't save the agent"; **Restore** brings every control back.
- [ ] `PROJ-B7` · **Archived project refuses the leftover writes too** —
  Same setup as `PROJ-B6` with a file, a task and an automation bound to
  the project; in the STALE tabs: the file's row menu → **Delete** and
  **Detach from project**, a comment on the task, and — under
  `/dashboard/{org}/automations/{name}` → **Projects** — adding the archived
  project, plus **Run** with that project selected → each is refused with
  the archived-project sentence (backend `PROJECT_ARCHIVED` 403), the file
  stays in the project, no comment lands, the binding and run list are
  unchanged; **Restore** → every one of them goes through.
- [ ] `PROJ-B8` · **Archived project's Secrets are read-only** — As an
  admin open the project's **Secrets** tab in a second tab, archive the
  project on **General**, then reload the Secrets tab → the **This project
  is archived** banner (`projects.readOnlyBanner.archivedTitle`) sits above
  the list, the stored names still read, and **Add variable**, every name
  field and every row's remove control are disabled; in the STALE tab
  **Add variable** → NAME + value → **Save** is refused with the
  archived-project sentence (backend `PROJECT_ARCHIVED` 403) and nothing
  lands; **Restore** → the same save goes through.
- [ ] `PROJ-B9` · **Only eligible people can be human reviewers** — On an org-wide project with a Member, and on a team-restricted project with an editor outside its teams, open **Reviewer** (`tasks.fields.reviewer`) → neither person is offered, and the footer explains human edit access and independent agent permission (`tasks.reviewer.routingHint`). In one session keep eligible editor E in the open picker; in another remove E from the project's team, then choose E in the first session → one localized refusal (`tasks.reviewer.invalid`) appears, the existing reviewer survives reload, and E receives no review request. The typed route's authorization and forged identifiers are covered by the automated review-routing suite.
- [ ] `PROJ-B13` · **Only granted agents can be agent reviewers** — On a project with two agents, one of them without **Review other agents’ task results** (`projects.agents.tool.task_review`), open **Reviewer** (`tasks.fields.reviewer`) on a task → the ungranted agent is listed but greyed and its description names the missing permission (`tasks.reviewer.agentPermissionRequired`), while the granted agent stays selectable. Make the ungranted agent the project's **Default reviewer** (`projects.taskReview.defaultReviewer`) → the **Project default** choice is greyed with the same description. In one session keep the granted agent in the open picker; in another revoke its grant on the Agents tab, then choose it in the first session → one localized refusal names the permission (`tasks.reviewer.agentPermissionRequired`), the existing reviewer survives reload, and no review moves.
- [ ] `PROJ-B10` · **A folder read that fails keeps the files** — On a
  project with a root file, a folder and a file inside it, block
  `*/api/app/folders?projectId=*` in DevTools and reload its Files tab →
  after the retries one notice above the tree
  (`projects.files.foldersLoadFailed`) with **Try again**; the root file
  stays in place and the nested file is listed under **Files inside
  folders** (`projects.files.unplacedGroup`), never an empty list or
  **Add files for this project** (`projects.files.emptyTitle`); unblock →
  **Try again** → the folder returns with the file inside it, and Network
  shows no second `documents/by-project` read. Blocking
  `*/api/app/documents/by-project/*` instead → the folders stay and the
  notice reads `projects.files.loadFailed`; both blocked →
  `projects.files.treeLoadFailed`. No toast.
- [ ] `PROJ-B11` · **A Member is offered no project create** — Sign in as a
  Member and open the Home panel, then `/dashboard/{org}/projects` → the
  **Projects** section header offers **All projects** but no **New project**
  (`home.projects.newProject`), and the list has no **Create project**
  (`projects.list.createButton`); with no project shared with them the list
  reads **A project appears here once someone shares it with you or one of
  your teams.** (`projects.list.emptyReaderDescription`). As an Editor both
  doors are back. The server refuses a create below the Editor role.
- [ ] `PROJ-B14` · **A secrets read that fails is not an empty Environment** —
  As a project administrator with one stored secret, block
  `*/api/app/projects/*/secrets*` in DevTools (Network → request blocking)
  and reload the project's **Environment** tab (`projectSecrets.title`) →
  after the retries (a few seconds) an alert reads **Couldn't load this
  project's secrets.** (`projectSecrets.errors.loadFailed`) with **Try
  again** (`common.actions.tryAgain`), and there is no editor: no **Add
  variable** (`envEditor.add`), no **Save** (`envEditor.save`), never the
  empty list a project without secrets shows. A screen reader announces the
  alert; **Try again** pressed while still blocked stays focused (busy) and
  announces the failure again. Unblock → **Try again** → the stored
  secret's row returns without a reload and the focus lands on the
  **Environment** group. Network shows no write in either state.

- [ ] `PROJ-A1` · **Board DnD** → A keyboard path exists to move/reorder a
  task (not drag-only)
- [ ] `PROJ-A2` · **Task sheet** → The task detail dialog has an accessible
  name, traps focus, returns focus on close.
- [ ] `PROJ-A3` · **Secret masking** → Stored secret value is masked; the
  reveal control has an accessible name.
- [ ] `PROJ-A4` · **Tabs** → Project tabs (Files/Threads/Agents/…) are
  labelled as a tablist and keyboard reachable.
- [ ] `PROJ-A5` · **Files list passes axe, keyboard-walkable** → On the
  Files tab with a folder holding a file, run axe → no
  `aria-required-children` (the list is a plain `list` named **Project
  files**, `projects.files.treeLabel`, with no `tree`/`treeitem` roles; each
  row is a button beside its Preview / Version history / Remove / menu
  buttons); Tab into the list, **↓/↑** move between rows, **→** expands a
  folder (`aria-expanded`), the selected folder reads `aria-current="true"`;
  the same holds for an automation's **Uploads** settings tree.
- [ ] `PROJ-A6` · **Projects rows open by keyboard** → On the Projects list,
  Tab through a row → the stops are **Select row**, the project **name**
  (a link, visible focus ring, `href` ending in
  `/projects/<id>/tasks`), then **Open menu**; **Enter** on the name opens
  the project's tasks, exactly like a pointer click on the row; the row
  click still works and does not navigate twice when the name itself is
  clicked.
- [ ] `PROJ-A7` · **Sharing reads like Project** → On General
  (`…/{projectId}/overview`) as an owner of a project in an org with teams,
  in light and in dark: the **Audience** row (`projects.settings.audience`,
  help `projects.settings.audienceHelp`) under **Sharing**
  (`projects.overview.sharingHeading`) has the shape of the **Name** row
  (`projects.settings.name`) — label and help on the left, the picker's left
  and right edges on the Name field's, the Name row's vertical padding — and
  one hairline separates the Sharing section from the section above it; Tab
  to the picker with a screen reader on: it is announced as **Audience**
  followed by its help (an empty audience means everyone in the
  organization), and **Name** and **Description**
  (`projects.settings.description`) are announced with their hints the same
  way; as a member who
  cannot administer it, **Effective audience**
  (`projects.sharing.effectiveAudience`) is a row of the same shape with the
  team names on the right; in an org with no teams the Audience row carries
  **No teams yet.** (`projects.sharing.noTeamsHint`) and **Create a team**
  (`projects.sharing.noTeamsCreateLink`) on the right. The **Instructions**
  textarea (`projects.instructions.label`) is labelled by its section header
  alone, with its counter under it.
- [ ] `PROJ-A8` · **Files retry from the keyboard** → In the `PROJ-B10`
  state, Tab reaches **Try again**; Enter runs it and focus moves to the
  **Files** group above the tree — never to the page body; a screen reader
  announces the notice once per failure and reads **Files inside folders**
  as the name of the nested list; ↓/↑ still walk every row, those in the
  group included. With focus on **Try again** (not pressed), a background
  refresh that fails again leaves it there; one that works moves it to the
  **Files** group.

## Performance

- [ ] `PROJ-P1` · **Project Tasks open** → First paint < 1.5 s (warm route,
  mock stack, local backend)
- [ ] `PROJ-P2` · **Task board render** → < 1.5 s with a seeded project of ≤
  20 tasks (mock stack)

## Default task reviewer

- [ ] `PROJ-F39` · **Save a default without taking over waiting reviews** — As an editor, open `/dashboard/{org}/projects/{projectId}/overview` → **Task reviews** (`projects.taskReview.title`) → **Default reviewer** (`projects.taskReview.defaultReviewer`), choose project agent B, save, and reload → B remains selected. An existing pending review keeps the person named in **Current review** (`tasks.reviewer.pendingFor`); a later review on a task using **Project default** (`tasks.reviewer.projectDefaultLabel`) names B. Neither saving nor reloading starts B or grants **Review other agents’ task results** (`projects.agents.tool.task_review`).
- [ ] `PROJ-B12` · **Keep the review default safe across concurrent saves** — Open the project's General tab in two editor sessions, edit the default in both, and save B in the first → the second save refuses with the localized stale-draft message (`projects.taskReview.stale`), and reloading still shows B. Discard the stale draft, choose another default and save; then make and save a second change after the first save's live update → both deliberate later choices persist, without an unexpected stale warning or lost draft.
