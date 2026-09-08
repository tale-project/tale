# Automations

> **Prefix** `AUTO-` · **Reset** none · **Cost** 52 boxes

Exercise the draft→deploy→version automation surface: each automation is one
workflow document under a name, with an append-only version history, at most
one **deployed** (live) version, a trigger bound to the name, project
bindings, and a record of every run (mock or live). Tested here: the org list
with its create menu (from a goal, blank, or upload a pack), the detail
workbench (canvas + node inspector + trigger + bindings + versions + runs),
the run-detail page (status, effects, agent log, approval/ask cards), and the
metrics redirect. The Inbox that deployed email-sync packs open has its own
plan: [conversations.md](conversations.md).

## Scope & routes

`{org}` is the 16+ char org id in the dashboard URL. `{slug}` is the
automation document's **name** — lowercase dash-separated segments where `/`
groups folders (e.g. `billing/dunning-reminder`); in a URL every `/` travels
as `__` (`billing__dunning-reminder`, lossless codec in
`lib/automations/slug.ts`). The shipped packs use single-segment names (e.g.
`github-triage-issues`), so their slug and URL segment are identical.
`{runId}` is a plain URL segment — the run routes take **no** search params
(the old `?wf=` is gone; verified in the route files).

| Surface                | Route                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Automations (org list) | `/dashboard/{org}/automations`                                                                         |
| Automation detail      | `/dashboard/{org}/automations/{slug}`                                                                  |
| Run detail             | `/dashboard/{org}/automations/{slug}/runs/{runId}`                                                     |
| Project-scoped list    | `/dashboard/{org}/projects/{projectId}/automations`                                                    |
| Project-scoped detail  | `/dashboard/{org}/projects/{projectId}/automations/{slug}`                                             |
| Project-scoped run     | `/dashboard/{org}/projects/{projectId}/automations/{slug}/runs/{runId}`                                |
| Metrics (redirect)     | `/dashboard/{org}/automations/metrics` → `/dashboard/{org}/settings/metrics/automations` (keeps query) |

> **Route note**: project navigation has **no** Automations tab (tasks are the
> project-side interface) — the project-scoped list/detail are reached by URL
> or through an org-list row: a row bound to exactly one project links into
> that project's shell; org-level and multi-bound rows open the org detail
> page. A run id from another org (or another table) reads as **Run not
> found**, never a leak.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Authoring (the
create menu, node editing, Save version, Deploy, trigger and binding writes,
Run live) is an owner/admin/developer act — the UI gates on the
developer-settings capability, mirroring the backend guard; any other member
sees the list and workbench read-only (no create button, read-only inspector,
no Deploy).

**Seeding.** The builtin packs are provisioned from the builtin catalog
(`configs/platform/custom/automations/` when `TALE_CONFIG_BUILTIN_DIR` is
unset) at org creation and on deploy — and they always arrive as **Not
deployed drafts** (`automations.list.notDeployed`); nothing runs until someone
deploys a version. The eight org-scope packs are `gmail-sync-emails`,
`gmail-triage-inbox`, `outlook-sync-emails`, `outlook-triage-inbox`,
`imap-smtp-sync-emails`, `imap-smtp-triage-inbox`, `github-triage-issues`,
`github-review-pull-requests`. Two catches:

- The SETUP.md **mode A** stack pins `TALE_CONFIG_BUILTIN_DIR` to the e2e
  fixture dir, whose automation fixtures are in the retired pre-rewrite format
  (no pack manifest the loader reads) — a mode-A org therefore seeds **zero**
  packs and the list opens on the empty state. Author or upload your material
  (AUTO-F7–AUTO-F11), or run mode B for the shipped packs.
- An org created before a pack existed is missing it, not hiding it. Seed an
  existing org (idempotent, drafts only, own edits untouched):

  ```bash
  cd services/platform
  bunx convex run provisioning/provision_default_automations:provisionDefaultAutomations \
    '{"organizationId":"<ORG-ID>","orgSlug":"<org-slug>"}'
  ```

**Runs.** A **Test run** (`automations.detail.runMock`) executes the version
on screen against mock connectors — offline, mode A friendly, works on an
undeployed draft. **Run live** (`automations.detail.runLive`) executes the
**deployed** version with real connector calls — mode B with connected
connectors only; rows needing it are marked env-gated. The builder (**From a
goal**) needs an AI provider with an API-key credential
(`automations.builder.noProviders` warns otherwise).

For upload rows, a minimal deterministic pack (any text editor):

```yaml
# workflow.yml
name: qa/manual-probe
description: QA probe — one transform node, no connectors.
nodes:
  - id: greet
    type: transform
    input: { who: 'world' }
    code: 'return { text: "hi " + input.who };'
output:
  text: '{{ nodes.greet.output.text }}'
```

> **Agent note**: run state is Convex-reactive — never poll by reload. A run
> is **terminal** exactly when its status badge reads **Succeeded** /
> **Failed** / **Stopped** (`automations.runs.status.*`); equivalently the
> **Stop the run** button (`automations.runs.cancel`) disappears and a
> **Finished** timestamp (`automations.runs.finishedAt`) renders. **Queued** /
> **Running** / **Waiting** are live — and Waiting can be parked indefinitely
> on a human decision (approval or ask card): decide the card, don't wait it
> out. Verify persisted writes (versions, trigger, bindings) by reload +
> read-back, never by the toast.

## Functional tests

- [ ] `AUTO-F1` · **List renders** — `/dashboard/{org}/automations` → Heading
  **Automations** (`automations.title`); search
  (`automations.list.searchPlaceholder`); with the developer capability a
  **New automation** button (`automations.builder.new`) in the table toolbar;
  rows sorted by name, each showing display name, the raw slug beneath it,
  version-count (`automations.list.versionCount`) and live/not-deployed
  status. Row click opens the editor; the row ⋮ menu offers **Delete**
  (`common.actions.delete`). With zero automations: EmptyState
  (`automations.list.empty.title` + `automations.list.empty.description`)
- [ ] `AUTO-F1b` · **Delete from the list** — List row ⋮ → **Delete**
  (`common.actions.delete`) → confirm (`automations.detail.delete.title`) →
  Confirm names the automation; confirming removes it from the list
  (`automations.detail.delete.done`) without opening the editor. The editor
  header (Test run / Run live / Discard / Save) has no delete control. A live
  run still refuses (`automations.detail.delete.failed`).
- [ ] `AUTO-F2` · **Draft vs live badges** — List rows for one undeployed and
  one deployed automation → Undeployed row: yellow **Not deployed**
  (`automations.list.notDeployed`); deployed row: green **Live: v{n}**
  (`automations.detail.deployedVersion`) — the absence of a deployment IS the
  "drafts only" answer.
- [ ] `AUTO-F3` · **Seed packs into an org** — Run the provisioning command
  (Prerequisites) against an org missing the packs → reload
  `/dashboard/{org}/automations` → The eight org-scope packs appear, every one
  **Not deployed**; re-running the command changes nothing (idempotent); an
  org's own edits/triggers are untouched.
- [ ] `AUTO-F4` · **Row routing** — Click an org-level row, then a row bound
  to exactly one project → Org-level → `/dashboard/{org}/automations/{slug}`;
  single-project-bound →
  `/dashboard/{org}/projects/{projectId}/automations/{slug}` (inside the
  project shell); bound rows carry a blue project-name chip (fallback
  `automations.list.projectBound`)
- [ ] `AUTO-F5` · **Create menu** — **New automation**
  (`automations.builder.new`) → A dropdown with three lanes: **From a goal**
  (`automations.createMenu.fromGoal`), **Blank (trigger + agent)**
  (`automations.createMenu.blank`), and **Upload package**
  (`automations.upload.trigger`); absent entirely without the developer
  capability.
- [ ] `AUTO-F6` · **Builder dialog** — Create menu → **From a goal** → dialog
  **New automation** (`automations.builder.title`) → Fields **Goal**
  (`automations.builder.goalLabel`), **AI provider**
  (`automations.builder.providerLabel`), **Model**
  (`automations.builder.modelLabel`); **Start building**
  (`automations.builder.submit`) disabled until all three are set; with no
  API-key provider a warning (`automations.builder.noProviders`); a sole
  provider/model pre-selects itself.
- [ ] `AUTO-F7` · **Builder run** — (env-gated: real provider) Submit a small
  goal → Progress notice (`automations.builder.running`); saved versions land
  in the list as drafts while it works; on failure
  `automations.builder.failed`, on give-up `automations.builder.gaveUp` /
  `automations.builder.gaveUpNoReason` — never a silent close.
- [ ] `AUTO-F8` · **Upload — yml lane** — Create menu → **Upload package** →
  dialog (`automations.upload.title`) → pick the Prerequisites `workflow.yml`
  in **Package files** (`automations.upload.filesLabel`) → **Upload**
  (`automations.upload.submit`) → The dialog flips to a success panel
  (`automations.upload.successTitle` + `…successNote`) offering **Deploy now**
  (`automations.upload.deployNow`) and **Deploy later**
  (`automations.upload.deployLater`) (#2911). **Deploy later**: after reload
  the list shows `qa/manual-probe` as **Not deployed** with 1 version.
  **Deploy now**: the pack deploys immediately (`automations.upload.deployed`)
  and the list shows it live. An optional manifest (automation.yml) may ride
  along.
- [ ] `AUTO-F9` · **Upload — zip lane** — Zip a whole pack directory (manifest
  + workflow + optional skills/) and upload the single .zip → Zip must travel
  alone (`automations.upload.zipOnly` otherwise, see AUTO-B4); with bundled
  skills a toast summary (`automations.upload.skillsSummary`); validation
  warnings surface as `automations.upload.warnings`; the uploaded version
  stays a draft.
- [ ] `AUTO-F10` · **Upload — skill conflict** — Re-upload a zip whose skills/
  differ from already-installed skills → Conflict panel
  (`automations.upload.skillConflictTitle`) lists them; **Replace**
  (`automations.upload.skillConflictConfirm`) re-runs the upload replacing the
  listed skills; **Keep the existing skills**
  (`automations.upload.skillConflictCancel`) aborts the replacement.
- [ ] `AUTO-F11` · **Upload — install target** — In the upload dialog set
  **Install into** (`automations.upload.targetLabel`) to a project instead of
  **Organization** (`automations.upload.targetOrg`) → upload → The automation
  arrives bound to that project — its detail page's Projects panel shows the
  binding (`automations.bindings.countBadge`), and the list row carries the
  project chip; bindings stay editable afterwards (AUTO-F30)
- [ ] `AUTO-F12` · **Detail workbench renders** —
  `/dashboard/{org}/automations/{slug}` for a seeded pack → Header: display
  name (breadcrumb leaf) on the left with a **Live** badge
  (`automations.versions.deployed`) beside the name when looking === live (no
  version number in the badge). Right: **Version** button
  (`automations.detail.versionSelect`) showing
  `automations.versions.versionLabel`; **Deploy this version**
  (`automations.detail.deployThis`) when looking ≠ live; **Test run**, **Run
  live**, **Discard**, **Save**. Body: canvas + inspector two-column grid of
  viewport height (canvas does not grow with inspector content). With no node
  selected the inspector shows **Trigger** (`automations.trigger.title`) and
  **Projects** (`automations.bindings.title`). **Versions**
  (`automations.versions.title`) and **Runs** (`automations.runs.title`) sit
  below.
- [ ] `AUTO-F13` · **Canvas graph** — On the workbench, inspect the canvas →
  Region labelled **Automation canvas** (`automations.canvas.ariaLabel`); each
  node is a box naming its type and inputs it reads
  (`automations.canvas.readsFrom`); edges carry data/order semantics
  (`automations.canvas.edge.data` / `automations.canvas.edge.control`); a
  versionless/empty document shows `automations.canvas.empty.title`
- [ ] `AUTO-F14` · **Node inspector** — Click a node; **Close**
  (`common.aria.close`); Escape; click the box again; click empty canvas →
  First click opens the node's fields, rings the box, and moves focus into the
  inspector (Tab reaches the fields next; scroll is at the top). **Close**,
  Escape (not while typing in a field), a second click on the same box, and
  empty canvas all restore **Trigger** / **Projects**. Canvas height stays
  put; extra node fields scroll inside the inspector. Inspector heading is the
  node id with a type badge (catalog copy is not dumped into the header).
  Typed fields come first (e.g. **Prompt**), then **Input**
  (`automations.editor.fields.input`); unused **Control flow**
  (`automations.editor.controlFlowTitle`) is a closed disclosure that opens
  when any of When / Else of / For each / Repeat until is set. Read-only
  without the developer capability.
- [ ] `AUTO-F15` · **Edit → Save version** — Change a node field → **Save
  version** (`automations.detail.saveVersion`) → dialog
  (`automations.detail.saveDialog.title`) → enter a **Version message**
  (`automations.detail.saveMessageLabel`) → confirm → Saving APPENDS: the
  Versions panel gains v{n+1} carrying the message; older versions unchanged
  (append-only — reload and read the list back); the canvas now shows the new
  version.
- [ ] `AUTO-F16` · **Version switching** — Header **Version** button
  (`automations.detail.versionSelect`) → an older version; also from a
  **Versions** row label; repeat with unsaved edits on the canvas → Clean: the
  canvas redraws that stored version (header button and selected row both show
  it). Dirty: confirm dialog (`automations.detail.switchVersion.title`) —
  **Discard and switch** (`automations.detail.switchVersion.confirm`) drops
  the draft; Cancel keeps it.
- [ ] `AUTO-F17` · **Deploy** — On a version that is not live (pick it from
  the header **Version** button or click its label in **Versions** if needed)
  → **Deploy this version** (`automations.detail.deployThis`) — tests on that
  version did not fail → The green **Live** badge
  (`automations.versions.deployed`) moves to that version and to the name in
  the header; the **Version** button does not say Live (not `Live: v{n}`);
  versions saved with passing/failing acceptance tests carry
  `automations.versions.testsPassed` / `automations.versions.testsFailed`
  badges — deploying a failed one is refused
  (`automations.versions.deployRefused` alert). **Versions** rows have no
  **Deploy** control.
- [ ] `AUTO-F18` · **Test run (mock)** — On `qa/manual-probe` (undeployed is
  fine) → **Test run** (`automations.detail.runMock`) → A run starts on the
  version on screen; the canvas icon **Show last run** / **Hide last run**
  (`automations.detail.showLastRun` / `automations.detail.hideLastRun`)
  toggles per-node status overlays on the canvas
  (`automations.runs.nodeStatus.*`), and the inspector gains an **In this
  run** section (`automations.editor.runTitle`) with **Resolved input** /
  **Output** (`automations.editor.resolvedInput` /
  `automations.editor.output`)
- [ ] `AUTO-F19` · **Runs panel** — Workbench **Runs** panel after AUTO-F18 →
  The run rows show status badge, version, and starter
  (`automations.runs.startedBy`); an automation that never ran reads
  `automations.runs.empty`; clicking a run row navigates to the run route.
- [ ] `AUTO-F20` · **Run live** — (env-gated: deployed version + live
  connectors) **Run live** (`automations.detail.runLive`) → Confirm dialog
  first (`automations.detail.runLiveTitle` — real connector calls, runs the
  DEPLOYED version once); confirming starts a run whose detail page carries
  the orange **Live** mode badge (`automations.runs.mode.live`)
- [ ] `AUTO-F21` · **Run detail page** —
  `/dashboard/{org}/automations/{slug}/runs/{runId}` → Heading
  `automations.runs.heading` + status badge (`automations.runs.status.*`) +
  mode badge (**Test**, `automations.runs.mode.mock`) + version + **Started**
  (`automations.runs.startedAt`) and, once terminal, **Finished**; read-only
  canvas with per-node statuses beside the read-only inspector; **Run input**
  / **Run output** sections (`automations.runs.inputTitle` /
  `automations.runs.outputTitle`)
- [ ] `AUTO-F22` · **Effects audit** — On a run's detail page, the effects
  section → Section title counts effects (`automations.runs.effects.title`); a
  run that changed nothing outside the platform reads
  `automations.runs.effects.none`; real effects list chronologically with
  their node (`automations.runs.effects.byNode`) and call payload
  (`automations.runs.effects.inputLabel`) — effects are never truncated.
- [ ] `AUTO-F23` · **Agent log** — (env-gated: a run with an agent node) Run
  detail → **Agent log** section (`automations.runs.agentLog.title`) streams
  the sandbox turn; before output `automations.runs.agentLog.starting`; a
  logless run reads `automations.runs.agentLog.empty`; absent entirely for
  runs without an agent node.
- [ ] `AUTO-F24` · **Bounded run log** — Author a transform whose output is
  huge (e.g. a 100 KB string built in code) → Test run → inspect the node **In
  this run** → The run completes and its row persists (the write never dies on
  document size): trace fields are shape-bounded (≈4 KB per string) so
  **Resolved input** shows a truncation marker for the oversized value — while
  the run's **Output** and effects stay complete (they are never cut)
- [ ] `AUTO-F25` · **Approval card** — (env-gated: live run parked on a write
  approval) Open the parked run → Card `automations.runs.approval.title` names
  the operation; **Approve** (`automations.runs.approval.approve`) lets the
  step act on the next poll and the run resumes; **Reject**
  (`automations.runs.approval.reject`) fails the step and the run stops — the
  card disappears once the run is terminal.
- [ ] `AUTO-F26` · **Ask card** — (env-gated: a run parked on an agent
  question) Open the parked run → Card `automations.runs.ask.title` with
  **Your answer** (`automations.runs.ask.answerLabel`); **Send answer &
  resume** (`automations.runs.ask.submit`) resumes the SAME agent session —
  status leaves **Waiting** without reload.
- [ ] `AUTO-F27` · **Trigger — schedule** — Workbench **Trigger** panel on a
  seeded pack (e.g. `github-triage-issues`) → The seeded schedule renders:
  **Kind** (`automations.trigger.kindLabel`) = Schedule, **Cron**
  (`automations.trigger.cronLabel`) + **Timezone**, **Armed**/**Off** badge
  (`automations.trigger.enabledBadge` / `automations.trigger.disabledBadge`);
  edit the cron → **Save trigger** (`automations.trigger.save`) persists on
  reload; an unchanged form disables Save with
  `automations.trigger.nothingToSave`
- [ ] `AUTO-F28` · **Trigger — webhook token** — Switch **Kind** to Webhook →
  **Save trigger** → Token dialog `automations.trigger.tokenTitle` shows the
  token ONCE with its POST path (`automations.trigger.tokenPath`); after
  reload the panel says a token exists (`automations.trigger.hasToken`) and
  offers **Rotate token** (`automations.trigger.rotate`) — rotating mints a
  new one and the old URL stops working.
- [ ] `AUTO-F29` · **Trigger — remove** — **Remove trigger**
  (`automations.trigger.remove`) → confirm (`automations.trigger.removeTitle`)
  → The panel reads `automations.trigger.none` after reload; versions and run
  history untouched.
- [ ] `AUTO-F30` · **Project bindings** — Inspector **Projects** (no node
  selected) → select project(s) → **Save projects**
  (`automations.bindings.save`) → Default badge **Organization-wide**
  (`automations.bindings.orgBadge`) flips to the bound-count badge
  (`automations.bindings.countBadge`) after save + reload; the list row gains
  the project chip; unchanged selection disables Save
  (`automations.bindings.nothingToSave`); a bound project cannot be deleted
  while the binding stands.
- [ ] `AUTO-F31` · **Project-scoped surface** —
  `/dashboard/{org}/projects/{projectId}/automations` then a bound
  automation's detail and one of its runs → The index lists only that
  project's automations inside the project shell; detail and run pages render
  the same workbench/run UI under project chrome; row links and **Open the
  last run** stay inside `/dashboard/{org}/projects/{projectId}/…`
- [ ] `AUTO-F32` · **Task-board integration** — (env-gated: a pack whose
  manifest declares a task contract, e.g. the triage packs, deployed and run)
  Open the automation-created task on the project board → The task modal shows
  the run's step timeline (list labelled `automations.runs.timeline.label`,
  current step badged `automations.runs.timeline.current`) and a settings
  entry opening **{name} — settings** (`automations.settings.dialogTitle`);
  saving valid values toasts `automations.settings.saved` and survives reopen.
- [ ] `AUTO-F33` · **Metrics redirect + page** — Navigate to
  `/dashboard/{org}/automations/metrics?period=7d` → URL is rewritten to
  `/dashboard/{org}/settings/metrics/automations` keeping the query; the page
  renders **Automation metrics** (`analytics.automations.title`) with KPI
  cards (`analytics.automations.cards.totalRuns` …) and charts; with no runs
  in the window: `analytics.automations.empty.title`
- [ ] `AUTO-F34` · **Run retention** — (env-gated, scripted) Settings →
  governance retention: set **Automation run logs**
  (`governance.retentionPolicy.workflowLogs.title`) low, age a TERMINAL run
  past it, let the sweep pass → Only terminal runs expire (a Waiting run
  parked on a human is never touched); the expired run leaves the Runs
  panel/run routes (Run not found after the grace window's hard delete); live
  runs and other orgs unaffected.

## Boundary & error tests

- [ ] `AUTO-B1` · **Unknown automation slug** —
  `/dashboard/{org}/automations/does-not-exist` → EmptyState **Automation not
  found** (`automations.notFound.title` + `automations.notFound.description`);
  no error boundary, no console error.
- [ ] `AUTO-B2` · **Unknown / foreign run id** —
  `/dashboard/{org}/automations/{slug}/runs/<random-or-other-org-id>` →
  EmptyState **Run not found** (`automations.runs.notFound.title`) — an id
  belonging to another org or table reads identically (no existence leak)
- [ ] `AUTO-B3` · **Oversized zip** — Upload a .zip over 20 MiB → Inline
  refusal `automations.upload.zipTooLarge` before any network write; the
  dialog stays open, nothing is stored.
- [ ] `AUTO-B4` · **Zip mixed with files** — In the upload dialog select a
  .zip **plus** any other file → Inline refusal `automations.upload.zipOnly`;
  removing the extra file (its remove control is labelled via
  `automations.upload.removeFile`) clears the refusal.
- [ ] `AUTO-B5` · **Run live undeployed** — Workbench of an automation with
  versions but no deployment → hover/inspect **Run live** → The button is
  disabled with reason `automations.detail.runLiveNeedsDeploy`; no dialog, no
  run row appears.
- [ ] `AUTO-B6` · **Invalid JSON in a node** — In the inspector, type `{ not
  json` into the **Input** field → Notice `automations.editor.invalidJson`;
  the node is NOT changed (no dirty state from the invalid text; Save version
  keeps the last valid document)

## Run liveness — chaos recovery (backend, scripted)

Proves on a real backend that a parked run whose scheduled wakes are all lost
is revived by the liveness sweep — the "Running now forever" incident class
(#2883). Drive it via `bunx convex run … --url http://127.0.0.1:3210
--admin-key <key>` (admin key in the platform service's local Convex config);
the chaos door `testing/e2e_chaos:severRunWakes` refuses unless the deployment
sets `TALE_E2E=1` or `TALE_CHAOS_DOORS=1`. Executed end-to-end 2026-07-31 on
the dev stack (cadence froze after sever, sweep poked once, cadence resumed).
- [ ] `AUTO-L1` · **Healthy park cadence** — Set `TALE_CHAOS_DOORS=1` →
  save+deploy a probe (one transform, repeat-until that never ends, capped
  repeats) → start a live run → read its cursor twice ~8 s apart → Status
  **Waiting**; the poll pass counter advances ~1 per 5–6 s.
- [ ] `AUTO-L2` · **Sever = the incident** — `testing/e2e_chaos:severRunWakes`
  for the run → observe ≥ 20 s → Exactly ONE pending wake existed and is
  cancelled; the pass counter freezes; status stays **Waiting** — the wedged
  state.
- [ ] `AUTO-L3` · **Sweep revives** — Sever again rewinding the wake past the
  grace window → run `automations/triggers:enforceRunLiveness` → observe ~20 s
  → The sweep logs the re-poke and returns `poked: 1`; the pass counter
  resumes advancing.
- [ ] `AUTO-L4` · **Event-poke edge** — (optional) Park a live run on a real
  approval, sever, then decide the approval in the UI (AUTO-F25) → The
  decision itself resumes the run immediately — no sweep needed.
- [ ] `AUTO-L5` · **Cleanup** — Cancel the probe run → remove
  `TALE_CHAOS_DOORS` → Run **Stopped**; the chaos door refuses again.

## Accessibility (WCAG 2.1 AA)

- [ ] `AUTO-A1` · **Canvas semantics** → The canvas is a labelled region
  (**Automation canvas**, `automations.canvas.ariaLabel`); every node box is a
  real `<button>` that is keyboard reachable and expands/controls the
  inspector (`aria-expanded` / `aria-controls`). Enter/Space toggles the
  inspector; Escape closes it (not while typing); **Close**
  (`common.aria.close`) is in the panel. Selection never needs a mouse.
- [ ] `AUTO-A2` · **Status not by colour** → Run and node status badges each
  carry an icon AND a word (`automations.runs.status.*`,
  `automations.runs.nodeStatus.*`); the timeline's icon-only variant keeps the
  status word for screen readers (role img + label)
- [ ] `AUTO-A3` · **List and menus** → List rows are links with visible focus
  rings and accessible names; the **Create automation** menu and every panel
  action (Deploy, Save trigger, Save projects) are keyboard operable, with
  disabled reasons exposed, not silent.
- [ ] `AUTO-A4` · **Dialogs** → Builder / upload / save-version / run-live
  dialogs: labelled fields (label ↔ control), focus trapped, Escape closes —
  except while a save is in flight, when close waits exactly like Cancel.

## Performance

- [ ] `AUTO-P1` · **List first render** → Rows or EmptyState visible < 1.5 s
  after navigation (local stack)
- [ ] `AUTO-P2` · **Workbench interaction** → Canvas + panels visible < 2 s on
  a seeded pack; node select → inspector update and live run-status overlays
  feel instant (< 100 ms, no layout jank while a run streams)
