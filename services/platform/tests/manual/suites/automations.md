# Automations

> **Prefix** `AUTO-` · **Reset** none · **Cost** 246 boxes

Exercise the draft→deploy→version automation surface: each automation is one
workflow document under a name, with an append-only version history, at most
one **deployed** (live) version, a trigger bound to the name, project
bindings, and a record of every run (mock or live). Tested here: the org list
with its create menu (blank or upload a pack), the detail page's tabs —
**Editor** (canvas + node inspector), **General** (trigger + project
bindings), **Runs** and **Versions** (what is live, every version and
deployment, one-click deploy and rollback, restore) — the run-detail page (status, effects,
agent log, approval/ask cards), and the metrics redirect. The Inbox that deployed email-sync packs open has its own
plan: [conversations.md](conversations.md).

## Scope & routes

`{org}` is the 16+ char org id in the dashboard URL. `{slug}` is the
automation document's **name** — lowercase dash-separated segments where `/`
groups folders (e.g. `billing/dunning-reminder`); in a URL every `/` travels
as `__` (`billing__dunning-reminder`, lossless codec in
`lib/automations/slug.ts`). The shipped packs use single-segment names (e.g.
`github-triage-issues`), so their slug and URL segment are identical.
`{runId}` is a plain URL segment — a run's page takes **no** search params
(the old `?wf=` is gone; verified in the route files); the comparison takes
the two runs as `?a={runId}&b={runId}`.

| Surface                   | Route                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Automations (org list)    | `/dashboard/{org}/automations`                                                                                                               |
| Automation detail (alias) | `/dashboard/{org}/automations/{slug}` → forwards to `…/{slug}/editor`                                                                        |
| Editor tab (default)      | `/dashboard/{org}/automations/{slug}/editor` — `?version={n}` pins a stored version on the canvas                                            |
| General tab               | `/dashboard/{org}/automations/{slug}/general`                                                                                                |
| Versions tab              | `/dashboard/{org}/automations/{slug}/versions` — `?tab=deployments` shows the deployments                                                  |
| Version comparison        | `/dashboard/{org}/automations/{slug}/versions/{n}` — `?from={m}` compares with v{m} (default the version before), `?view=graph\|changes\|yaml`, `?node={id}` |
| Runs tab                  | `/dashboard/{org}/automations/{slug}/runs`                                                                                                   |
| Run detail                | `/dashboard/{org}/automations/{slug}/runs/{runId}`                                                                                           |
| Compare runs              | `/dashboard/{org}/automations/{slug}/runs/compare?a={runId}&b={runId}`                                                                       |
| Project-scoped list       | `/dashboard/{org}/projects/{projectId}/automations`                                                                                          |
| Project-scoped detail     | `/dashboard/{org}/projects/{projectId}/automations/{slug}` → forwards to `…/{slug}/editor`; carries the same four tabs            |
| Project-scoped run        | `/dashboard/{org}/projects/{projectId}/automations/{slug}/runs/{runId}`                                                                      |
| Project-scoped compare    | `/dashboard/{org}/projects/{projectId}/automations/{slug}/runs/compare?a={runId}&b={runId}`                                                  |
| Metrics (redirect)        | `/dashboard/{org}/automations/metrics` → `/dashboard/{org}/settings/metrics/automations` (keeps query)                                       |

> **Route note**: project navigation shows an Automations tab only once
> something is bound to that project (tasks stay the project-side interface)
> — otherwise the project-scoped list/detail are reached by URL or through an
> org-list row: a row bound to exactly one project links into that project's
> shell; org-level and multi-bound rows open the org detail page. The bare
> detail URL is an alias that forwards to the Editor tab, exactly like a bare
> project URL forwards to Tasks. A run id from another org (or another table)
> reads as **Run not found**, never a leak.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Authoring (the
create menu, node editing, Save version, Deploy, trigger and binding writes,
Run live) is an owner/admin/developer act — the UI gates on the
developer-settings capability, mirroring the backend guard; any other member
has no Automations navigation. Member and Editor seats work a task's run
through its task panel (`AUTO-F53`, `AUTO-B11`).

**Seeding.** Nothing seeds automations: a new organization starts with
**no** automation, so the list opens on its empty state, and `tale migrate`
adds none and changes none an organization has (PROVN-R9, PROVN-R10).
The shipped packs live in the builtin catalog
(`configs/platform/custom/automations/` when `TALE_CONFIG_BUILTIN_DIR` is
unset) and reach an organization only when someone adds one from the
template catalog, or zips its folder and uploads it (AUTO-F9). The eight
org-scope packs are `gmail-sync-emails`, `gmail-triage-inbox`,
`outlook-sync-emails`, `outlook-triage-inbox`, `imap-smtp-sync-emails`,
`imap-smtp-triage-inbox`, `github-triage-issues`,
`github-review-pull-requests`. An organization an earlier release created
may still hold them, as that release's provisioning left them. One catch:

- The SETUP.md **mode A** stack pins `TALE_CONFIG_BUILTIN_DIR` to the e2e
  fixture dir, whose automation fixtures are in the retired pre-rewrite format
  (no pack manifest the loader reads). Author or upload your material
  (AUTO-F8–AUTO-F11), or run mode B for the shipped packs.

**Runs.** A **Test run** (`automations.detail.runMock`) executes the version
on screen against mock connectors — offline, mode A friendly, works on an
undeployed draft. **Run live** (`automations.detail.runLive`) executes the
**deployed** version with real connector calls — mode B with connected
connectors only; rows needing it are marked env-gated.

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

For the canvas boxes (`AUTO-F73`), a branch probe whose condition hangs
**Yes** and **No** from one pill:

```yaml
# workflow.yml
name: qa/branch-probe
description: QA probe — a condition with an alternative, no connectors.
nodes:
  - id: score
    type: transform
    input: { total: 1200 }
    code: 'return { total: input.total };'
  - id: escalate
    type: transform
    when: '{{ nodes.score.output.total > 1000 }}'
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "escalate " + input.total };'
  - id: file
    type: transform
    elseOf: escalate
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "file " + input.total };'
output:
  text: '{{ nodes.escalate.output?.text ?? nodes.file.output?.text }}'
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
      **Automations** (`automations.title`) in a title row that ends in the page
      divider above the table toolbar (the same line the Projects list draws);
      search (`automations.list.searchPlaceholder`); with the developer
      capability a **Create automation** button (`automations.list.createButton`)
      in the table toolbar; rows sorted by name, each showing display name, the raw slug beneath it,
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
- [ ] `AUTO-F181` · **Trigger beside the live version** — With five
      automations on the org list — one deployed with its schedule
      **Enabled**, one whose schedule paused itself (`AUTO-F52`), one
      deployed with its webhook switched off, one not deployed with its
      event trigger on, and one deployed with no trigger → **Trigger**
      (`automations.list.columnTrigger`) reads beside an unchanged **Status**,
      each state over its kind (`automations.list.trigger.*` over
      `automations.trigger.kinds.*`): green **Enabled**, yellow **Paused**,
      neutral **Off**, neutral **Not live** next to **Not deployed**, and
      neutral **Manual** over `automations.list.trigger.manualHow`, whose
      row still opens and runs by hand. Nothing in the column is a control.
      With a second tab on the paused automation's General tab, turn
      **Enabled** on and **Save** → the first tab's row reads **Enabled**
      without a reload; leave it failing until it pauses again → **Paused**,
      again without a reload.
- [ ] `AUTO-F3` · **~~Seed packs into an org~~ (retired)** → Provisioning
      seeds no pack any more: a new organization starts with no automation and
      `tale migrate` adds none (PROVN-R9, PROVN-R10); add a shipped pack
      from the template catalog, or upload it (AUTO-F9).
- [ ] `AUTO-F4` · **Row routing** — Click an org-level row, then a row bound
      to exactly one project → Org-level →
      `/dashboard/{org}/automations/{slug}/editor`; single-project-bound →
      `/dashboard/{org}/projects/{projectId}/automations/{slug}/editor` (inside
      the project shell) — a row opens the Editor tab directly, the way a
      project row opens Tasks; bound rows carry a blue project-name chip
      (fallback `automations.list.projectBound`)
- [ ] `AUTO-F5` · **Create menu** — **Create automation**
      (`automations.list.createButton`) on the org and project lists → A dropdown
      with four lanes, in this order: **From a template**
      (`automations.createMenu.template`), **With your coding agent**
      (`automations.createMenu.withAgent`, `AUTO-F183`), **Blank (trigger +
      agent)** (`automations.createMenu.blank`), and **Upload package**
      (`automations.upload.trigger`); absent entirely without the developer
      capability.
- [ ] `AUTO-F6` · **~~Builder dialog~~ (retired)** → The independent goal-based
      creation entry was removed; use the two create lanes in AUTO-F5.
- [ ] `AUTO-F7` · **~~Builder run~~ (retired)** → The standalone builder session
      endpoint was removed; editor and MCP authoring remain available.
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
  - workflow + optional skills/) and upload the single .zip → Zip must travel
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
      arrives bound to that project — its **General** tab's **Projects** section
      shows the binding (`automations.bindings.countBadge`), and the list row carries the
      project chip; bindings stay editable afterwards (AUTO-F30)
- [ ] `AUTO-F12` · **Detail workbench renders** —
      `/dashboard/{org}/automations/{slug}` for a shipped pack → The URL lands on
      `…/{slug}/editor`. Title row: display name (breadcrumb leaf) on the left
      with a **Live** badge (`automations.versions.deployed`) beside the name
      when looking === live (no version number in the badge); the row draws no
      divider of its own — the tab strip under it carries the line, exactly as
      a project detail. Tab strip (`common.aria.automationsNavigation`):
      **Editor** / **General** / **Runs**
      (`automations.navigation.editor` / `automations.navigation.general` /
      `automations.navigation.runs`), Editor
      active; at its right end the **Version** button
      (`automations.detail.versionSelect`) showing
      `automations.versions.versionLabel`, **Deploy v**_n_
      (`automations.detail.deployVersion`) when looking ≠ live, **Test run**, **Run
      live**, **Discard**, **Save** — nothing sits in the title row's right
      half. Body: the canvas alone fills the tab edge to edge under the strip
      — with no node selected there is no inspector column at all (AUTO-F37;
      a selected node's inspector does not grow the canvas). Its top left
      holds the view switch (`automations.canvas.view.label`: **Canvas**,
      **List**, **Source**); its top right the paths button
      (`automations.paths.button`), the last-run eye once the automation has
      run (`automations.detail.hideLastRun`) and, last, **Edit with your
      coding agent** (`automations.codingAgent.button`); the zoom controls
      and **Legend** (`flow.controls.legend`) sit bottom left. The
      trigger and the project bindings are the **General** tab (AUTO-F51),
      version history in the picker and executions in Runs (AUTO-F35) — none of them panels
      beside or under the canvas.
- [ ] `AUTO-F13` · **Canvas graph** — On the workbench of
      `github-triage-issues`, inspect the canvas → a group labelled
      **Automation canvas** (`automations.canvas.ariaLabel`), laid out by
      itself: **Start** (`flow.node.entry`) on top, **End**
      (`flow.node.exit`) at the bottom, every node below the nodes it reads.
      Each node box shows its icon, a title from its ID, its catalog line,
      what it returns once known and what it reads in its strip
      (`flow.list.reads`, else `automations.canvas.readsNothing`); Score
      sits in a frame headed by `automations.canvas.controlFlow.forEach`.
      **Legend** (`flow.controls.legend`) opens `flow.legend.title` with
      every line and box kind (`automations.canvas.legend.*`); a version with
      no nodes shows `automations.canvas.empty.title` with **Edit with your
      coding agent** as its action.
- [ ] `AUTO-F14` · **Node inspector** — Click a node; **Close**
      (`common.aria.close`); Escape; click the box again; click empty canvas →
      First click opens the node's fields, rings the box, and moves focus into the
      inspector (Tab reaches the fields next; scroll is at the top). **Close**,
      Escape (not while typing in a field), a second click on the same box, and
      empty canvas all close the inspector and hand its width back to the
      canvas. A box near the canvas's right edge that the opening inspector
      would cover pans back into view. Canvas height stays
      put; extra node fields scroll inside the inspector. The header reads the
      node's title, its catalog line and its ID with **Copy node ID**
      (`automations.editor.inspector.copyId`); **When it runs**
      (`automations.editor.flow.title`) follows, then the tabs **Fields**,
      **Shape** and, while a run is shown, **Last run**
      (`automations.editor.inspector.tabs.*`). Typed fields come first (e.g.
      **Prompt**), then **Input** (`automations.editor.fields.input`); unused
      **Control flow** (`automations.editor.controlFlowTitle`) is a closed
      disclosure that opens when any of When / Else of / For each / Repeat
      until / Maximum repeats / On error is set. The URL carries
      `?node=<id>`. Read-only without the developer capability.
- [ ] `AUTO-F15` · **Edit → Save version** — Change a node field → **Save
      version** (`automations.detail.saveVersion`) → dialog
      (`automations.detail.saveDialog.title`) → enter a **Version message**
      (`automations.detail.saveMessageLabel`) → confirm → Saving APPENDS: the
      URL drops any `?version=`, the canvas shows the new version, and the
      **Version** popup lists v{n+1} carrying the message; older versions
      unchanged (append-only — reload and read the list back).
- [ ] `AUTO-F16` · **Version switching** — The strip's **Version** button
      (`automations.detail.versionSelect`) → an older version; also from a
      **Version** popup row; repeat with unsaved edits on the canvas → Clean: the
      canvas redraws that stored version, the URL carries `?version={n}` and
      the **Version** button shows it (AUTO-F36). Dirty, from the picker:
      confirm dialog (`automations.detail.switchVersion.title`) — **Discard and
      switch** (`automations.detail.switchVersion.confirm`) drops the draft;
      Cancel keeps it. Leaving the editor for another tab still uses the shared unsaved-changes dialog.
- [ ] `AUTO-F17` · **Deploy** — On a version that is not live (pick it from
      the **Version** button, or open it from a **Version** popup row)
      → **Deploy v**_n_ (`automations.detail.deployVersion`) — tests on that
      version did not fail → The green **Live** badge
      (`automations.versions.deployed`) moves to that version and to the name in
      the header; the **Version** button does not say Live (not `Live: v{n}`);
      versions saved with passing/failing acceptance tests carry
      `automations.versions.testsPassed` / `automations.versions.testsFailed`
      badges — deploying a failed one is refused in a dialog
      (`automations.deploy.refused.title`) that offers only Close, and a
      version that fails today's checks gets the
      `automations.versions.deployRefused` alert with Problems open. Version
      history rows have no **Deploy** control.
- [ ] `AUTO-F18` · **Test run (mock)** — On `qa/manual-probe` (undeployed is
  fine) → **Test run** (`automations.detail.runMock`); when the saved version declares inputs, fill **Run input (JSON)** (`automations.detail.runInput.label`) using **Input schema** (`automations.detail.runInput.schema`) — missing required fields and invalid JSON keep confirmation disabled → A run starts on the
  version on screen; the canvas shows it at once, each node's strip saying
  how it ended (`flow.state.*`), and the eye at the canvas's top right,
  **Hide last run** / **Show last run** (`automations.detail.hideLastRun` /
  `automations.detail.showLastRun`), takes it off and back; the inspector
  gains the **Last run** tab (`automations.editor.inspector.tabs.run`) with
  **Resolved input** / **Output** (`automations.editor.resolvedInput` /
  `automations.editor.output`)
- [ ] `AUTO-F19` · **Runs tab** — **Runs** tab (`automations.navigation.runs`)
      after AUTO-F18 → `…/{slug}/runs` lists the runs newest first under the
      heading (`automations.runs.title` + `automations.runs.description`): each
      row shows status badge, mode, version, and starter in words
      (`automations.runs.starter.you` for your own runs — never a raw
      `user:<id>`); an automation that never ran reads
      `automations.runs.empty`; clicking a run row navigates to the run route,
      where the strip stays and **Runs** remains the active tab.
- [ ] `AUTO-F20` · **Run live** — (env-gated: deployed version + live
  connectors) **Run live** (`automations.detail.runLive`) → Confirm dialog
  first (`automations.detail.runLiveTitle` — real connector calls, runs the
  DEPLOYED version once); input uses the deployed version’s schema, even when the canvas shows another version; cancelling starts nothing; confirming starts a run whose detail page carries
  the orange **Live** mode badge (`automations.runs.mode.live`)
- [ ] `AUTO-F21` · **Run detail page** —
      `/dashboard/{org}/automations/{slug}/runs/{runId}` → Under the same
      breadcrumb + tab strip (**Runs** active; the name crumb returns to the
      Editor): heading `automations.runs.heading` + status badge (`automations.runs.status.*`) +
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
      step act right away and the run resumes; **Reject**
      (`automations.runs.approval.reject`) fails the step and the run stops — the
      card disappears once the run is terminal.
- [ ] `AUTO-F26` · **Ask card** — (env-gated: a run parked on an agent
  question) Open the parked run → Card `automations.runs.ask.title` with
  **Your answer** (`automations.runs.ask.answerLabel`); **Send answer &
  resume** (`automations.runs.ask.submit`) resumes the SAME agent session —
  status leaves **Waiting** without reload.
- [ ] `AUTO-F27` · **Trigger — schedule** — Open the **General** tab's
  **Trigger** section on an automation with a schedule → **Trigger type**
  (`automations.trigger.kindLabel`) is Schedule; the schedule picker
  (`automations.trigger.schedule.label`, or **Cron**
  `automations.trigger.cronLabel` under **Cron (advanced)** for a cron no
  repeat rule says), **Timezone**, **Missed runs**
  (`automations.trigger.catchUp.label`) and the **Enabled** switch
  (`automations.trigger.enabledLabel`) reflect the stored trigger. Edit the
  schedule → the **General** tab's unsaved dot lights, and **Save**
  (`common.actions.save`) in the strip persists it on reload; an unchanged form
  leaves **Save** and **Discard** (`common.actions.discard`) disabled.
- [ ] `AUTO-F28` · **Trigger — webhook token** — Switch **Trigger type** to
  Webhook → **Save** → The warning
  `automations.trigger.tokenTitle` shows the full webhook URL once. After
  reload the **Webhook endpoint** section
  (`automations.trigger.webhookEndpointLabel`) lists the URL with its token
  masked and says it was shown once
  (`automations.trigger.webhook.tokenHiddenHint`). **Rotate token**
  (`automations.trigger.rotate`) reveals a new URL and the old URL stops
  working.
- [ ] `AUTO-F29` · **Trigger — remove** — **Remove trigger**
      (`automations.trigger.remove`, at the right of the **Trigger** section's
      title) → confirm (`automations.trigger.removeTitle`) → The section reads
      `automations.trigger.none` with an **Add trigger** button
      (`automations.trigger.add`) — no Trigger type, Cron or Enabled switch is
      drawn, and **Save** stays disabled (nothing is left as an unsaved edit) —
      immediately and after reload; versions and run history untouched.
- [ ] `AUTO-F30` · **Project bindings** — **General** tab → **Projects** →
  select project(s) → **Save** (`common.actions.save`) → The bound-count badge
  (`automations.bindings.countBadge`) shows the saved number after reload;
  an empty selection shows no count badge and keeps the scope hint
  (`automations.bindings.hint`). The list row gains the project chip;
  unchanged settings leave **Save** disabled;
  a bound project cannot be deleted while the binding stands.
- [ ] `AUTO-F31` · **Project-scoped surface** —
      `/dashboard/{org}/projects/{projectId}/automations` then a bound
      automation's detail and one of its runs → The index lists only that
      project's automations inside the project shell; the detail carries the
      same **Editor** / **General** / **Runs** strip and the run
      page the same run UI under the Automations chrome; every tab, row and run
      link stays inside `/dashboard/{org}/projects/{projectId}/…`
- [ ] `AUTO-F32` · **Task-board integration** — (env-gated: a pack whose
      manifest declares a task contract, e.g. the triage packs, deployed and run)
      Open the automation-created task on the project board → The task modal shows
      the run's step timeline (list labelled `automations.runs.timeline.label`,
      current step badged `automations.runs.timeline.current`) and a settings
      entry opening **{name} — settings** (`automations.settings.dialogTitle`);
      saving valid values toasts `automations.settings.saved` and survives reopen.
      Signed in as a Member who works the task, the entry is absent: saving
      writes the project's files, which stay with the project's editors.
- [ ] `AUTO-F69` · **A long settings description reads short first** —
  (env-gated: a pack whose settings form carries a `description` of five or
  more sentences, such as the package catalog guide's
  `validation-policy.yaml` form with one added) In **Create task** on a
  project that is not set up yet, choose the pack's template beside **Blank
  task** (`tasks.template.blank`); after setup, open the task's settings
  entry (**{name} — settings**, `automations.settings.dialogTitle`) → In the
  setup step (`tasks.template.setupIntro`) and in the dialog, the description
  above the fields shows three lines ending in an ellipsis, with **Read
  more** (`common.actions.readMore`) under it; pressing it shows the whole
  text and turns into **Show less** (`common.actions.showLess`). Neither
  press saves anything or leaves the step: no `automations.settings.saved`
  toast, and **Save and continue** (`automations.settings.saveAndContinue`)
  still waits. A two-line description shows no button; at 390 px wide a
  description that fit before clamps and gains the button.
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
- [ ] `AUTO-F35` · **Detail tabs** — Open any automation, then walk the tab
      strip (`common.aria.automationsNavigation`) → The bare
      `/dashboard/{org}/automations/{slug}` forwards to `…/{slug}/editor`;
      **Editor** (`automations.navigation.editor`) is the canvas workbench;
      **General** (`automations.navigation.general`) →
      `/dashboard/{org}/automations/{slug}/general` carries the trigger and the
      project bindings (AUTO-F51);
      the **Version** button at the right opens history with messages, dates,
      test results and the **Live** badge, newest first. **Runs**
      (`automations.navigation.runs`) →
      `/dashboard/{org}/automations/{slug}/runs`; **Versions**
      (`automations.navigation.versions`) →
      `/dashboard/{org}/automations/{slug}/versions` (AUTO-F139), with no
      **Version** button beside it; the active tab carries the
      underline and `aria-current="page"`; the action cluster (Deploy
      / Test run / Run live / Discard / Save) shows on the Editor tab only; Version remains on every other tab, and
      **General** shows **Discard** / **Save** alone; the
      breadcrumb switcher opens the same tab on the sibling automation (a run
      page switches to the sibling's Runs list); the project-scoped detail
      carries the identical strip.
- [ ] `AUTO-F36` · **Version deep link** — In the **Version** popup click an
      older version's row → URL `…/{slug}/editor?version={n}`, the **Version**
      button reads v{n}, the canvas draws that version; a shared link with the
      same `?version=` opens the same picture; `?version=abc` opens the latest
      instead of erroring; after **Save version** the URL loses `?version=` and
      the canvas shows the new latest.
- [ ] `AUTO-F37` · **The Editor runs edge to edge** — On the **Editor** tab
      at a desktop width, select a node, then measure the workbench (DevTools,
      or the console one-liner below) → Every gap reads **0px**: the canvas
      starts right under the tab strip and at the page's left edge, draws no
      border of its own, and meets the inspector at the inspector's left
      border; the
      inspector ends at the window's right and bottom edges (a classic
      scrollbar's reserved gutter aside). A refused run or deploy shows its
      alert in a padded band above the workbench. The Automations list, the
      **General** tab and a run's page keep the even 16px inset, and switching
      tabs moves nothing up or down.

      ```js
      const canvas = document.querySelector('main .grid > :first-child');
      const panel = document.querySelector('main .grid > :last-child');
      const strip = document.querySelector('main nav[aria-label]:last-of-type');
      const c = canvas.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      [
        c.top - strip.getBoundingClientRect().bottom,
        p.left - c.right,
        innerWidth - p.right,
        innerHeight - c.bottom,
        innerHeight - p.bottom,
      ];
      ```

- [ ] `AUTO-F38` · **The mobile dock still clears the last control** — At
      phone width on the **General** tab, and on the **Editor** tab with a node
      selected, scroll the page to its end → The last control (the **Projects**
      picker; the node's last field) sits clear ABOVE the floating action dock
      (**Discard** / **Save**), not under it; the dock's own row is fully
      readable. Repeat on **Settings > Account** and on a project's Tasks
      board, which reserve the same clearance.
- [ ] `AUTO-F39` · **Starters and waiting reasons read as words** — Start a
      Test run yourself, let a schedule or webhook start one, park a live run
      on an approval (AUTO-F25) and start a `repeatUntil` polling run → On the
      **Runs** tab and in the run header: your run reads
      `automations.runs.starter.you`, another member's run names that member,
      an API-key start carries "(API)" (`automations.runs.starter.apiKey`), a
      scheduled run reads `automations.runs.starter.schedule` and a webhook
      delivery `automations.runs.starter.webhook` — the two are told apart;
      the waiting rows read `automations.runs.waiting.approval` /
      `automations.runs.waiting.repeat` (naming the step), never
      `approval:<uuid>` or `repeat:tick`; a failed run's row and header keep
      its failure sentence; a succeeded run's row shows its starter only.
- [ ] `AUTO-F40` · **One cron validator** — In the **General** tab's **Trigger**
      section on a schedule, pick **Cron (advanced)**
      (`automations.trigger.schedule.formatCron`) and type a four-field cron
      (`*/1 * * *`), then a six-field one and `0 9 * * MON` → Each shows the
      refusal with the validator's own sentence under the field
      (`automations.trigger.cronInvalidReason`, e.g. "got 4"); **Next runs**
      lists nothing and reads `automations.trigger.nextRuns.unavailable`;
      **Save** in the tab strip stays disabled; nothing is sent to the
      server. A five-field cron restores the list, and one a repeat rule says
      reads `automations.trigger.schedule.cronReadsAs`.
- [ ] `AUTO-F41` · **Blank wizard validates the schedule before creating** —
      **Create automation** › **Blank** › step 2 with **Schedule** → The
      schedule picker shows the default daily 09:00 in your time zone, with
      three runs under `automations.trigger.nextRuns.wouldRun`; **Timezone**
      is a searchable picker (`automations.trigger.timezoneSearch`), not free
      text. Switch to **Cron (advanced)** and type
      `61 * * * *`, then `0 0 31 2 *`, then `*/1 * * *` → each shows the
      refusal under the field (`automations.trigger.cronInvalidReason`) and
      **Create automation** is disabled with that reason — no automation is
      created (the list is unchanged, no `automations.blank.triggerFailed` toast).
- [ ] `AUTO-F42` · **Blank wizard keeps the typed name** — **Blank** wizard,
      Name `Eval-D agent 测试 🚀` → the field reads `Saved as: eval-d-agent`
      (`automations.blank.slugHint`); after **Create automation** the editor
      header, breadcrumb and list row show **Eval-D agent 测试 🚀** while the
      URL carries `eval-d-agent`. Name `发票提醒` → `Saved as:
      automation-<8 hex>`, **Next** enabled, the created automation is titled
      `发票提醒`. Save a new version from the canvas (no presentation of its
      own) → the list still shows the typed name, never "Automation ‹hex›".
- [ ] `AUTO-F43` · **Deep link to a missing version** — Open an existing
      automation's editor with `?version=99` → The breadcrumb and tab strip
      stay; the editor area reads `automations.editor.versionNotFound.title`
      ("Version 99 doesn't exist") with **Open latest**
      (`automations.editor.versionNotFound.openLatest`), never
      `automations.notFound.title`; **Open latest** drops `?version=` and
      draws the latest version. `?version=abc` and `?version=0` still open
      the latest directly (AUTO-F36); an unknown slug still shows
      `automations.notFound.title`.
- [ ] `AUTO-F44` · **A schedule says what it will do** — On a deployed
      automation with an enabled schedule, **Next runs**
      (`automations.trigger.nextRuns.title`) lists five runs in the
      schedule's zone. Switch **Enabled** off → the heading reads
      `automations.trigger.nextRuns.wouldRun` and the line under it
      `automations.trigger.nextRuns.paused`, before and after **Save** +
      reload. Open a not-deployed automation with a schedule (a fresh
      upload, or a built-in pack) → `automations.trigger.nextRuns.wouldRun`
      with `automations.trigger.nextRuns.notDeployed`, never a bare **Next
      runs**; deploy a version → the plain list returns.
- [ ] `AUTO-F45` · **A new trigger starts off** — On an automation with no
      trigger, **Add trigger** (`automations.trigger.add`) → the form opens
      with **Enabled** OFF on a daily 09:00 schedule in your time zone;
      **Save** → after reload the switch is still off and the next runs read
      `automations.trigger.nextRuns.paused`; nothing fires at 09:00. In the
      **Blank** wizard step 2, **Enable now** (`automations.blank.enableNow`)
      is unchecked by default → the created automation's trigger is off;
      check it → the trigger is on.
- [ ] `AUTO-F46` · **Revoking a webhook asks first** — On an automation with
      a live webhook (AUTO-F28), switch **Trigger type** to Platform event and
      **Save** → a confirm dialog
      (`automations.trigger.revokeConfirm.title`) names the revocation;
      Cancel saves nothing and the old URL still answers 202; confirm → the
      binding changes, a toast (`automations.trigger.revokedToast`) says the
      URL was revoked, and a POST to the old URL answers 404. **Rotate
      token** → confirm dialog (`automations.trigger.rotateConfirm.title`)
      before any new URL is minted; Cancel leaves the old URL working.
- [ ] `AUTO-F47` · **Blank wizard hands over the webhook URL** — **Blank**
      wizard, step 2 **Trigger type** Webhook → the hint reads
      `automations.blank.webhookHint`; **Create automation** → the dialog
      stays open on `automations.trigger.tokenTitle` with the full URL and a
      copy button (`automations.blank.copyWebhookUrl`); the copied URL
      answers 202 to a POST (after Deploy); **Open the automation**
      (`automations.blank.openAutomation`) lands in the editor, whose **General**
      tab's Trigger section lists the URL with its token masked
      (`automations.trigger.webhook.tokenHiddenHint`) — no Rotate needed.
      Closing the dialog with Escape also lands there.
- [ ] `AUTO-F48` · **Stopping a run asks first and keeps what ran** — On a
      live run parked on an approval (AUTO-F25) whose first node already ran,
      **Stop the run** (`automations.runs.cancel`) → a confirm dialog
      (`automations.runs.cancelConfirm.title`); Cancel leaves the run Waiting
      and the approval card in place; confirm → the run reads **Stopped**
      (`automations.runs.status.cancelled`), the approval card is gone, the
      node that ran still reads **Ran** with its output in the inspector's
      run section, the node the run was on reads **Stopped here**
      (`automations.runs.nodeStatus.stopped`) — never **Running now** — and
      later nodes **Not reached yet**; the same after a hard reload. Settings
      › Audit log lists the run’s cancelled action with YOUR name as the
      actor (not the starter's, when another member started it).
- [ ] `AUTO-F49` · **A deleted automation keeps its run history** — Note a
      run URL of an automation with runs, then delete the automation
      (`automations.detail.delete.title`) and open that URL → the page is
      NOT blank: under the breadcrumb and tab strip an info banner
      (`automations.detail.deleted.banner`) names the deletion date, the
      The **Editor** tab is disabled and the version picker is hidden, **Runs** works, and the
      run page shows its header, a canvas drawn from the run's own steps
      (each with its status), the effects and the JSON sections; the Runs
      list still lists the runs; opening `…/editor` shows
      `automations.detail.deleted.title` with **Open the run history**
      (`automations.detail.deleted.openRuns`). A slug nobody ever saved still
      reads `automations.notFound.title`.
- [ ] `AUTO-F56` · **A deleted automation leaves the rail on the list** — Open an
      automation's **Editor**, go back to the list and delete it from its row
      (`automations.detail.delete.title`), switch to **Knowledge**, then click
      the **Automations** rail tile → You land on `/dashboard/{org}/automations`
      (the list), never on `automations.detail.deleted.title`; a second click
      from elsewhere opens the list again. A run URL of that automation still
      opens its run history under the deletion banner (`AUTO-F49`).
- [ ] `AUTO-F50` · **Unserved model warns, never blocks** — Open a built-in
      package whose `llm` node pins a model no connected provider serves and
      select that node → the **Model** field is a picker listing only served
      models, its description reads `automations.editor.llm.modelUnlisted`,
      and a **Model id** box (`automations.editor.llm.modelIdLabel`) holds
      the saved id; **Save version** succeeds and the save's warnings name
      `LLM_MODEL_UNAVAILABLE` for that node; MCP `validate_automation` with
      `model: nonexistent/model-xyz` answers `valid: true` with the same
      warning (`errors: []`); a **Test run** still answers mock output. Pick a
      listed model → the description disappears, the document stores only
      `model` (no `modelProvider`), and a live run of that node succeeds.
      **Type a model that is not listed** (`automations.editor.llm.typeUnlisted`)
      shows the id box for free text.
- [ ] `AUTO-F92` · **What the organization lacks warns, never blocks** — In
      an organization without Gmail connected, open an automation whose
      `agent` node names a skill nobody added, the connector `gmail`, a
      secret nobody stored and the agent runtime `cursor` → **Problems** lists
      four warnings, `automationIssues.codes.HARNESS_UNKNOWN.title`,
      `automationIssues.codes.SKILL_UNKNOWN.title`,
      `automationIssues.codes.CONNECTOR_NOT_CONNECTED.title` and
      `automationIssues.codes.SECRET_UNKNOWN.title`, each going to the node,
      with a closest name where one is close; **Save version** succeeds. MCP
      `validate_automation` with an ordinary member's key answers the same
      warnings except the secret one. Connect Gmail in **Settings ›
      Connectors** → the next check no longer lists it (MCP-R15).
- [ ] `AUTO-F51` · **General tab** — Open
      `/dashboard/{org}/automations/{slug}/general` with the developer
      capability, edit the cron and add a project, leave for **Editor**,
      stay, then **Save** → Two sections on the settings measure: **Trigger**
      (`automations.trigger.title` + `automations.trigger.description`) with
      **Enabled**, **Trigger type** and that kind's fields, then **Projects**
      (`automations.bindings.title` + `automations.bindings.hint`) below a
      divider. ONE **Discard** / **Save** cluster sits in the tab strip; an
      edit lights the **General** tab's unsaved dot; leaving raises the
      unsaved-changes dialog (`common.unsavedChanges.title`); **Save** writes
      both sections and the dot clears; **Discard** puts both back. A member
      without the capability sees the same settings read-only, with no
      cluster and no **Remove trigger**.
- [ ] `AUTO-F52` · **A failing schedule pauses itself** — Deploy an
      automation whose only `transform` node throws, bind it to a `* * * * *`
      schedule with **Enabled** on, and watch its General tab across five
      minutes → after the first failure the Trigger section reads
      `automations.trigger.failures.streak` and
      `automations.trigger.failures.streakSchedule`, with the last failure's
      code (`node_error`) and **View run**
      (`automations.trigger.failures.viewRun`), which opens that run. After
      the fifth, **Enabled** is off and a warning banner reads
      `automations.trigger.failures.pausedTitle` with
      `automations.trigger.failures.pausedBody`, the same after a hard
      reload, and no run starts at the next minute. Turn **Enabled** on and
      **Save** → the banner and the streak line are gone, and the next
      failure counts from one.
- [ ] `AUTO-F53` · **Readers get no Automations** — In a project with a
      deployed bound automation that has run on a task, sign in as a Member,
      then as an Editor, and open the org list, an automation's
      `…/{slug}/runs` and the project's `…/automations` by their URLs →
      each shows **Access denied** (`accessDenied.title`) with
      `accessDenied.automations`, and the browser tab never names the
      automation; the project's tab strip has no **Automations** tab
      (`automations.title`). On the task, the run's details show its steps
      without **Open the full run** (`tasks.run.openFull`), and the
      automation's name in the timeline shows no **View automation**
      (`tasks.timeline.viewWorkflow`); choose **Home** in the rail after the
      project URL → a fresh chat opens (`/chat?new=true`), never the
      denial. An Owner, Admin or Developer gets every page, the tab and both
      links.
- [ ] `AUTO-F54` · **An agent node creates an image into its output** — With
      **Image generation** on ([governance.md](governance.md) GOV-F38), test-run
      an automation whose `agent` node asks for "a 16:9 banner saved as
      banner.png" → The run detail's **Agent log**
      (`automations.runs.agentLog.title`) shows the `generate_image` call
      answering `ok` with a path in the run's output folder (/agent/output)
      and the image's `width` and `height`, a 3:2 landscape such as 1248 × 832
      or 1536 × 1024 that matches the saved file, and the agent reports that
      size rather than 16:9; the node's output lists `banner.png` (or the
      format the model returned) among its `files`, and the usage page books
      the image under the person who started the run and the automation's
      name; turn image generation off and run it again → the agent reports it
      has no image tool and the node's `files` hold no image — env-gated: mark
      **ENVIRONMENT** without a runnable harness and an image-capable
      credential.
- [ ] `AUTO-F55` · **A schedule starts a project agent** — In a project with
      an agent assigned to a task in **To do** (`tasks.status.todo`), save and
      deploy an automation installed in that project whose only node has
      `type: task.start_agent`, that task's id and `moveToInProgress: false`,
      and bind a `* * * * *` schedule with **Enabled** on → within a minute
      the run succeeds and its output reads `started: true` with a `runId`;
      the task's timeline lists the agent run (`tasks.timeline.runLabel`) as
      `tasks.agentRuns.trigger.automation` beside the automation's name, which
      opens that run; the card is still in **To do**. While that agent run is
      live, the next minute's run reads `started: false`,
      `reason: already_running` with the same `runId`, and no second agent run
      appears. Turn **Enabled** off and **Save** → no run starts at the next
      minute. (Without a runnable harness the agent run itself fails at its
      launch; the start and the coalesced occurrence still show.)
- [ ] `AUTO-F57` · **An automation opened in a project shows its project** —
      Bind an automation to exactly one project, open the project, choose its
      **Automations** tab (`automations.title`) and open the automation, then
      one of its runs → The URL stays under
      `/dashboard/{org}/projects/{projectId}/automations/{slug}/…`; the trail
      reads `<project> / Automations / <automation>` (on the run
      `… / <automation> / Run`, `automations.runs.breadcrumb`); the project's
      name opens the project's **Tasks** (`tasks.title`) and **Automations**
      its **Automations** tab; only the leaf heading carries
      `aria-current="page"` in the trail; the rail lights **Automations**
      (`navigation.automations`) and the pill glides there, not to **Home**; a
      long project name truncates without hiding the automation's name, and
      hovering or tabbing to it shows the whole name in a tooltip; on a run a
      long automation name truncates the same way and **Run** stays readable.
      Below 768 px the back arrow (`common.aria.back`) returns to the
      project's **Automations** tab (from a run: to the automation) and the
      tab bar lights **Automations**. Open
      the same automation from the organization's list (`AUTO-F4`) → The same
      trail and rail. Choose **Automations** in the rail → The organization's
      list. Repeat in DE and FR (**Automatisierungen** / **Automatisations**).
- [ ] `AUTO-F58` · **A crashed worker's run reads Interrupted, then
      resumes** — With one backend worker, start a live run whose step works for a few
      minutes (an `llm` step asked for a long answer; an agent step parks the
      run as **Waiting** instead), open its run page, and once it reads **Running**
      kill the worker without warning (`docker kill -s KILL` on its
      container); leave it down for a minute and reload the page → the badge
      reads `automations.runs.status.stalled` with a still icon, not
      `automations.runs.status.running`. Start the worker again → within about
      a minute and a half, without a reload, the badge reads
      `automations.runs.status.running` again and the header shows
      `automations.runs.resumed.label` followed by
      `automations.runs.resumed.lease_expired` with the time; a step that had
      finished before the kill shows once in the steps list. Check the badge
      and the header line in the light and the dark theme and at 390 px wide
      (the line wraps, nothing is cut).
- [ ] `AUTO-F59` · **An interrupted write waits for you** — Deploy an
      automation whose live step writes a file to a WebDAV share you can slow
      down (`type: webdav.write`; a large file, or a local share behind a
      throttling proxy), let the approval policy allow WebDAV writes without a
      person, and start a live run. While the step is writing, kill the worker
      stepping it (`docker kill -s KILL` on its container) and start it again
      → within about a minute and a half the run reads
      `automations.runs.waiting.in_doubt` and shows the card
      `automations.runs.inDoubt.title` with what the step was sending; nothing
      new reaches the share. Choose **Run it again**
      (`automations.runs.inDoubt.retry`) and confirm
      (`automations.runs.inDoubt.retryConfirm.title`) →
      `automations.runs.inDoubt.resolved.retry`, the file is written once more
      and the run succeeds. Repeat with **Skip it**
      (`automations.runs.inDoubt.skip`) →
      `automations.runs.inDoubt.resolved.skip`, the run continues and the
      step's output reads `null`; and with **Fail the run**
      (`automations.runs.inDoubt.fail`, confirmed with
      `automations.runs.inDoubt.failConfirm.title`) → **Failed**
      (`automations.runs.status.failed`), its detail saying a person chose to
      fail the run at that step because it may already have run — naming the
      step once, never a path such as `batch[1:0]/send`.
- [ ] `AUTO-F60` · **A deploy hands a run on** — With two backend workers
      (`docker compose up -d --scale backend-worker=2`), deploy an automation
      of five steps in a row that each work for about 30 seconds (an `llm`
      step asked for a long answer, for example) and start a live run. While
      its third step works, find the worker stepping it — the first segment
      of the run's `lease_owner` (`SELECT lease_owner FROM
      app.automation_runs WHERE id = '{runId}'` in the app database) is that
      container's hostname — and stop it gracefully (`docker stop`, not
      `kill`) → the third step finishes, the other worker continues with the
      fourth within seconds, and the badge reads
      `automations.runs.status.stalled` for at most a few seconds before
      `automations.runs.status.running`; the run succeeds, each step shows
      once in the steps list and the effects, and the header shows
      `automations.runs.resumed.label` followed by
      `automations.runs.resumed.shutdown`. Repeat with steps that each work
      for two minutes → the step under way is cut about 20 seconds into the
      stop, runs again on the other worker, and still shows once.
- [ ] `AUTO-F61` · **An interrupted write is decided from its task** —
      Interrupt a write as in `AUTO-F59`, this time in the run of an
      automation that owns a project task, then open that task as a member
      who can work it → the panel reads `tasks.run.waitingDecision` with no
      spinner and shows the card `automations.runs.inDoubt.title`; **Skip
      it** (`automations.runs.inDoubt.skip`) decides it from the task and the
      run goes on. As a member who can only read the task → the panel reads
      `tasks.run.waitingDecisionOther` and shows no card. On the run page
      meanwhile the canvas marks the step
      `automations.runs.nodeStatus.waiting` with a still icon, and on the run
      of `AUTO-F58`, while it reads `automations.runs.status.stalled`, its
      step reads `automations.runs.nodeStatus.interrupted` — nothing spins on
      a step no server is running.
- [ ] `AUTO-F62` · **A wrong reference shows while typing** — As a
      Developer, open an automation's **Editor**, select an `llm` node and add
      `{{ nodes.nope.output }}` to its **Prompt** → within about a second the
      Problems button (`issues.buttonLabel`) counts 1 error, the node's box
      shows a red error chip and its name ends with the count
      (`issues.nodeSummary`), the reason sits under the Prompt field, and
      **Save** is disabled; focusing it shows `automations.problems.saveBlocked`.
- [ ] `AUTO-F63` · **Go to a problem** — With the draft from `AUTO-F62`,
      click the Problems button and press Enter on the error's row → the list
      opens under the canvas (`automations.problems.title`), the row reads
      the problem's title, where it is and how to fix it
      (`issues.fixLabel`), and Enter opens the node in the inspector with the
      Prompt field focused and the reference to nope selected.
- [ ] `AUTO-F64` · **A fix clears it** — Remove the reference again → the
      Problems button reads `issues.none`, the node's chip and the field's
      line disappear, **Save** is enabled, and a screen reader hears
      `issues.none` once (not at every keystroke).
- [ ] `AUTO-F65` · **Warnings never block** — Give a node a `when` that
      reads a field of a node with a `when` of its own → the Problems button
      counts a warning, not an error; **Save** stays enabled, the version
      saves, and the warning is still listed afterwards.
- [ ] `AUTO-F66` · **A refused save lands in Problems** — Block the check's
      request in DevTools (so Save stays enabled), make the draft invalid as
      in `AUTO-F62` and save it with a message → the save dialog closes onto
      the Problems list with its first error focused, the list shows the
      server's problems, a screen reader hears
      `automations.problems.refusedSave`, no toast appears, and no version
      is added.
- [ ] `AUTO-F67` · **Problems in every language** — Switch the interface to
      Deutsch, then Français, with the draft from `AUTO-F62` → the Problems
      button, the filter (`automations.problems.filter.all`), each row's
      title, location, explanation, cause and fix are translated; only
      **Technical details** (`issues.technicalDetails`) keeps the engine's
      English message.
- [ ] `AUTO-F68` · **From a phone's node sheet to the problems** — At 390 px,
      with the draft from `AUTO-F62`, open a different node and type in one of
      its fields → under the fields, `automations.problems.saveBlocked` stands
      beside **Save** with `automations.problems.open` next to it; tap it →
      the node's sheet closes, the Problems sheet opens on All
      (`automations.problems.filter.all`) with focus on the first error, and
      Enter on it opens the node that holds the error with its field focused.
- [ ] `AUTO-F70` · **Open Triage GitHub issues on the Editor tab** → **Start**
      (`flow.node.entry`) sits above every node: under **Starts**
      (`flow.node.triggers`) the schedule in words with its time zone and
      next run, the state badge while it is not live
      (`automations.canvas.start.notLive`), then **By hand, the API or MCP**
      (`automations.canvas.start.manual`); under **Input** (`flow.node.inputs`)
      owner and repo as required, limit, and trigger and firedAt as from the
      trigger (`automations.canvas.start.fromTrigger`). **End**
      (`flow.node.exit`) at the bottom lists what a run returns — triaged,
      actionable, issues, failed, caughtUp and position — each from Report
      (`automations.canvas.end.fieldFrom`), and the three ways a run ends
      under **Ends** (`flow.node.outcomes`).
- [ ] `AUTO-F71` · **Follow the line from Batch to Report** → it runs
      beside Score's frame, never through it; no line on the canvas crosses a
      box, a condition pill, a frame header or a Yes / No label.
- [ ] `AUTO-F72` · **Read the node boxes of Triage GitHub issues** → each shows
      an icon, a title from its ID (**Issues**, **Batch**), its catalog line
      (**GitHub · List issues**, `automations.canvas.node.catalog.connector`;
      **Automation · Get the previous successful run**; **Transform**,
      **Language model · …**), what it returns once the check
      has answered, and what it reads in its bottom strip
      (`flow.list.reads`); no raw `{{ }}` and no raw type name such as
      github.list_issues on any box. In Deutsch and Français the action titles are translated
      (**GitHub · Issues auflisten**, **GitHub · Lister les issues**).
- [ ] `AUTO-F73` · **Upload the branch probe (Preconditions) and open it** → a
      condition pill above Escalate says
      `automations.condition.gt` in words ("total of Score is greater than
      1,000"); **Yes** (`flow.branch.yes`) leads to Escalate on the left,
      **No** (`flow.branch.no`) to File on the right; Escalate and File have
      dashed borders; the gate's name reads `flow.gate.name` and its
      description `flow.gate.branches`.
- [ ] `AUTO-F74` · **Open Gmail triage inbox** → Propose carries the chip
      **Continues on error** (`automations.canvas.controlFlow.onError`); the
      paths list has a path whose clause reads
      `automations.paths.clause.fails`; Propose's **When it runs** says
      `automations.editor.flow.failContinues`.
- [ ] `AUTO-F75` · **Open the paths list, point at each path, then press Enter
      on one** → the button (`automations.paths.button`) opens **Possible
      paths** (`automations.paths.title`) as a panel under the view switch;
      pointing previews a path, Enter pins it: off-path nodes turn dashed
      with their reason (`automations.paths.skip.*`), End marks outputs
      empty on that path (`automations.canvas.end.emptyOnPath`), and a screen
      reader hears `automations.paths.showing` once; **Show all**
      (`flow.paths.showAll`) or Escape restores every node. The panel stays
      open while you click nodes.
- [ ] `AUTO-F76` · **In the paths list, point at a node under Ends the run
      when it fails** → the section (`automations.paths.halts.title`) rings
      every halting node in red at once; Enter on a row opens that node in
      the inspector.
- [ ] `AUTO-F77` · **In a second window, save a new version through MCP while
      the first shows the latest with no draft** → the first canvas glides
      to the new layout in about a third of a second, a new node fades in,
      changed nodes ring once, no node swaps sides with its row neighbour, a
      screen reader hears `automations.canvas.updated`, and the open node
      stays open (or the inspector closes with
      `automations.canvas.selectionRemoved` when it is gone).
- [ ] `AUTO-F78` · **With a draft open, save another version through MCP** →
      an info notice above the canvas says
      `automations.canvas.newerVersion.title` with
      `automations.canvas.newerVersion.show`; it names the version the draft
      is based on, who saved the new one
      (`automations.canvas.newerVersion.savedBy`) and what it changed, and
      `automations.canvas.newerVersion.seeChanges` opens the comparison in a
      new tab with the draft left in place. Nothing on the canvas moves
      until you choose Show, and choosing it shows the new version.
- [ ] `AUTO-F79` · **In a Prompt, type `{{` then `nodes.`** → the field reads
      `{{  }}` with the caret inside and suggestions open; after `nodes.` only
      nodes that run earlier are offered, never the node itself or a later
      one; after `.output.` the node's fields are listed with their kinds; the
      finished expression shows as a tinted mono chip in the prose.
- [ ] `AUTO-F80` · **Point at a reference in a code field, then press ⌘K ⌘I
      (Ctrl+K Ctrl+I) on it** → the same type tooltip
      (`codeEditor.typeInfo.label`) both ways; the keyboard one is read aloud
      (`codeEditor.typeInfo.announce`).
- [ ] `AUTO-F81` · **Misspell a node ID inside a transform's Code** → within
      about a second a wavy underline sits under exactly that ID; F8 moves
      to it and reads it (`codeEditor.diagnostics.atCursor`); ⌘. (Ctrl+.)
      applies `automations.editor.fixSuggestion` with the closest ID; going
      to the same problem from the Problems list selects the same span.
- [ ] `AUTO-F82` · **Under Control flow, set On error to Continue without it,
      Maximum repeats to 3 on a node with Repeat until, and an Else of
      target** → **On error** (`automations.editor.fields.onError`) offers
      `automations.editor.fields.onErrorStop` and
      `automations.editor.fields.onErrorContinue`; **Else of** offers only
      nodes with a condition, plus **None**
      (`automations.editor.fields.elseOfNone`); 25 in **Maximum repeats** is
      refused with `automations.editor.fields.maxRepeatsRange` and changes
      nothing; each valid setting is in the saved version's Source.
- [ ] `AUTO-F83` · **Open a node's Shape tab** → **Receives**, **Returns** with
      where the shape comes from (`automations.editor.shape.origin.*`) and
      **Read by** (`automations.editor.shape.readBy`), whose buttons open each
      reader; **Show as TypeScript** (`schemaTree.asTypeScript`) shows the
      same shape as a type.
- [ ] `AUTO-F84` · **Select Start and edit its Input schema; select End and edit
      its Output; save** → Start's inspector (`automations.editor.start.title`)
      shows the trigger rows with **Change in General**
      (`automations.editor.start.editTrigger`), the input fields as a tree and
      **Input schema** (`automations.detail.runInput.schema`); End's
      (`automations.editor.end.title`) shows **How a run ends** with each
      halting node as a button, and **Output**
      (`automations.editor.fields.output`); both edits are in the new version;
      a problem in either opens there from the Problems list; `?node=__start`
      and `?node=__end` open them from a link.
- [ ] `AUTO-F85` · **Switch to Source** (`automations.canvas.view.source`) → the
      whole document as highlighted YAML with line numbers, folding and
      search (⌘F); **Copy YAML** (`automations.source.copy`) copies it and its
      icon turns into a check for two seconds; **Download YAML**
      (`automations.source.download`) saves `<name>-v<n>.yml`, with `-draft`
      while a draft is open; `automations.source.readOnlyHint` stands under
      the toolbar; a problem in `tests` goes to its line from the Problems
      list.
- [ ] `AUTO-F86` · **Switch to List** (`automations.canvas.view.list`) → the
      nodes in run order, each with what it reads (`flow.list.reads`) and its
      condition folded in as `flow.relation.onlyIf`; Enter opens a node; the
      view stays in the URL as `?view=list` across a reload.
- [ ] `AUTO-F87` · **Find Edit with your coding agent**
      (`automations.codingAgent.button`) → it is the last button at the
      canvas's top right in Canvas, List and Source, and the primary action of
      a version with no nodes (`automations.canvas.empty.title`); its dialog
      shows what SET-F89 shows — the **Claude Code**, **Codex** and **Other**
      tabs with their commands, the line that waits for an agent to sign in and
      then names it, and a prompt that names this automation
      (`codingAgent.prompt.edit`) with **[Describe the change you want.]**
      marked — and **Setup guide** (`codingAgent.dialog.guide`) opening the
      guide in a new tab. With the agent sign-in switched off
      (`TALE_MCP_DYNAMIC_CLIENT_REGISTRATION` and
      `TALE_MCP_CLIENT_METADATA_DOCUMENTS` both `false`) it shows **Name of
      this automation** (`automations.codingAgent.nameLabel`) to copy, **Set up
      MCP** (`automations.codingAgent.setUp`) opening
      `/dashboard/{org}/settings/api/mcp`, and **How to connect a coding
      agent** (`automations.codingAgent.learnMore`) opening the MCP endpoint
      guide in a new tab.
- [ ] `AUTO-F88` · **Upload a document whose `ui` block stacks every node at
      0,0** → it is laid out automatically like any other; after a field edit
      and **Save version**, Source shows the `ui` block unchanged.
- [ ] `AUTO-F89` · **Open a failed run** → the failed node is in view, framed in
      red with its error's first line in its strip; the way the run took to
      it stands out while other nodes step back; End says
      `automations.canvas.end.failedAt`; selecting a node opens its inspector
      on **Last run** (`automations.editor.inspector.tabs.run`).
- [ ] `AUTO-F182` · **Open a failed run and select Fix with your coding agent**
      (`automations.codingAgent.fixAction`) → as an Owner, Admin or Developer
      the button stands after **Show step** and **Retry from this step** on
      the failure card, and is its only button when the run names no step; a
      reader without the developer capability sees the card without it. Its
      dialog is titled **Fix with your coding agent** and says a coding agent
      can read this run step by step (`automations.codingAgent.fixBody`);
      below it stands what SET-F89 shows — the client tabs with their
      commands and the line that waits for an agent to sign in — and a prompt
      that names the run's ID and its automation (`codingAgent.prompt.run`)
      with no part in brackets, so no hint to replace one. Give the prompt to
      a connected agent → it reads the run with `get_run`, explains why it
      failed and proposes a fix, and asks before it saves one. With agent
      sign-in switched off (`TALE_MCP_DYNAMIC_CLIENT_REGISTRATION` and
      `TALE_MCP_CLIENT_METADATA_DOCUMENTS` both `false`) the dialog shows
      **Name of this automation** and **ID of this run**
      (`automations.codingAgent.runLabel`) to copy, **Set up MCP** and **How
      to connect a coding agent** instead. At 390 px the card's buttons wrap
      and the dialog is a bottom sheet.
- [ ] `AUTO-F183` · **Create automation › With your coding agent**
      (`automations.createMenu.withAgent`) → a dialog titled **Create with your
      coding agent** (`automations.codingAgent.createTitle`) says coding agents
      build automations through the MCP server
      (`automations.codingAgent.createBody`); below it stands what SET-F89
      shows — the client tabs with their commands and the line that waits for
      an agent to sign in — and a prompt that asks the agent to create one
      (`codingAgent.prompt.create`) with **[Describe what it should do.]**
      marked and the hint to replace it. The item is second in the menu, after
      **From a template**, on the organization's list and on a project's. With
      agent sign-in switched off (`TALE_MCP_DYNAMIC_CLIENT_REGISTRATION` and
      `TALE_MCP_CLIENT_METADATA_DOCUMENTS` both `false`) the dialog shows **Set
      up MCP** and **How to connect a coding agent** and no name to copy. Give
      the prompt to a connected agent → it saves a first version of a new
      automation, which then appears in the list; it asks before it deploys.
- [ ] `AUTO-F90` · **Expand a node's Code field, edit, then go back** →
      **Expand editor** (`codeEditor.expand`) opens the larger editor; **Back
      to the field** (`codeEditor.collapse`) returns with the edit in place and
      the caret where it was.
- [ ] `AUTO-F91` · **Switch to Deutsch, Français and Deutsch (Schweiz)** →
      every canvas, paths, Start/End, inspector and Source string is
      translated; German conditions put the verb last ("… größer als 1.000
      ist"); French shows « Canevas » with no-break spaces before `:`; Swiss
      German shows «…» and "grösser".
- [ ] `AUTO-F93` · **A preset saves in one click** — On a deployed
      automation with an enabled schedule, open the **General** tab's
      **Schedule** picker
      (`automations.trigger.schedule.label`) → the popover lists the presets
      (every 15 minutes, every hour, and daily, weekday
      (`recurrence.workweekRange`), weekly and monthly at the schedule's
      time) with the stored schedule's row checked and its next three runs
      under **Next runs** (`recurrence.nextRuns`). Choose **Every hour** → the
      popover closes, the picker reads Every hour, the **General** tab's
      unsaved dot lights and the list below reads
      `automations.trigger.nextRuns.titleUnsaved`; **Save**
      (`common.actions.save`) → after reload the picker reads Every hour and
      its row is checked. Opening the picker and pressing Escape changes
      nothing.
- [ ] `AUTO-F94` · **Times of day are added, deduplicated and sorted** — In
      the picker, choose **Custom times** (`recurrence.customTimes`), **Week**
      (`recurrence.editor.units.weekly`) on Mo–Fr and 09:00 under **At**
      (`recurrence.editor.at`); **Add time** (`recurrence.editor.addTime`) →
      a row one hour after the last (10:00) appears with focus in it; type
      17:30, add another and type 09:00 → that row says
      `recurrence.editor.duplicateTime`; remove it with its **Remove** button
      (`recurrence.editor.removeTime`, naming the time). Add rows until there
      are twelve → **Add time** is disabled and says
      `recurrence.editor.maxTimes`. Remove back to 17:30 and 09:00 and
      **Save** in the popover → the picker reads every weekday at 9:00 AM and
      5:30 PM, in that order; after the tab's **Save** and a reload, Custom
      times reopens with the same two times.
- [ ] `AUTO-F95` · **An interval keeps to its hours** — Choose **Custom
      interval** (`recurrence.customInterval`), every 15 minutes on Mo–Fr,
      and turn on **Only between** (`recurrence.editor.onlyBetween`) from
      08:00 until 18:00 → the line under the hours reads
      `recurrence.editor.windowHint.sameDay` with 8:00 AM and 5:45 PM. From
      22:00 until 06:00 → `recurrence.editor.windowHint.overnight`. The same
      start and end → `recurrence.editor.windowHint.allDay`. Every 6 hours
      from 08:00 until 11:00 → `recurrence.editor.windowHint.none`, and the
      popover's **Save** is disabled with that reason; start at 06:00 instead
      → `recurrence.editor.windowHint.once` and it saves.
- [ ] `AUTO-F96` · **A stored cron keeps its meaning** — Switch **Schedule
      format** to **Cron (advanced)** (`automations.trigger.schedule.formatCron`),
      enter `0 7 * * *`, **Save** and reload → the schedule opens in
      **Repeat** reading daily at 7:00 AM, with
      `automations.trigger.schedule.savedAsCron` naming `0 7 * * *`. Turn
      **Enabled** on, save and reload → the note still names the same
      expression. Change the time to 07:30, save and reload → the note is
      gone. Store `30 8 1 * 1` the same way → after reload it opens in
      **Cron (advanced)** as typed; switching to **Repeat** shows
      `automations.trigger.schedule.cronNotConvertible`, and switching back
      shows the expression unchanged. In **Repeat**, a schedule at 9:00 and
      17:30 switched to Cron reads `automations.trigger.schedule.repeatNoCron`.
- [ ] `AUTO-F97` · **Next runs in the schedule's zone and across a clock
      change** — With the computer's time zone set to America/New_York, set
      **Timezone** (`automations.trigger.timezoneLabel`) to `Europe/Zurich`
      and a Custom times schedule of **Year** on 28 March at 02:30 → **Next
      runs** lists 28 March 2027 marked **Clock change**
      (`recurrence.occurrences.clockChange`) with
      `recurrence.occurrences.shiftedForward` (it starts at 3:30 AM), and
      each run also in your own time
      (`recurrence.occurrences.localOtherDay` or
      `recurrence.occurrences.local`). On 25 October at 02:30 the 2026 run
      reads `recurrence.occurrences.repeatedHour`. Set **Timezone** back to
      your own zone (`automations.trigger.timezoneYours`) → the second time
      is gone. (Past those dates, use the next last Sunday of March and of
      October.)
- [ ] `AUTO-F98` · **A skipped start says why and how to fix it** — Give an
      automation an enabled every-minute schedule (**Custom interval**, every
      minute) and reload a minute after each step: with no version deployed
      → the **Trigger** section reads
      `automations.trigger.skip.notDeployed.title` with **Open the editor**
      (`automations.trigger.skip.openEditor`). Deploy a version whose
      `inputs` require `owner` → `automations.trigger.skip.inputRefused.title`
      naming that version, with **Add the missing field**
      (`automations.trigger.fixedInput.fillMissing`) and **Open the editor**.
      Each notice's **Technical details**
      (`automations.trigger.skip.technicalDetails`) is closed at first and
      shows the code in English. Add the field and **Save** → once the next
      run starts, the notice is gone and the line reads
      `automations.trigger.health.lastRun` with the run's state and **View
      run** (`automations.trigger.failures.viewRun`). Then switch the trigger
      to **Platform event** › **Contact created**, install the automation in
      one project only, archive that project and create a contact →
      `automations.trigger.skip.projectRefused.title`, saying an event
      arrived and its project is archived, whose **Edit the projects**
      (`automations.trigger.skip.editProjects`) moves focus to **Projects**.
- [ ] `AUTO-F99` · **Run now starts what the trigger would** — On a deployed
      automation with a saved schedule, **Run now**
      (`automations.trigger.runNow.label`, beside **This run receives**,
      `automations.trigger.input.title`) → a confirmation
      (`automations.trigger.runNow.body`) shows the input with
      `"trigger": "schedule"` and `firedAt`; **Start run**
      (`automations.trigger.runNow.confirm`) → under the button
      `automations.trigger.runNow.started` with **View run**, which opens a
      live run of the deployed version; the trigger's last-run line and
      **Next runs** do not change. On a webhook or event trigger, **Run now**
      opens the run dialog with the sample `payload` to edit. Edit the
      trigger without saving → **Run now** is disabled and says
      `automations.trigger.runNow.unsaved`; with no deployed version it says
      `automations.detail.runLiveNeedsDeploy`.
- [ ] `AUTO-F100` · **A webhook answers on each project's URL** — Install an
      automation in two projects, open its General tab inside the second one
      (`/dashboard/{org}/projects/{projectId}/automations/{slug}/general`),
      choose **Webhook** and **Save** → `automations.trigger.tokenTitle` lists
      two copyable URLs, labelled with the project names, this project's
      first, each ending in `/api/projects/<project id>/automations/webhook/`
      and the token; **Send a test request**
      (`automations.trigger.webhook.sampleTitle`) holds a curl command with
      this project's full URL and an `Idempotency-Key`. Reload → **Project
      URLs** (`automations.trigger.webhook.projectUrls`) lists both with the
      token masked, `automations.trigger.webhook.tokenHiddenHint` and
      `automations.trigger.webhook.orgUnused`; the curl command now reads
      `$TALE_WEBHOOK_URL`, and the token appears nowhere on the page. An
      automation installed in no project shows one **Webhook endpoint**
      address under `/api/automations/webhook/`.
- [ ] `AUTO-F101` · **Recent deliveries** — With the webhook of `AUTO-F100`
      deployed and on, **Recent deliveries**
      (`automations.trigger.webhook.deliveries.title`) reads
      `automations.trigger.webhook.deliveries.empty`. Send the test request
      with `Idempotency-Key: a1` and reload → one row with its time,
      `automations.trigger.webhook.deliveries.byHeader` naming
      `idempotency-key`, the run's state and **View run**. Send it again →
      the answer names the same run and no row is added. Send a body with no
      id header and reload → its row reads
      `automations.trigger.webhook.deliveries.byBody`, which is gone two
      minutes later. A request to a wrong token answers 404 and adds no row
      (`automations.trigger.webhook.deliveries.refusedNote`). Block the
      read in DevTools and reload →
      `automations.trigger.webhook.deliveries.loadFailed` with **Try again**
      (`automations.trigger.retry`); unblock and press it → the list returns
      with focus on its heading.
- [ ] `AUTO-F102` · **Events read as words** — Choose **Platform event** →
      **Event name** (`automations.trigger.eventLabel`) lists the events
      under Tasks, Comments, Conversations, Contacts and Projects
      (`automations.trigger.events.group.*`), each with its name, its id
      (such as task.created) and one sentence of when it is raised; typing
      `status_changed` in the search (`automations.trigger.events.search`)
      finds **Task status changed**, and `xyz` reads
      `automations.trigger.events.empty`. Pick it → its sentence stays under
      the field, with `automations.trigger.events.scopeOrg` (installed in no
      project) or `automations.trigger.events.scopeProjects` naming the
      saved projects, and `automations.trigger.events.loopBounded`; **This
      run receives** shows `"trigger": "event"`, the event's id and a sample
      `payload`, with `automations.trigger.input.event`. **Save** and reload
      → the same event is picked.
- [ ] `AUTO-F103` · **Missed runs follow the setting** — **Missed runs**
      (`automations.trigger.catchUp.label`) reads
      `automations.trigger.catchUp.latest` with
      `automations.trigger.catchUp.latestHint`; choose
      `automations.trigger.catchUp.skip` → the hint reads
      `automations.trigger.catchUp.skipHint`, and **Save** + reload keep it.
      On a deployed, enabled schedule due in two minutes under **Skip
      them**, stop the backend before the due time and start it 12 minutes
      after → no run starts for it, and the **Trigger** section reads
      `automations.trigger.skip.missed.title` (1 run) with the time and
      `automations.trigger.skip.missed.policySkip`. With the default, the
      same outage starts one run for the due time as soon as the backend is
      back, and no notice says a run was missed. An every-minute schedule
      on the default, stopped for three minutes → one run starts for the
      latest minute and the notice counts the earlier ones with
      `automations.trigger.skip.missed.policyLatest`.
- [ ] `AUTO-F104` · **The fixed input adds the missing fields** — Deploy a
      version whose `inputs` require `owner` (a string) and `limit` (an
      integer), with a saved schedule and no fixed input → **This run
      receives** warns `automations.trigger.input.refusedTitle` naming the
      version and both fields; **Fixed input**
      (`automations.trigger.fixedInput.label`) is already open with **Add
      the 2 missing fields** (`automations.trigger.fixedInput.fillMissing`).
      Click it → the field holds `"owner": ""` and `"limit": 0` with the
      caret inside the first; type `acme` and **Save** →
      `automations.trigger.input.accepted` names the version, and after
      reload the field and the input both show `owner` and `limit` beside
      `trigger` and `firedAt`. Enter `{"trigger": "x"}` →
      `automations.trigger.issues.input.reservedKey` under the field and
      **Save** stays disabled; `[1]` →
      `automations.trigger.issues.input.notObject`; `{` →
      `automations.trigger.fixedInput.notJson`.
- [ ] `AUTO-F105` · **A deploy offers to turn the trigger on** — On an
      automation whose saved schedule is off, **Deploy** a saved version
      (`automations.detail.deployVersion`) → a notice reads
      `automations.trigger.deployNotice.title` with focus on it and **Turn
      on the trigger** (`automations.trigger.deployNotice.turnOn`); press it
      → the notice reads `automations.trigger.deployNotice.turnedOn` and
      keeps the focus, and the General tab shows **Enabled** on with the
      schedule unchanged. Deploy the built-in GitHub triage pack's version
      from its editor → the notice offers **Review the trigger**
      (`automations.trigger.deployNotice.review`) instead, which opens the
      General tab with the **Trigger** section in view below the tab strip.
      Upload a pack with a schedule and choose **Deploy**
      (`automations.upload.deployNow`) → the dialog stays open on the same
      notice. Block the trigger write in DevTools and press **Turn on the
      trigger** → `automations.trigger.deployNotice.turnOnFailed` beside the
      button, in words.
- [ ] `AUTO-F106` · **Open a failed run** → a card titled
      `automationRuns.failure.title` names the step it failed at and says,
      in words, what the failure means, its concrete cause and the fix; the
      engine's English sits under **Technical details**; **Show step**
      (`automationRuns.failure.showStep`) selects the step on the canvas and
      **Show in editor** (`automationRuns.failure.showInEditor`) opens the
      editor on the run's version with the step selected.
- [ ] `AUTO-F107` · **Retry from the failed step**
      (`automationRuns.failure.retry`) → the dialog
      `automationRuns.replay.from.titleRetry` lists what it reuses and what
      runs again; on a live run whose steps write, it warns
      `automationRuns.replay.writes.live` and focuses **Cancel**; confirming
      opens the new run, whose header says `automationRuns.lineage.from` with
      **Open run** and **Compare with it** (`automationRuns.lineage.compare`).
- [ ] `AUTO-F108` · **Run again** (`automationRuns.again.button`) on a test
      run → a new run starts at once and opens. On a live run that wrote,
      it first asks `automationRuns.again.liveConfirm.title` and names the
      services; the menu (`automationRuns.again.menu`) offers
      `automationRuns.again.edit`, `automationRuns.again.latest` when a newer
      version exists, `automationRuns.again.live` when another version is
      live, and copies the run ID and link with a toast.
- [ ] `AUTO-F109` · **Edit input and run…** → the run dialog opens with the
      run's input and `automationRuns.again.editScope`; changing a field
      starts a run with it; confirming unchanged runs the run again.
- [ ] `AUTO-F110` · **Play a run back** → the canvas opens on the run's end
      with the bar `flow.playback.label` below it; **Previous event** and
      **Next event** step through it, **Play** plays it at the chosen speed
      with the run's real elapsed time; a skipped step says
      `automationRuns.playback.reason.when` and a waiting one
      `automationRuns.playback.wait.approval`; a running run follows its end
      until scrubbed, then offers `flow.playback.followLive`.
- [ ] `AUTO-F111` · **Select a skipped step on a run** → **Last run** says
      `automationRuns.conditions.skippedWhen`; the
      `automationRuns.conditions.onlyIf` card reads the condition with the
      values it read ("amount of the run input (250) is not greater than
      1,000") and **No**; a condition joined with `&&` lists each part with
      **Yes**, **No** or `automationRuns.conditions.verdict.notChecked`.
- [ ] `AUTO-F112` · **Compare a replay with its run**
      (`automationRuns.lineage.compare`) → `automationRuns.compare.title`
      shows both runs, `automationRuns.compare.differs.title` in sentences
      and every step of each in `automationRuns.compare.table.label`;
      **Swap A and B** (`automationRuns.compare.swap`) swaps them in the URL.
- [ ] `AUTO-F113` · **Switch to Deutsch, Français and Deutsch (Schweiz) on a
      failed run, its retry dialog, its playback and a comparison** → every
      sentence is translated; German conditions put the verb last ("…
      nicht größer als 1.000 ist"); Swiss German shows «Für jedes» and
      "grösser"; French puts a no-break space before `:`.
- [ ] `AUTO-F114` · **Select a step of a finished run** → **Last run** lists
      `automationRuns.data.reads` in words with each value read ("issues of
      Open issues: 12 items"), then `automationRuns.data.received` and
      `automationRuns.data.returned`; a value with a secret says
      `automationRuns.data.redacted` and never shows it.
- [ ] `AUTO-F115` · **Select a step that ran once per item, with a failed
      item** → its items list says `automationRuns.items.failedCount`; each
      row shows how it ended and a failed one why;
      `automationRuns.items.failedOnly` keeps the failed ones; picking a row
      shows that item's data below.
- [ ] `AUTO-F116` · **Open the Runs tab of an automation with failed and
      successful runs** → `automationRuns.list.caption` lists them newest
      first with status, start, result (a failure's title, a waiting run's
      reason), version, mode and starter; scrolling loads older runs;
      **Filter** narrows by `automationRuns.list.filters.status` and mode,
      and says `automationRuns.list.noMatch` when nothing fits; selecting two
      rows enables `automationRuns.list.compare`, which opens their
      comparison, and a row opens its run.
- [ ] `AUTO-F117` · **On a finished run, choose `automationRuns.view.steps`**
      → the canvas gives way to the run's steps in time order, each with how
      long it worked (none for a skipped step) and a bar for when, each
      condition with its decision; the playback bar stays, and a run of under
      a minute reads its clock in seconds or milliseconds; choosing a step
      opens it in the inspector and moves the clock to its start;
      `automationRuns.view.chart` shows the canvas at that moment.
- [ ] `AUTO-F118` · **Select a step that returned an object or a list** →
      Received and Returned read as trees that open with the arrow keys;
      **Shape** shows the fields and their kinds for both at once; copy puts
      the JSON on the clipboard, full screen opens it large, and a value over
      8 KB offers a download; for a transform whose input and output are both
      objects, `automationRuns.data.changes` lists what it added, removed
      and changed.
- [ ] `AUTO-F119` · **Compare two runs whose input differs** →
      `automationRuns.compare.diff.input` shows A and B side by side (a list
      on a narrow window) with each changed field marked; when the outputs
      differ too, `automationRuns.compare.diff.output` appears above it; two
      runs with the same input show neither. `automationRuns.compare.canvas`
      draws both runs on one chart, B's version when both ran it: each strip
      reads "A … · B …", the step where they part is ringed.
- [ ] `AUTO-F120` · **In `automationRuns.view.steps`, open a step that ran
      once per item** → `flow.timeline.loadingItems` shows while its items
      are read, then each item joins under it with how it ended and how long
      it worked (past 20, `flow.timeline.showAll`); choosing one opens it in
      the inspector with that item picked in its list, and moves the clock
      to its start. The URL now carries `?view=steps`, the step, the item and
      `t` (where the clock rests): a reload or the same link in a new tab
      opens the same view, step, item and moment; `automationRuns.view.chart`
      takes `view` out of the URL, and playing on to the end takes `t`.
- [ ] `AUTO-F121` · **Run live a deployed automation whose `agent` node
      has `input: { customer: '{{ input.customer }}', apiKey: 'k-123' }`
      and the prompt "Name the customer in your input file", started with
      `{ customer: 'Ada' }`** → the agent's reply names Ada, and its
      **Agent log** (`automations.runs.agentLog.title`) shows it reading
      `/agent/workspace/input.json`; select the step → its
      `automationRuns.data.received` holds the `input` beside the prompt,
      with `apiKey` shown as `automationRuns.data.redacted`. A **Test run**
      of the same version receives the same `input`. Give the node an
      input over 1 MiB (a transform returning `'x'.repeat(1100000)`) and
      run live again → the run fails within seconds and the step's error
      reads "staging input files failed: workspace/input.json (too_large)"
      — env-gated: mark **ENVIRONMENT** without a runnable harness and a
      model credential.
- [ ] `AUTO-F122` · **Create a blank automation (Create automation › Blank)
      with a webhook trigger, **Enable now** checked and **Deploy v1 now**
      (`automations.blank.deployNow`) left on** → the automation opens with v1
      live (the version selector reads `automations.versions.deployed`); send
      the webhook's sample request with `{ "customer": "Ada" }` → a run starts,
      and the agent's **Agent log** shows it reading
      `/agent/workspace/input.json`, which holds the payload under `run`.
      Repeat with **Deploy v1 now** unchecked → v1 stays a draft and the same
      request starts nothing until you deploy it from the editor.
- [ ] `AUTO-F123` · **Add an `http.get` step without a credential reading
      `https://httpbin.org/json`, save and **Run live** a deployed version** →
      the step succeeds; its output shows `status: 200`, `ok: true`, the JSON
      `body`, and only the allowed answer headers (`content-type`, never
      `set-cookie`). Change the URL to `http://httpbin.org/json` → the editor
      warns `HTTP_URL_NOT_HTTPS` under the URL, and a live run fails with
      `automationRuns.reasons.HTTP_BLOCKED_HOST` (plain HTTP).
- [ ] `AUTO-F124` · **In Settings › Connectors add an HTTP credential "Echo"
      (Bearer token `tok_manual_check_12345`, base URL
      `https://httpbin.org/anything`), then run live an `http.get` step with
      `credential: Echo` and `url: /orders`** → the call reaches
      `https://httpbin.org/anything/orders`; the echoed body shows the
      Authorization header as `Bearer [redacted]`, never the token, in the
      output and in the run's record. Change the URL to
      `https://httpbin.org/get` → the run fails with
      `automationRuns.reasons.HTTP_OFF_ORIGIN` before any request leaves.
- [ ] `AUTO-F125` · **Give an `http.send` step `method: POST`, a JSON
      `body` and the header `Authorization: Bearer x`** → the editor refuses
      the save with `HTTP_HEADER_RESERVED` on the header; remove it and run
      live → the run waits for an approval like every write, and once
      approved posts the body as `application/json`. A **Test run** never
      sends: the step's output is the mock answer.
- [ ] `AUTO-F126` · **Name a credential the connector does not have
      (`credential: Shop APII` on an `http.get` step)** → the editor warns
      `CREDENTIAL_UNKNOWN` under the field with "Did you mean "Shop API"?"
      when a Shop API credential exists; a live run fails at the step
      saying the credential was not found.
- [ ] `AUTO-F127` · **In an automation bound to the project Website
      relaunch, add a `knowledge.search` step with `query: launch checklist`
      and `corpus: documents`, deploy and **Run live** in that project** → the
      step's output lists `hits`, best first, each with `text`, `title`,
      `source: documents` and `documentId`; a file of the project and a
      document every member shares can appear, a file of another project
      never does. With `limit: 1` → one hit. A **Test run** answers with the
      mock's example passage.
- [ ] `AUTO-F128` · **In an organization with no embedding model (Settings ›
      Data residency), run live a `knowledge.search` step** → the run fails
      at the step with `automationRuns.reasons.KNOWLEDGE_NOT_CONFIGURED`,
      saying where an administrator chooses a model. Choose one, use up a
      project's cost limit and run the step again in that project → it fails
      with `automationRuns.reasons.BUDGET_EXCEEDED`, and the technical
      details name the limit.
- [ ] `AUTO-F129` · **Run live an `http.get` step on
      `https://httpbin.org/status/503`, then on
      `https://httpbin.org/status/404`** → the first run fails as
      `automationRuns.runFailure.codes.connector_unavailable` (a service was
      unavailable, run again later), the second as
      `automationRuns.runFailure.codes.connector_error`; both steps explain
      `automationRuns.reasons.HTTP_STATUS` with the status the API answered.
- [ ] `AUTO-F130` · **In an automation installed in Customer onboarding
      portal, add a `task.create` step with `title: Reply to {{ input.from }}`,
      `assignee` your own email, `status: todo`, `dueDate: 2026-10-17` and
      `labels: [support]`, deploy and **Run live** in that project** → a task
      appears on the project's board in To do, assigned to you, due 17
      October, labelled support, its creator shown as the automation; the
      step's output carries its `taskId`, `number`, `title` and a `url` that
      opens it. A **Test run** creates nothing and answers with the mock.
- [ ] `AUTO-F131` · **Run the same step with `assignee: nobody@example.com`,
      then in a project the automation is not installed in** → the first run
      fails at the step with `automationRuns.reasons.TASK_ASSIGNEE_UNKNOWN`,
      the second with `automationRuns.reasons.TASK_PROJECT_NOT_BOUND`;
      neither leaves a task or a new label on any board.
- [ ] `AUTO-F132` · **Add a `notify.member` step with `to: [run-starter]`,
      `title: Weekly report ready`, a `message` and
      `link: /dashboard/{org}/documents`, deploy and run it live** → your bell
      shows **Weekly report ready** with the message and "Sent by the
      automation" naming it (`inbox.automationMessageBody`); clicking the row
      opens Documents. The step's output lists you under `delivered`. Change
      the link to `https://example.com/report` → the row offers **Open
      example.com** (`notifications.openWebLink`), which opens a new tab. A
      **Test run** tells nobody and answers with the mock.
- [ ] `AUTO-F133` · **Switch off Messages from automations
      (`notificationPreferences.fields.automationMessages.label`) in
      Settings › Notifications and run the step again** → no row reaches your
      bell; the step's output lists you under `skipped` with
      `reason: preference`. Name `nobody@example.com` beside you → the run
      fails at the step with `automationRuns.reasons.NOTIFY_NOT_A_MEMBER` and
      nobody is told. Started by a schedule, `run-starter` is listed as
      skipped with `reason: no_starter`.
- [ ] `AUTO-F134` · **In an automation whose `llm` steps name a model,
      click Change model (`automations.editor.modelSwap.open`)** → a
      dialog lists the model with its count of steps and the steps that
      change; pick another model with the keyboard and Use this model →
      both steps show it, Save and Discard arm, and Discard brings the old
      model back. The button is absent when no `llm` step names a model.
- [ ] `AUTO-F135` · **As an owner, on the General tab of an automation
      whose step sends a Slack message, turn on Slack · Send message under
      Runs without approval (`automations.allowances.title`), save, and run it
      live** → the step posts without an approval card; the canvas box shows
      `automations.canvas.node.runsWithoutApproval`, and the audit log shows
      the grant. Another automation's Slack step still waits for approval. As
      a developer, the switches are disabled with
      `automations.allowances.readOnly`. Add an `approval_policy` rule
      `slack.send_message: require_approval` → the run waits again.
- [ ] `AUTO-F136` · **As an owner, open Create automation › From a
      template (`automations.createMenu.template`), open Tell the reviewer,
      select Use this template (`automations.templates.use`), answer it for a
      project with yourself as the reviewer, keep Start it now on
      (`automations.templates.startNow`) and create** → the automation
      opens in the editor with version 1 live and its event trigger on. Move a
      task of that project to In review → your notifications show the task's
      title with the message, and its link opens the task. Create it again
      under the same name → `automations.blank.nameTaken` under Name, and
      nothing is created.
- [ ] `AUTO-F137` · **From a project's Automations list, create Create tasks
      from a webhook** → its Project question starts on that project; after
      Create, `automations.templates.webhookTitle` shows the project's webhook
      address once. POST `{"title":"Server down"}` to it → a task Server down
      appears in the project. A POST without a title starts no run, and the
      trigger's last start on the General tab says it was refused.
- [ ] `AUTO-F138` · **Create Daily task digest from a template for a
      project with a task created today, sending it to yourself, then Run
      live from the editor** → the run succeeds, and its Tasks step
      (`task.list`) returns the project's tasks created since the last digest
      that was sent — the day before, for the first one — oldest first,
      archived ones left out. Your notifications show the message
      title (`New tasks`) with a line per task and the automation's name, and
      it opens the project's tasks. Run it for a project with no new task →
      the run succeeds and nothing is sent.
- [ ] `AUTO-F139` · **Open Versions on an automation with four versions, one
      of them live** → the card says `automations.deployments.live.title`
      (v{n} is live), since when, who deployed it and through what (in the
      app; with the client through MCP for an agent's deploy) and how many of
      its runs are in progress. The list shows every version newest first:
      the **Live** badge on the live one and `automations.versions.lastLive`
      on one that was live before, its message (or **No message**), who saved
      it and through what, its changes against the one before (**First
      version** on v1) and its tests word.
- [ ] `AUTO-F140` · **On the card, click Roll back to v{n}** → the button
      keeps focus and shows it is working; the toast says v{n} is live and
      that runs already started keep their version, with **Undo**; the card
      and the **Live** badge move to v{n}. Click **Undo** → the replaced
      version is live again (`automations.deploy.toast.liveAgain`), with no
      second Undo. A live run started before the rollback finishes on its own
      version.
- [ ] `AUTO-F141` · **Open Versions in two sessions; deploy another version
      in the second, then roll back from the first before it refreshes** →
      the first is refused: the toast `automations.deploy.stale.title` names
      who made which version live and when, nothing changed, and **Show
      deployments** switches to the Deployments view.
- [ ] `AUTO-F142` · **Deploy a version whose tests failed (or that no
      longer passes the checks) from its row menu** → no toast; a dialog
      `automations.deploy.refused.title` says why, lists the problems for a
      failed check, and **Open v{n} in the editor** opens it.
- [ ] `AUTO-F143` · **Choose Restore as new version on an older version,
      keep the message, Restore** → the dialog said which version it saves
      and that the ones between stay; the toast says v{next} was saved from
      it, with **Open v{next}**; the new row reads **Restores v{n}**; the live
      version did not change. Restore the latest's twin → info toast, nothing
      saved. With **Make v{next} live right away** ticked → the new version
      goes live too.
- [ ] `AUTO-F144` · **Open the restore dialog, save another version from a
      second session, then Restore** → the dialog names who saved which
      version and offers `automations.restore.staleConfirm`; confirming saves
      on top of it.
- [ ] `AUTO-F145` · **Open the Deployments view** → URL `…/versions?tab=deployments`;
      each row says when, what (Deployed / Rolled back to / was live), the
      version it replaced (— for the first) and who; a version live before the
      history began carries `automations.deployments.recordedHint`. Its menu
      puts a version live again; the live one offers no deploy.
- [ ] `AUTO-F146` · **Choose Download YAML in a version's row menu** → a
      file `{slug}-v{n}.yml` downloads with the Source view's text of that
      version.
- [ ] `AUTO-F147` · **In the automation list, select a row's version count,
      then Version history in its row menu** → both open its Versions tab,
      inside the project shell for a row bound to one project.
- [ ] `AUTO-F148` · **Select a version's row on the Versions tab** → its
      comparison opens (`…/versions/{n}`): the version, its message, who
      saved it and how, **Open in editor**, its deploy or rollback button,
      and **Compare with** set to the version before (`automations.compare.option.previous`),
      with chips counting what was added, removed, changed and renamed.
      Pick the live version in **Compare with** → `?from=` follows and the
      chips change.
- [ ] `AUTO-F149` · **On Graph, compare a version that added, removed,
      changed and renamed nodes** → **Added** boxes are green, **Removed**
      red and struck through, **Changed** amber with what changed at their
      foot, a renamed one says its old name; lines only one version draws
      carry a sign. The switch shows each version's own chart. Select a box
      → its changes open beside the chart (`?node=`); Start shows the inputs
      that changed, End the output, an unchanged box
      `automations.compare.panel.unchanged`.
- [ ] `AUTO-F150` · **On Changes, open each row** → rows sit under Start,
      Nodes, End, Tests and Package data; code, prompts and conditions are
      compared line by line, JSON value by value; **Show on the graph**
      selects the box (Start for an input, End for the output) and a test's
      row offers no such action.
- [ ] `AUTO-F151` · **On YAML** → the two versions' source compared line by
      line; the layout switch shows them side by side on a wide screen.
- [ ] `AUTO-F152` · **Compare a restored copy with its source, v1, and
      `…/versions/99`** → `automations.compare.identical.title` (with
      `automations.compare.identical.messageOnly` when only the message
      differs); the first version's note and a plain chart; a dead end
      naming v99 with **Back to the versions**.
- [ ] `AUTO-F153` · **From the Versions tab, use What changed and Compare
      with live in a row menu, the live card's Compare link, and a
      Deployments row** → each opens the comparison: the row's version
      against the one before, against the live one, the live version
      against the one it replaced, a deploy against the version it replaced.
- [ ] `AUTO-F154` · **Open an older version in the Editor (v2 of v5)** → an
      info band above the canvas reads `automations.editor.oldVersion.title`;
      **Show v5** (`automations.editor.oldVersion.showLatest`) switches to
      the latest, asking first while a draft is open, and **Compare v2 with
      v5** (`automations.editor.oldVersion.compare`) opens that comparison.
      The latest version shows no band.
- [ ] `AUTO-F155` · **Edit that older version and save it** → the band adds
      `automations.editor.oldVersion.draft`; the save dialog reads
      `automations.detail.saveDialog.creates` with "based on v2" and warns
      `automations.detail.saveDialog.notIncluded` with a compare link.
      **Save version** saves v6 without a stale dialog; the canvas shows v6,
      and the picker and the Versions tab mark it
      `automations.versions.basedOn`.
- [ ] `AUTO-F156` · **Open Review changes in the save dialog**
      (`automations.detail.saveDialog.review`) → chips and a change list of
      what the draft changes in the version it started from; a row opens its
      fields before and after. With a version saved through MCP while the
      draft was open, the dialog counts on from that version and the review
      lists none of its changes.
- [ ] `AUTO-F157` · **In the Editor, deploy a version older than the live
      one, then a newer one** → the button reads **Roll back to v**_n_
      (`automations.deploy.rollBack`) or **Deploy v**_n_; a notice confirms
      each deploy with **Undo**, which puts the replaced version back. Deploy
      from a second tab first → the click changes nothing, the notice names
      who deployed which version, and **Show deployments** opens the
      Versions tab on Deployments.
- [ ] `AUTO-F158` · **Open the Version picker** → each row shows its message,
      with **Restores v**_n_ or **Based on v**_n_ at the end of that line
      where they apply, then who saved it and when, its test result and the
      live marker on a second line; every row stays two lines tall, a long
      message cut short. **All versions and changes**
      (`automations.versions.actions.allVersions`) at its foot opens the
      Versions tab.
- [ ] `AUTO-F159` · **On Runs, read the Version column** → each run's
      version is a pill (`automations.runs.versionPill.name`) with a green
      dot on the live version; pointing at it shows the version's message,
      who saved it and when; selecting it opens that version in the editor
      (`?version=N`), not the run, inside the project shell for a project's
      runs.
- [ ] `AUTO-F160` · **On a run's page, open the version pill** → a menu with
      `automations.runs.versionPill.open`,
      `automations.runs.versionPill.compareWithLive` (only while another
      version is live; it opens the newer of the two compared with the
      older) and `automations.versions.actions.history`, each landing on its
      page.
- [ ] `AUTO-F161` · **Compare a run of v3 with a run of v4, where v4 dropped
      a step** → `automationRuns.compare.differs.seeVersions` under What
      differs opens `…/versions/4?from=3`; the chart holds the steps of both
      versions, the dropped one dashed with `flow.compare.absent` and A's
      strip only; each run card's pill names its version, the live one
      marked.
- [ ] `AUTO-F162` · **Open a task's run dialog as a Developer, then as a
      Member** → beside `tasks.run.openFull` the version pill opens that
      version in the project's editor; the Member sees neither link.
- [ ] `AUTO-F163` · **Upload a workflow file that reads a node it does not
      have** → `automations.upload.invalid` with each problem listed as the
      editor's Problems list words it (title, code, how to fix), never the
      server's English sentence; nothing is saved and the dialog stays open
      for another file.
- [ ] `AUTO-F164` · **In the editor of an automation without tests, select
      Tests** (`testResults.button`) → the panel under the canvas opens on
      its Tests tab beside Problems with `automations.tests.empty.title`
      and **Add test**; the address gains `?panel=tests`, and Hide
      (`automations.tests.hide`) closes the panel and returns focus to the
      button.
- [ ] `AUTO-F165` · **Add a test, give it an expected output the
      automation does not return, then Run all** → the new test opens
      beside the canvas on Setup as YAML (`automations.tests.inspector.yaml`)
      with a placeholder for each required input, and the address gains
      `?test=`; after the run its row reads Failed with
      `automations.tests.failure.output`, the Tests button counts the cross,
      and Result shows each differing field as `dataDiff.expect.row.changed`
      ("total: expected …, got …").
- [ ] `AUTO-F166` · **Change the automation, or the test, after a run** →
      the row turns `testResults.status.stale` and keeps its last reason and
      duration; **Run** in the open test runs it alone and replaces the
      result. Editing one test leaves the other tests' results standing.
- [ ] `AUTO-F167` · **With no unsaved changes, Run all on a saved version
      whose tests fail** → the line above the list reads
      `automations.tests.source.checked` (by hand, with the date); reload the
      page and the rows read the version's kept report, its failures in
      words, Result saying `automations.tests.result.fromReport`.
- [ ] `AUTO-F168` · **Write an unknown key into a test's YAML, then open
      Problems and go to the warning** → the Tests tab opens with that test
      on Setup, the YAML focused and the key selected; Source still marks the
      problem at its line.
- [ ] `AUTO-F169` · **Delete a test from its row's menu, then Discard** →
      focus moves to the next row and a screen reader hears
      `automations.tests.deleted`; Discard brings the test back with its
      result.
- [ ] `AUTO-F170` · **Change a test through its Setup form** → Name,
      Description and Input (with `automations.trigger.fixedInput.fillMissing`
      while the run input requires more), a picker each under
      `automations.tests.fields.mocks` and `automations.tests.fields.failures`
      (code steps listed last), and under `automations.tests.fields.expect`
      the output's comparison (Equals / Includes / Not checked), node states,
      actions and `automations.tests.fields.mustFail`; every change lands in
      the draft at once, and `automations.tests.inspector.editYaml` shows the
      same test with every key the form doesn't show still there.
- [ ] `AUTO-F171` · **Go to a problem in a test's name, input or simulated
      output** → the test opens on Setup as a form with that field focused
      (and the place selected inside a JSON field); a key the form doesn't
      show opens the YAML instead, as `AUTO-F168` checks.
- [ ] `AUTO-F172` · **On an automation with a bound trigger and a condition,
      open Add test** → a menu offers `automations.tests.addFrom.blank`,
      `automations.tests.addFrom.trigger` and
      `automations.tests.addFrom.path`, whose submenu lists each path no test
      goes down yet in the Paths list's words; picking a path adds a test
      named after it, simulating the failures the path needs, expecting each
      step's state on it, and saying in its description which condition the
      input must make true or false. Once every path has a test the menu
      reads `automations.tests.addFrom.allTested`, greyed out.
- [ ] `AUTO-F173` · **Run all, then select the coverage line** → the line
      above the list reads how many of the possible paths the tests go down
      (`testResults.coverage`); selecting it opens the canvas's Possible
      paths, each path ending in `automations.paths.clause.tested` with the
      tests' names or `automations.paths.clause.untested`. Editing a test
      drops its path until it runs again.
- [ ] `AUTO-F174` · **Change a node, then Test run and confirm the draft** →
      the dialog asks `automations.detail.runTarget.label` with
      `automations.detail.runTarget.draft` chosen and checks the input
      against the draft's own schema; the run is not listed under Runs, and
      the canvas shows it under `automations.try.unsaved` with how it ended
      and when, playing back like a recorded run. A node's run tab reads
      `automations.editor.inspector.tabs.runTry`. Edit the draft again →
      `automations.try.changed`; `automations.try.again` runs the draft as
      it is now with the same input; `automations.try.clear` brings back the
      last run.
- [ ] `AUTO-F175` · **Run all, then Show on the canvas from a test's row or
      Result** → the strip reads `automations.try.test` with the test's
      name and whether it passed (`automations.try.passed`, or its first
      failure in words); each step the test simulates carries
      `automations.canvas.standIn.mocked` or
      `automations.canvas.standIn.failed`, and a node's run tab reads
      `automations.editor.inspector.tabs.runTest`. `automations.tests.run`
      in the strip runs the test again and shows the new run; switching to
      another version takes it off the canvas.
- [ ] `AUTO-F176` · **In Test run, open `automations.detail.runSource.button`
      and choose a test that simulates a step, then a recent run** → the
      menu groups `automations.detail.runSource.tests`,
      `automations.detail.runSource.runs`, the trigger's input when one is
      bound, and `automations.detail.runSource.other`; each choice replaces
      the input and a screen reader hears
      `automations.detail.runSource.replaced`. The test adds
      `automations.detail.runSource.standIns`, checked: trying the draft
      shows the simulated step with its chip, and choosing the version
      instead reads `automations.detail.runSource.standInsDraftOnly`.
      Reopening the dialog starts from the last choice.
- [ ] `AUTO-F177` · **Save a run as a test: from Add test ›
      `automations.tests.addFrom.run`, from a run page's
      `automationRuns.again.saveAsTest`, and from a try's
      `automations.try.saveAsTest`** → the dialog
      `automations.tests.fromRun.title` expects by how the run ended (a
      succeeded run: `automations.tests.fromRun.expect.equals`; a failed one:
      `automations.tests.fromRun.expect.succeeds` with its help, and
      `automations.tests.fromRun.expect.failsHere`), lists the steps it can
      simulate with code steps off and saying why, and says how many values
      it left out as secrets; from the run page the editor opens with the
      dialog and the address forgets the run. **Add test** opens the new
      test on Setup in the draft, with the run's input.
- [ ] `AUTO-F178` · **Select a node that reads others, open
      `automations.stepTest.menu` › `automations.stepTest.this`, change a
      node's data and run it; then `automations.stepTest.upTo` on another
      node** → the dialog asks for each node it reads under
      `automations.stepTest.usesData` (from the run on the canvas, or
      `automations.stepTest.missing`), the run input only when it reads that,
      and `automations.stepTest.item` for a node that runs per item; the
      strip reads `automations.try.nodeTest`, the nodes read carry
      `automations.canvas.standIn.pinned`, the rest
      `automations.canvas.standIn.leftOut`, and the node's
      `automations.editor.inspector.tabs.runNodeTest` tab shows what it got
      and returned. Testing it again starts from the data last used. Up to
      a node: the dialog `automations.stepTest.upToTitle` runs the draft up
      to it, the strip reads `automations.try.upTo`.
- [ ] `AUTO-F179` · **On a version whose tests fail, deploy it; then change
      the draft, save it and open the version picker** → the deploy is
      refused once: the alert reads `automations.versions.deployRefused` with
      `automations.tests.deployRefused`, the Tests dock opens with focus on
      the first test that failed, and no dialog shows (on a phone the sheet
      opens instead, and its description repeats the refusal for a screen
      reader, which cannot reach the alert behind it); deployed with a draft
      on screen, the dialog `automations.deploy.refused.testsFailing` says it
      instead. While the save runs the tests, its button reads
      `automations.detail.saveVersionTesting`; a screen reader then hears
      `automations.tests.savedWithTests`, and no error toast shows even when
      a test fails. The picker's tests icon and the Versions table's Tests
      column read `automations.versions.testsCount` with
      `automations.versions.testsChecked`.
- [ ] `AUTO-F180` · **Save a run as a test from the Runs tab, and play a run
      back on a phone** → each row of the Runs tab has a menu named
      `automationRuns.list.actions.menu` with **Open run**
      (`automationRuns.list.actions.open`) and, for a developer, **Save as
      test…** (`automationRuns.again.saveAsTest`), which opens the editor on
      Tests with the dialog for that run; a member sees only **Open run**,
      and a click in the menu never opens the row. At 390 px the playback
      bar (`flow.playback.label`) holds its buttons, the time and the speed
      in one row and the scrubber in a row under them, with nothing cut off
      at either edge.
- [ ] `AUTO-F200` · **Use Sync GitHub issues for a project, a repository the
      GitHub connection can read and the label `bug`, with Start it now
      (`automations.templates.startNow`)** → the automation is installed in
      that project, version 1 is live and its schedule is on, every 15
      minutes in your time zone; its one step, the issue sync, names the
      owner, the repository and `bug`, with `credential` empty. After the
      first run the project's Backlog holds a task for each open issue
      carrying `bug`, at most 100, oldest first, and none for a pull request.
- [ ] `AUTO-F201` · **Open that first run, then select Run now twice** → the
      run's output holds one receipt for `owner/repo` with `ok: true`,
      `batch: 1`, `saved: true` and `created` equal to the new tasks; while
      open issues remain, each later run reads the next batch (`batch: 2`,
      `resumed: true`), and once the last issue is read (`drained: true`) the
      run after it starts again at `batch: 1`. No issue gets a second task.
- [ ] `AUTO-F202` · **Close one of the synced issues on GitHub, move its task
      to In progress in Tale, and run the sync again** → the task stays In
      progress with its title, description and assignee, its source card
      reads **Closed at source** (`tasks.sourceIssue.state.closed`), and the
      run's receipt counts `closedUpstream: 1`; the issue on GitHub has no
      new comment, label or state.
- [ ] `AUTO-F203` · **Use Sync GlitchTip issues with a GlitchTip connection,
      its organization and project slugs and an empty search, then resolve
      one issue in GlitchTip and run it again** → the first run makes a
      Backlog task for each unresolved issue, the first seen first, at most
      100; after the second run that issue's source card reads **Resolved at
      source** (`tasks.sourceIssue.state.resolved`) and the task stays where
      it was.
- [ ] `AUTO-F204` · **In the editor, add a second repository and a GlitchTip
      project to the sync step's `sources`, deploy, and select Run now** →
      the run's output holds one receipt per source in the order listed, each
      source's tasks land in the project, and the run shows one step on the
      canvas.
- [ ] `AUTO-F241` · **Use Sync GitHub pull requests for a repository with
      open pull requests by Renovate and by a person, `renovate[bot]` under
      Only pull requests opened by, and Start it now; then use Sync GitHub
      issues for the same repository and project** → after their first runs
      the project holds a task per Renovate pull request, none for the
      person's, and a task per open issue; each pull request task's source
      card is headed `tasks.sourceIssue.headingPull` and links to
      `/pull/<n>`. Merge one Renovate pull request and run both again → its
      card reads **Closed at source** and the task stays where it was; the
      issue sync's receipt counts no pull request (TASK-R64).
- [ ] `AUTO-F242` · **Use Sync GitHub security alerts on a repository with
      code scanning alerts from two tools, Code scanning, From severity High
      and one tool under Only code scanning tools** → the run makes a task
      per open alert of that tool at high or critical (an `error` alert
      included) and none for the other tool or a lower severity; each card is
      headed `tasks.sourceIssue.headingAlert`. Dismiss one alert on GitHub
      and run it again → its card reads **Ignored at source**
      (`tasks.sourceIssue.state.ignored`) (TASK-R65).
- [ ] `AUTO-F243` · **Sync secret scanning alerts on a repository with a
      test secret committed** → the alert's task names the kind of secret
      and the file and line it was found in; neither the task, its source
      card, the run's output nor its trace shows the secret's value
      (TASK-R65).
- [ ] `AUTO-F244` · **Add a Forgejo connection to a Forgejo instance (its
      Instance URL and a token with read:repository and read:issue), then use
      Sync Forgejo issues once with Issues and once with Pull requests for
      one of its repositories** → each run makes a task per open item of
      its kind, linked to `<instance>/<owner>/<repo>/issues/<n>` or
      `…/pulls/<n>` on that instance, with the Forgejo mark on the template
      card; the two automations never refresh each other's tasks (TASK-R64,
      TASK-R66). Name a label the repository does not have under Only items
      with these labels and run the issue sync again → its output's receipt
      reads `discovered: 0`, not the repository's open issues (TASK-R64).
- [ ] `AUTO-F245` · **In the editor, give the GlitchTip source of a sync
      step `taskLabels: ['source:glitchtip']` and the step `failOn: any`,
      revoke the GitHub source's token and select Run now** → the GlitchTip
      issues become tasks wearing `source:glitchtip` (the label is added to
      the project), the run fails naming the GitHub source alone, and its
      GlitchTip receipt reads `saved: true`; remove the label from one task
      and run again → it stays off (TASK-R77, TASK-R78).
- [ ] `AUTO-F184` · **Create a new organization, open Automations, then
      run `tale migrate`** → the list is empty
      (`automations.list.empty.title`) with **Browse templates**
      (`automations.list.empty.browseTemplates`) in the empty state, Home has
      no Inbox view, and the starter project is there; after `tale migrate`
      the list is still empty (PROVN-R9, PROVN-R10).
- [ ] `AUTO-F185` · **Open Create automation › From a template
      (`automations.createMenu.template`), then the catalog's tabs and its
      search** → `automations.templates.title` lists every template Tale
      ships: a tab per category (`automations.templates.all`,
      `automations.templates.categories.inbox`,
      `automations.templates.categories.issues`,
      `automations.templates.categories.codeReview`,
      `automations.templates.categories.tasks`,
      `automations.templates.categories.notifications`,
      `automations.templates.categories.webhooks`) narrows it, and the search
      (`automations.templates.search`) finds a template by its name in your
      language and in English. Each card shows its product's own logo
      (Gmail, Outlook, the IMAP mail server, GitHub, GlitchTip — a lucide
      glyph only for Tale's own templates), its name, when it runs and one
      line; a template whose connector is not connected says
      `automations.templates.connectFirst`, one you already used says
      `automations.templates.inUse` with the count.
- [ ] `AUTO-F186` · **Open Triage the Gmail inbox's preview, then a template
      it works with** → `automations.templates.preview.howItWorks` numbers
      its steps; `automations.templates.preview.whatItChanges` gives each
      line its icon and ends with what it never does;
      `automations.templates.preview.whenItRuns` names the schedule in your
      own time zone; `automations.templates.preview.whatItNeeds` lists Gmail
      as `automations.templates.preview.connected` or
      `automations.templates.preview.notConnected` with
      `automations.templates.preview.connect` opening Settings › Connectors;
      `automations.templates.preview.worksWith` opens Sync Gmail emails'
      preview; `automations.templates.preview.workflow` draws its workflow
      read-only, connector steps wearing their products' icons, and clicking
      a box opens nothing. A template of Tale's own data says
      `automations.templates.preview.needsNothing`.
- [ ] `AUTO-F187` · **Use Daily task digest for a project, sending it to
      yourself, at 09:00, with Start it now (`automations.templates.startNow`)
      on** → one create opens the automation with version 1 live and its
      schedule on at 09:00 in your time zone (the General tab names it, not
      UTC); the list shows it under the name you gave with its icon, and the
      template's card in the catalog now reads `automations.templates.inUse`.
- [ ] `AUTO-F188` · **Use Tell the reviewer with Start it now off** → the
      automation is created as a draft: no version is live and its trigger is
      off; deploying it from the editor offers to turn the trigger on.
- [ ] `AUTO-F189` · **Use Sync Gmail emails while Gmail is not connected** →
      the questions open with `automations.templates.needsConnection` and
      **Open Settings › Connectors** (`automations.templates.connectInSettings`);
      Start it now is off and cannot be switched on, saying
      `automations.templates.startNowNeedsConnection` and
      `automations.templates.startLater`; Create makes a draft.
      Connect Gmail, use the template again → Start it now is on.
- [ ] `AUTO-F190` · **Answer every kind of question: Sync GitHub issues and
      Triage GitHub issues** → a number question steps between its bounds and
      says them (`automations.templates.numberRange`), its field wide enough
      for its largest number; a toggle switches; a
      list takes one item a line (`automations.templates.onePerLine`); a
      credential question lists the credentials in service for its connector
      (`automations.templates.credentialPlaceholder`), picked already when
      there is exactly one; a text question shows an example in its empty
      input. Every answer lands where the template says: the repository in
      the trigger's fixed input on the General tab.
- [ ] `AUTO-F238` · **In the catalog, pick the Notifications tab, search
      "review", scroll down and open Tell the reviewer; select Use this
      template, type a name, go back to the preview, use it again, then go
      back to the catalog** → each step opens at its top; the questions keep
      the name you typed; the catalog is on Notifications with "review" in
      its search, and the Tell the reviewer card has focus.
- [ ] `AUTO-F239` · **With no mail sync deployed, open the Inbox and select
      Browse email templates (`conversations.activate.browseTemplates`)** →
      Automations opens with the template catalog on its Inbox tab
      (`automations.templates.categories.inbox`); the address drops
      `?templates=inbox`, so a reload shows the list.
- [ ] `AUTO-F240` · **Open Summarize the inbox's preview, then use it** →
      What it needs says `automations.templates.preview.needsPartner` above
      the three mail syncs under Works with; the Mailbox question starts empty
      (`automations.templates.choicePlaceholder`), and Create waits until you
      pick the mailbox.
- [ ] `AUTO-F215` · **Use Sync Gmail emails with a connected Gmail mailbox,
      the questions left as they come, and Start it now
      (`automations.templates.startNow`)** → version 1 is live and its
      schedule is on, every five minutes in your time zone; its one step, the
      mailbox sync, reads `backfillDays: 7`, `includeSent: true`,
      `limit: 50` and in `mailbox` the connection picked, or `''` for the
      first choice, Every connected Gmail mailbox, which the question starts
      on. After the first run Home shows the
      **Inbox** view (`home.views.inbox`), the threads of the last seven days
      appear oldest first, an email from before that window does not, and the
      run's output holds one entry under `mailboxes` per connected Gmail
      mailbox.
- [ ] `AUTO-F216` · **Open the first run of a mailbox that received more than
      50 emails in those seven days, then select Run now until a run stores
      nothing new** → the first entry reads `capped: true`, `ingested` at
      most 50 and `resumeFrom` at the newest email it read; each later
      run continues from there, oldest first, and the last one reads
      `capped: false`. The Inbox holds every email once.
- [ ] `AUTO-F217` · **From Gmail itself, write to a customer, let her answer
      and run the sync** → one conversation holds your email as sent by the
      mailbox, followed by her answer. **Reply to her from the Inbox, wait
      for the send and run the sync again** → the reply is in the thread
      once, and the run's entry counts it under `duplicates`.
- [ ] `AUTO-F218` · **With two Gmail connections, use the template again with
      Mailbox set to the second one** → its runs read that mailbox only: one
      entry under `mailboxes`, named after the connection. **Disable that
      connection under Settings › Connectors and select Run now** → the run
      fails at the sync step, its error reading
      `no active gmail mailbox is named "<that name>"`.
- [ ] `AUTO-F219` · **Use the template with Days to read back at 0 and Read
      Sent too off** → the first run lists nothing and its entry's
      `resumeFrom` names the Inbox only; an email arriving after it appears
      on the next run, and nothing older than the first run ever does.
- [ ] `AUTO-F220` · **Use Sync Outlook emails with a connected Outlook
      mailbox and Start it now, then answer a customer from Outlook itself**
      → as `AUTO-F215`, with Sent Items read too: the answer you sent from
      Outlook sits in the customer's conversation before her reply.
- [ ] `AUTO-F221` · **Use Sync emails via SMTP/IMAP with a mailbox connected
      over IMAP and SMTP, and Start it now** → as `AUTO-F215`; the server's
      Sent folder (the one it flags as Sent, else the one the connection
      names) is read too, and the emails the sync read stay unread in a mail
      program on that mailbox.
- [ ] `AUTO-F222` · **Preview each of the three mail syncs in English, German
      and French** → each shows its product's logo, four steps under **How it
      works** (`automations.templates.preview.howItWorks`), three lines under
      **What it changes** (`automations.templates.preview.whatItChanges`) and
      five questions, all in that language; while its mail connector is not
      connected, the card reads **Connect first**
      (`automations.templates.connectFirst`).
- [ ] `AUTO-F230` · **Use Review GitHub pull requests on a repository with
      three open pull requests — one a draft, one opened by the connected
      account — Pull requests per run at 1, and Start it now
      (`automations.templates.startNow`)** → the first run posts one review
      comment, on the third pull request, pinned to its newest commit and
      opening with **Looks ready** or **Changes suggested**; nothing is
      approved or merged. The run's output names it under `reviewed` and
      counts the draft and the account's own under `skipped`. Each later run
      posts nothing until something changes.
- [ ] `AUTO-F231` · **Push a new commit to that pull request, then select
      Run now twice** → the first run reviews it again, pinned to the new
      commit; the second run posts nothing (`skipped` counts it as
      reviewed).
- [ ] `AUTO-F232` · **Set Diff size read to 1000 and push a change of a few
      thousand characters** → the review ends by saying it read the first
      characters of the diff and not the rest. A pull request too large for
      GitHub to show its diff gets the short note that a person reviews it,
      and is not tried again until its next push.
- [ ] `AUTO-F233` · **Use Triage GitHub issues on a repository, sending it
      to yourself, with Issues per run at 3 and Start it now** → the first
      run scores the three most recently changed open issues and, when one is
      ready, sends you one message in Tale with a line per ready issue, most
      urgent first, and a link to the repository's issues; nothing changes
      on GitHub. **Select Run now** → nothing changed, so nothing is scored
      and nothing is sent. **Comment on one issue on GitHub and Run now** →
      only that issue is scored again.
- [ ] `AUTO-F234` · **Use Triage the Gmail inbox with Conversations per run
      at 2 while five threads wait on the team, and Run now three times** →
      each run judges at most two threads; after the third, every thread is
      judged once, each that needs an answer holds one Suggested reply and
      never a second, and a priority a person set stayed as it was.
- [ ] `AUTO-F235` · **Use Daily task digest sending it to yourself, select
      Run now, create two tasks, then move its schedule to the next full
      hour and wait for it** → the first digest lists the tasks of the day
      before; the scheduled one lists exactly the two new tasks, each once,
      oldest first. **Create 55 tasks and select Run now twice** → the first
      digest lists 50 and ends with …, the second lists the other 5, and no
      task is in both.
- [ ] `AUTO-F236` · **Use Create tasks from a webhook, post a JSON body with
      an id and a title twice with a different Idempotency-Key each time,
      the second time with another title** → the project holds one task, now
      with the second title, and the second run's output reads `created:
      false`. **Post a body without an id twice, its keys in another order
      the second time** → still one task for it.
- [ ] `AUTO-F237` · **In the editor, give a For each step whose second item
      fails `onItemError: continue`, and run it** → the step reads as
      succeeded with one of its three items failed, its output holds null in
      that item's place, and the steps after it ran. **Make every item fail**
      → the run fails at that step.

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
- [ ] `AUTO-B6` · **Invalid JSON in a node** — In the inspector, type the
      text `{ not json` into the **Input** code field → the field says
      `automations.editor.invalidJson` and the editor marks where the JSON
      breaks (`codeEditor.syntax.json`); the node is NOT changed (no dirty
      state from the invalid text; Save version keeps the last valid
      document), and the text stays as typed
- [ ] `AUTO-B7` · **Two tabs editing the same automation** — Open the same
      automation's workbench in tabs A and B (both on the latest version). In
      B, edit a node and leave it unsaved. In A, edit another node → **Save**
      → **Save version** (a new version lands; B's version switcher follows
      it live). Now save in B → the save dialog counts on from A's version
      (`automations.detail.saveDialog.creates`) and warns
      `automations.detail.saveDialog.notIncluded`; confirm → The save is
      refused with the dialog **This automation changed while you were
      editing** (`automations.detail.staleVersion.title`) saying who saved
      which version at what time and what B's changes are based on
      (`automations.detail.staleVersion.body`), with
      `automations.detail.staleVersion.seeChanges` opening that version's
      comparison in a new tab; **Discard my changes and reload**
      (`automations.detail.staleVersion.reload`) drops B's draft and shows
      A's version with A's change intact; **Save anyway**
      (`automations.detail.staleVersion.saveAnyway`) appends B's version on
      top instead (A's version stays in the **Version** history, the latest is B's).
      Nothing is ever reverted silently.
- [ ] `AUTO-B8` · **Runs of a project you cannot see** — As an admin, bind an
      automation to a project shared with one team only and start a run there
      that stops on a question; sign in as a Developer outside that team → The
      automation's **Runs** list shows none of that project's runs, the
      project is not named among its bindings, and opening the run's URL
      directly answers **Run not found**; the Developer can neither cancel the
      run nor answer its question (a hidden run answers like a missing one).
      Its live agent transcript and the connector-approval card a paused run
      shows follow the same rule. The same Developer added to the team sees
      the run.
- [ ] `AUTO-B9` · **Save bindings you only partly see** — As an admin, bind
      one automation to a project shared with one team only and to an open
      project, and bind a second automation to the team project alone; sign
      in as a Developer outside that team → The first automation's
      **Projects** shows only the open project; clearing it and saving
      leaves the team project bound (check as the admin). The second
      automation is missing from the Developer's automations list and
      breadcrumb switcher instead of appearing as an organization one.
- [ ] `AUTO-B10` · **Only a schedule or a person starts an agent** — Give the
      automation from `AUTO-F55` a **Webhook** trigger instead and post `{}`
      to its project URL; then remove it from the project under **Projects**
      (`automations.bindings.title`) and **Test run** it live yourself →
      the delivered run fails at the start node with "Only a schedule or a
      person can start a project agent; a webhook or platform-event run
      cannot", and the unbound run fails as "Task not found"; neither adds a
      run to the task's timeline.

- [ ] `AUTO-B11` · **Read-only task viewers cannot control its run** — As an
      admin, prepare separate project tasks whose workflow runs wait on a
      question and on a connector approval. As a Member inside the project's
      audience, open each task from `/dashboard/{org}/projects/{projectId}` →
      the question and approval are readable; submitting the answer or an
      approval decision shows a refusal and leaves the card pending after
      reload. **Cancel** (`tasks.subject.cancel`) is absent. In an Editor's
      second session, answer or decide and reload the Member's task → the
      pending card disappears. On another live task, the Editor can cancel;
      the Member sees the terminal state after reload. Use the task panel:
      Member and Editor seats have no Automations navigation (`AUTO-F53`).
- [ ] `AUTO-B12` · **A project automation whose project is gone keeps a way
      out** — Open an automation from a project's **Automations** tab
      (`AUTO-F57`) and copy the URL. As a Developer outside the project's
      audience, open that URL; then, as an Owner, delete the project and open
      it again → the automation still opens; the trail reads
      `Automations / <automation>` with no project, and **Automations**
      (`automations.title`) opens the organization's list, never a page
      saying the project was not found; below 768 px the back arrow
      (`common.aria.back`) leads there too. Open one of its runs → the
      automation's name returns to the automation under the same URL.
- [ ] `AUTO-B13` · **Stop beats a finishing step** — Deploy an automation
      whose last step is an `llm` step asking for a long answer (a few
      seconds of model time), start a live run, open **Stop the run**
      (`automations.runs.cancel`) and confirm it
      (`automations.runs.cancelConfirm.title`) as the answer is about to
      land; repeat it a few times → each run reads either **Stopped**
      (`automations.runs.status.cancelled`) or **Succeeded**
      (`automations.runs.status.success`) and keeps it after a hard reload;
      Settings › Audit log has exactly one ending entry per run: a cancelled
      action for a Stopped run, a success action for a Succeeded one, never
      both. A Stopped run shows no output.
- [ ] `AUTO-B14` · **Two organizations' approvals on one worker** — With one
      backend worker, deploy in each of two organizations an automation whose
      live step writes a file to a WebDAV share (`type: webdav.write`) that
      the approval policy holds for a person, and start a live run in both at
      the same moment → each run waits on its own approval card
      (`automations.runs.approval.title`) in its own organization, and neither
      fails with a message about a different organization; approving each lets
      that run finish.
- [ ] `AUTO-B15` · **The check fails, the save still works** — Block the
      check's request (`/api/app/automations/…/validate` in DevTools) and
      edit a node → the Problems button reads `issues.checkFailed` and the
      list says `automations.problems.checkFailed`; **Save** stays possible,
      and saving an invalid draft is refused into the Problems list
      (`AUTO-F66`).
- [ ] `AUTO-B16` · **Members check nothing** — Sign in as a Member and open
      `/dashboard/{org}/automations/{slug}/editor` directly → the access gate
      answers instead of the editor and the network log shows no validate
      request; posting a document to the validate route with that session
      answers 403 and saves nothing.
- [ ] `AUTO-B17` · **In Input, type `{"a":1}` one character at a time, then
      replace it with `1`** → the caret never jumps while typing; `1` shows
      `automations.editor.jsonMustBeObject` under the field and the node keeps
      `{"a":1}`.
- [ ] `AUTO-B18` · **Take the network offline and change a reference** →
      Start, End, conditions, frames and the paths list still update; the
      Shape tab says `automations.editor.shape.unavailable`; **Save** works
      again once the network is back.
- [ ] `AUTO-B19` · **Edit a field of a connector node that has a `credential`,
      then save** → Source shows the `credential` key unchanged in the new
      version, and so does every key the inspector has no field for.
- [ ] `AUTO-B20` · **Upload an automation with 40 nodes and 13 conditions** →
      it lays out in about a second, typing in a prompt never stutters, and
      the paths list says `automations.paths.truncated`.
- [ ] `AUTO-B21` · **Retry a test run from a step, and from a step of a
      version that changed** → a test run's retry offers only a test run
      (`automationRuns.replay.mode.mockStaysMock`); on a version that changed
      a reused step the dialog explains
      `automationRuns.replay.refusal.REPLAY_GRAPH_CHANGED.title` and offers
      nothing to start.
- [ ] `AUTO-B22` · **Open a comparison of a run with itself, and with a run
      of another automation** → `automationRuns.compare.same`, then
      `automationRuns.compare.notFound`; neither shows a table.

- [ ] `AUTO-B23` · **History read failure and recovery** — Keep the automation
      detail read successful and fail only its Runs request until retries are
      exhausted; repeat for the Version history request → Each history shows
      an announced error and keyboard-reachable **Try again**
      (`common.errors.tryAgain`), never its successful empty-history message.
      Restore the request and activate retry with Enter → Only that history
      reloads, and focus moves to its heading, not the page body. A successful
      empty response still shows `automations.runs.empty` or
      `automations.versions.empty`. Repeat in EN/DE/FR and check the control's
      visible focus and wrapping in the narrow layout.
- [ ] `AUTO-B25` · **Run all again and again, from two tabs, until the
      bench budget is spent** → `automations.tests.rateLimited` with the
      seconds to wait, Run all disabled with that reason, and Run all working
      again once the wait is over; a draft the checks refuse instead reads
      `automations.tests.invalid` and points at Problems.
- [ ] `AUTO-B24` · **Versions read failures** — Fail the version history
      read, then the deployments read, then the live card's read → each
      shows an announced error with **Try again** in its place, never an
      empty list or "No version is live yet."; retrying with Enter reloads
      only that part.

- [ ] `AUTO-B30` · **Point one of two sources of a sync at a repository that
      does not exist, and run it; then point both at missing repositories and
      run it again** → the first run succeeds: the missing repository's
      receipt reads `ok: false`, `error: not_found`, `saved: false`, and the
      other source's tasks are made. The second run fails at the sync step,
      named as a missing resource, and the trigger counts the failure.
- [ ] `AUTO-B31` · **Name a GitHub connection that does not exist in the sync's
      only source, run it, then empty the name and run it again** → the
      first run fails, its receipt reads `error: credential`; the second run
      reads with the default GitHub connection and continues from the batch
      the source last saved.
- [ ] `AUTO-B32` · **Change the label filter of a sync that is in the middle
      of a pass, deploy, and run it; then put the old filter back, deploy,
      and run it again** → the first run's receipt names the new `filter`
      with `batch: 1` and `resumed: false`, and reads from the first issue
      matching it; the second continues the old filter's pass where it
      stopped (`resumed: true`). No issue gets a second task.
- [ ] `AUTO-B26` · **Use a template under a name another automation has,
      with Start it now on** → `automations.blank.nameTaken` under Name;
      nothing is created, the other automation keeps its versions and its
      trigger, and the template's in-use count does not move.
- [ ] `AUTO-B27` · **Answer a template badly: a repository owner with a
      space, a number past its maximum typed into the field, a list longer
      than it takes** → each question says why in its own words
      (`automations.templates.errors.form`,
      `automations.templates.errors.number`,
      `automations.templates.errors.listTooLong`), and nothing is created
      until they are fixed. The number stays as you typed it, even after you
      leave the field, and Create says why it waits
      (`automations.templates.numberOutOfRange`).
- [ ] `AUTO-B28` · **In an organization an earlier release provisioned (it
      has the shipped mail and GitHub automations), open the catalog** → the
      templates whose automations it has read `automations.templates.inUse`;
      the GitHub and GlitchTip issue importers of that release are not
      counted for Sync GitHub issues or Sync GlitchTip issues, and every one
      of its automations is as it was.
- [ ] `AUTO-B42` · **From a project, open Create tasks from a webhook,
      double-click Use this template; go back, then press Enter twice on it**
      → the questions open with the Name field focused and nothing is
      created either time; only a click or an Enter of its own on Create
      automation (`automations.templates.create`) creates it.
- [ ] `AUTO-B43` · **Use Sync GitHub issues while no GitHub credential is in
      service** → the questions say
      `automations.templates.needsConnectionToCreate`; Start it now says
      `automations.templates.startNowNeedsConnection` and offers no draft
      (no `automations.templates.startLater`); Create stays disabled with
      the same reason as the notice.
- [ ] `AUTO-B44` · **Stop the backend, open a template's preview, start the
      backend again and select Try again** → the workflow's place says
      `automations.templates.loadTemplateFailed` with Try again, never a
      skeleton left loading; Use this template is disabled with the same
      reason; after Try again the workflow is drawn.
- [ ] `AUTO-B45` · **Use Create tasks from a webhook and press Escape while
      Create automation is busy** → the dialog stays, with no Close button
      while it creates, and shows the webhook address
      (`automations.templates.webhookTitle`) once the create answers.
- [ ] `AUTO-B46` · **As an owner, block
      `*/api/app/automations/*/approval-allowances*` in DevTools (Network →
      request blocking) and open the General tab of an automation whose step
      sends a Slack message** → once the read's retries give up (a few
      seconds; a blocked request reads as a lost connection, so the offline
      notice may cover the page meanwhile) Runs without approval
      (`automations.allowances.title`) keeps its hint and shows
      `automations.allowances.loadFailed` with Try again
      (`common.actions.tryAgain`), never `automations.allowances.none` and no
      switch. Unblock, Tab to Try again and press Enter → the Slack · Send
      message switch appears without a reload, and the focus is on the
      section, not lost to the page.
- [ ] `AUTO-B47` · **Block `*/api/app/chat/composer/models*` in DevTools
      (Network → request blocking), open the Editor of an automation whose
      `llm` steps name a model, and select one of those steps** → once the
      read's retries give up (a few seconds; the offline notice may cover the
      page meanwhile) the **Model** picker is disabled with
      `automations.editor.llm.modelsLoadFailed` and Try again
      (`common.actions.tryAgain`) under it, never
      `projects.agents.modelSearchEmpty`; the **Model id** box
      (`automations.editor.llm.modelIdLabel`) holds the step's model and
      takes typing, with no `automations.editor.llm.modelUnlisted`. Click
      Change model (`automations.editor.modelSwap.open`) → With shows the same
      notice, and Use this model (`automations.editor.modelSwap.apply`) stays
      off, its tooltip saying why. Unblock, Tab to Try again and press Enter →
      With lists the served models without a reload and holds the focus.
- [ ] `AUTO-B34` · **With two Gmail connections in the sync, revoke the
      second one's access in its Google account and select Run now; then
      revoke the first one too and run again** → the first run succeeds: the
      second mailbox's entry reads `ok: false` with the provider's error, and
      the first mailbox is read. The second run fails at the sync step, names
      both mailboxes, and the trigger counts the failure.
- [ ] `AUTO-B35` · **Send the mailbox an email whose Date header lies in 2030
      (a mail program with its clock set ahead), then a normal one, and run
      the sync after each** → both appear in the Inbox, the first dated 2030;
      the entry's `resumeFrom` stays at today, and the normal email is
      read on its run.
- [ ] `AUTO-B36` · **Set Emails per pass to 10, let 25 emails arrive, and
      select Run now until a run reads `capped: false`** → each run stores at
      most 10 emails (a second holding more is read whole), the earlier
      entries read `capped: true`, and no email appears twice.
- [ ] `AUTO-B37` · **Drive a Gmail sync into Gmail's rate limit (a backlog of
      thousands, Emails per pass at 100, Run now in quick succession)** → the
      limited run succeeds; its entry reads `rateLimited: true` (with
      `retryAfter` when Gmail named a wait), the emails it read are in the
      Inbox, and the next run continues without a gap or a duplicate.
- [ ] `AUTO-B38` · **Start Review GitHub pull requests by hand with a limit
      of 11 in its input, then Triage GitHub issues and Triage the Gmail inbox
      with 41** → each start is refused before a run exists, its message
      naming the limit's maximum; the same numbers set on the trigger's fixed
      input make the trigger warn when it is saved.
- [ ] `AUTO-B39` · **Give Review GitHub pull requests a token that can read
      the repository but not comment on it, and select Run now** → the
      reviews are written but none can be posted: the run fails at its post
      step and posts nothing, and the next run reviews the same pull requests
      again; after five such runs in a row the schedule turns itself off.
- [ ] `AUTO-B40` · **Give Review GitHub pull requests a token that cannot
      read the repository's pull requests** → the first run fails at its
      first step with GitHub's own refusal, and nothing is reviewed.
- [ ] `AUTO-B41` · **Set Create tasks from a webhook's Delivery key to a
      field the sender never sends, and post two different bodies, then the
      first again** → two tasks: the bodies are told apart by their whole
      content, and the repeated one updates its task.

## Run liveness — chaos recovery (backend, scripted)

Proves on a real backend that a parked run whose scheduled wakes are all lost
is revived by the liveness sweep — the "Running now forever" incident class
(#2883). Drive it via `bunx convex run … --url http://127.0.0.1:3210
--admin-key <key>` (admin key in the platform service's local Convex config);
the chaos door `testing/e2e_chaos:severRunWakes` refuses unless the deployment
sets `TALE_E2E=1` or `TALE_CHAOS_DOORS=1`. Executed end-to-end 2026-07-31 on
the dev stack (cadence froze after sever, sweep poked once, cadence resumed).
Those doors were Convex functions, gone with that backend: mark the five boxes
**ENVIRONMENT** with [`BL-8`](../reference/not-a-finding.md#known-debt).

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

- [ ] `AUTO-A1` · **Canvas semantics** → The canvas is a labelled group
      (**Automation canvas**, `automations.canvas.ariaLabel`) described by
      `flow.canvas.keyboardHelp`; the chart is one Tab stop with roving focus
      (`AUTO-A11`), and every box is a real `<button>` that expands/controls
      the inspector (`aria-expanded` / `aria-controls`). Enter/Space toggles
      the inspector; Escape closes it (not while typing); **Close**
      (`common.aria.close`) is in the panel. Selection never needs a mouse.
- [ ] `AUTO-A2` · **Status not by colour** → Run and node status badges each
      carry an icon AND a word (`automations.runs.status.*`,
      `automations.runs.nodeStatus.*`); the timeline's icon-only variant keeps the
      status word for screen readers (role img + label)
- [ ] `AUTO-A3` · **List and menus** → List rows are links with visible focus
      rings and accessible names; the **Create automation** menu and every panel
      action (Deploy, Save trigger, Save projects) are keyboard operable, with
      disabled reasons exposed, not silent.
- [ ] `AUTO-A30` · **Trigger readiness in words** → With a screen reader
      in the list's table, each **Trigger** cell is read under its column
      header as a state and a kind in words ("Paused", "Schedule"), its
      glyph silent; no state is shown by colour alone or only on hover,
      every word keeps AA contrast in light and dark mode, and at 1280 px
      in English, German and French each state and kind reads whole, never
      cut to an ellipsis.
- [ ] `AUTO-A4` · **Dialogs** → Blank / upload / save-version / run-live
      dialogs: labelled fields (label ↔ control), focus trapped, Escape closes —
      except while a save is in flight, when close waits exactly like Cancel.
- [ ] `AUTO-A5` · **Tab strip semantics** → The strip is a `navigation`
      landmark named `common.aria.automationsNavigation`; tabs are links (the
      active one `aria-current="page"`), keyboard reachable with visible focus;
      below `md` the Editor's action cluster sits in the floating dock, wraps
      within the viewport width and never covers the bottom navigation.
- [ ] `AUTO-A6` · **Interrupted badge and in-doubt card** → On the run of
      `AUTO-F58` and the card of `AUTO-F59`, keyboard only: Tab reaches **Run
      it again**, **Skip it** and **Fail the run** in that order with a
      visible focus ring; Enter opens the two confirmations, focus stays
      inside each and Escape returns it to its button; after a choice focus
      lands on the resolved sentence (`automations.runs.inDoubt.resolved.*`).
      A screen reader reads the badge's word
      (`automations.runs.status.stalled`), not only its icon, and the card's
      title and body; heading navigation reaches the card's title, and a run
      that parks while its page is open is announced once
      (`automations.runs.waiting.in_doubt`). At 390 px wide the actions wrap
      and nothing is cut; at 200 % zoom the card reads without scrolling
      sideways.
- [ ] `AUTO-A7` · **Problems by keyboard** → Tab reaches the Problems
      button after the run verbs and before **Save**; Enter opens the list
      with focus on a row; Up, Down, Home and End move between rows; Enter
      goes to the field; Escape closes the list and focus returns to the
      button.
- [ ] `AUTO-A8` · **Problems to a screen reader** → A node with problems
      announces its counts after its name; a field with a problem announces
      the message as its description, never as an alert; the list's rows
      start with "Error:" or "Warning:" (`issues.srPrefix.error`).
- [ ] `AUTO-A9` · **Problems in every mode** → In dark mode, with reduced
      motion, at 200 % zoom and at 375 px wide: chips, frames and field
      lines keep AA contrast, the list opens without movement under reduced
      motion, and the Problems sheet is usable at 375 px without horizontal
      scrolling.
- [ ] `AUTO-A10` · **The save shortcut with errors** → With the draft from
      `AUTO-F62`, press ⌘S (Ctrl+S) in the Prompt field → the browser's
      "Save page as" dialog does not open, focus moves to **Save** and its
      tooltip says `automations.problems.saveBlocked`; nothing is saved.
- [ ] `AUTO-A11` · **Keyboard only on the canvas** → one Tab enters the chart
      at Start; the arrows follow the lines and move along a row; Home and End
      jump to Start and End; Enter opens the box; Tab leaves to the toolbars;
      a screen reader hears each box's title, catalog line and what it reads;
      the paths list works with the arrows, Enter and Escape.
- [ ] `AUTO-A12` · **Keyboard only in the code editor** → Tab indents; Escape
      then Tab leaves (`codeEditor.leaveArmed`); the legend chip
      (`codeEditor.legend.leave`) shows only after keyboard focus; a condition
      field never traps Tab; Ctrl+Space opens suggestions; the field's problem
      is read as its description.
- [ ] `AUTO-A13` · **At 390 px, in a node's sheet** → Escape closes the
      suggestion list, then arms leaving, then closes the sheet; selecting text
      never drags the sheet; code text is 16 px, so the page never zooms;
      suggestions stay inside the sheet.
- [ ] `AUTO-A14` · **With reduced motion on** → relayouts, refits, the changed
      ring and the paths panel appear without movement; the caret does not
      blink.
- [ ] `AUTO-A15` · **In dark mode, with forced colours, at 200 % zoom, at
      375 px and on touch** → tokens, lines, labels and squiggles stay
      readable; toolbars and sheets stay usable; on the run page one finger
      scrolls the page and two move the chart, with
      `flow.canvas.touchHint` shown once.
- [ ] `AUTO-A16` · **With a screen reader on Start, a condition and End** →
      Start reads its triggers and fields
      (`automations.canvas.start.description`); the condition reads
      `flow.gate.name` then `flow.gate.branches`; End reads what it returns
      and how a run ends. The headings list (the rotor, or H) reads the
      automation's name, **Editor** and the open box's title, with nothing
      missing between them.
- [ ] `AUTO-A17` · **Times of day by keyboard and screen reader** → In
      **Custom times**, keyboard only and with VoiceOver: Tab reaches each
      time's hour and minute (and, in English, AM/PM) in turn, named by its
      row (`recurrence.editor.timeName`) and part (`timeField.hours`,
      `timeField.minutes`); Up and Down step a part, typing 0 9 3 0 gives
      09:30, Backspace empties a part (`timeField.empty`), and Enter saves
      the popover. VoiceOver reads each value as a time, says once that a
      time was added or removed, and reads `recurrence.editor.duplicateTime`
      as the duplicate row's description. Escape closes the popover and
      returns focus to the **Schedule** button.
- [ ] `AUTO-A18` · **The schedule picker at phone width and 200 % zoom** → At
      375 px wide and at 200 % zoom, in light and dark: the presets, Custom
      times with twelve rows, and Custom interval with **Only between** fit
      the screen without horizontal scrolling, the popover's **Save** and
      **Cancel** stay reachable, the **Trigger** section and its **Next
      runs** wrap without horizontal scrolling, and all text keeps AA
      contrast. With reduced motion on, switching **Repeat** and **Cron
      (advanced)** and adding a time show no movement.
- [ ] `AUTO-A19` · **Keyboard and screen reader on a failed run's page** →
      the failure card is a region named by its title; **Run timeline**
      (`flow.playback.label`) is reached by Tab and its slider says where it
      is; the retry dialog and Run again's confirm trap focus and Escape
      closes them; condition verdicts and compare rows are words, not
      colours.
- [ ] `AUTO-A20` · **Template catalog by keyboard and on a phone** → Tab
      from the category tabs and the search box reaches each template card;
      Enter opens its preview and **Use this template**
      (`automations.templates.use`) its questions; every question is
      reachable and labelled, and the back controls
      (`automations.templates.backToPreview`,
      `automations.templates.backToCatalog`) return a step. At 375 px the
      dialog is a sheet whose Create button stays in view, with no sideways
      scroll.
- [ ] `AUTO-A21` · **Versions by keyboard and on a phone** → Tab reaches the
      card's button, the Versions/Deployments switch (arrow keys switch) and
      each row's menu (`automations.versions.actions.menu`); the restore
      dialog traps focus and returns it to the menu's button on close; toasts
      are announced. At 390 px the card's button sits under its text at full
      width and the tables scroll sideways inside their frame, not the page.
- [ ] `AUTO-A22` · **A comparison by keyboard and on a phone** → Tab
      reaches **Compare with**, the Graph/Changes/YAML switch and the list;
      the list is one Tab stop with ↑/↓ between rows and Enter to open one;
      the chart is reachable and a box opens its changes with Enter. At
      390 px the page opens on Changes, the header's buttons wrap under the
      title, and nothing scrolls the page sideways.
- [ ] `AUTO-A24` · **The version pill by keyboard and on a phone** → Tab
      reaches each pill in the Runs table and Enter opens the version; on a
      run's page Enter opens the pill's menu, ↑/↓ move, Escape closes it and
      returns focus to the pill; focus shows the tooltip as hovering does.
      At 390 px the run compare cards keep their pills and nothing scrolls
      the page sideways.
- [ ] `AUTO-A25` · **Tests by keyboard and on a phone** → Tab reaches the
      Tests button, Enter opens the panel on its tab list; Tab moves into the
      list, ↑/↓ walk the rows, Enter opens a test and focus moves into the
      inspector; Escape closes it and returns focus to its row. At 390 px the
      list opens in a sheet; opening a test replaces it with the test's own
      sheet, whose close returns focus to the Tests button, and nothing
      scrolls the page sideways.
- [ ] `AUTO-A26` · **The test form by keyboard** → Tab walks the switch to
      YAML, Name, Description, Input and each picker in reading order; a
      picker opens with Enter or Space and adds the row, whose Remove follows
      it; the comparison switch moves with the arrow keys; every field shows
      its problems under it and focus stays visible.
- [ ] `AUTO-A27` · **The try strip by keyboard and on a phone** → Tab
      reaches `automations.try.again` and `automations.try.clear` in order;
      ⌘⇧Enter (Ctrl+Shift+Enter) in the canvas or the inspector tries
      again; a screen reader hears "Unsaved test: Failed at …" once per
      result. At 390 px the strip wraps under its words and the canvas
      keeps its toolbar.
- [ ] `AUTO-A23` · **The old-version band and the save review by keyboard and
      on a phone** → Tab reaches the band's two actions in reading order and
      the save dialog's **Review changes**, which opens with Enter or Space;
      focus stays in the dialog. At 390 px the band's actions wrap under its
      text, and the review scrolls inside the dialog without sideways
      scrolling.
- [ ] `AUTO-A28` · **A dialog of code fields by keyboard** → In the dialog
      `automations.stepTest.title` the first field has focus; Escape, then Tab
      (`codeEditor.legend.leave`) moves to the next field, then **Cancel**,
      then **Test node**, and Shift+Tab walks back the same way. Focus never
      lands on the dialog itself. At 200 % browser zoom the body scrolls under
      the title while both buttons stay in view.
- [ ] `AUTO-A29` · **The editor and the comparison in a contrast theme** →
      With a Windows contrast theme on (or Chromium's DevTools → Rendering →
      Emulate CSS media feature forced-colors: active), the open tab of the
      page's strip is underlined, **Canvas / List / Source**
      (`automations.canvas.view.label`) shows the chosen option filled, the
      open tab of the dock (**Problems** / **Tests**) and of the test
      inspector (**Setup** / **Result**) is underlined and the others are not,
      the run timeline's track is an outline with the played part solid
      (`flow.playback.label`), and a pressed day in a repeat rule is filled.
      Tab shows an outline round every control that takes focus, the test
      rows and the dock's tabs included. Every label stays readable, and a
      diff's added and removed lines keep their signs.
- [ ] `AUTO-A31` · **The template catalog with a screen reader, by
      keyboard, in both themes** → the tabs are a tab list, each card is one
      button named by its template's name and line, and the product logos
      are silent; in a preview each part is a heading
      (`automations.templates.preview.howItWorks` …), the steps are an
      ordered list and each change is read with what it does first
      (`automations.templates.outcomeKinds.creates`); the workflow is one Tab
      stop; **Use this template** (`automations.templates.use`) and the back
      controls are reachable, the questions open with focus in their Name
      field, the way back to the catalog puts focus on the card you opened,
      focus returns to the opener when the dialog closes, and every text and
      product logo (GlitchTip's included) keeps AA contrast in light and
      dark.
- [ ] `AUTO-A32` · **The template catalog at 375 px and at 200 % zoom** → the
      dialog is a sheet, the cards stack in one column, the tabs scroll
      sideways inside their strip, a preview stacks its parts with the
      workflow last, and the footer's buttons stay in view with no page
      scrolling sideways.

## Performance

- [ ] `AUTO-P1` · **List first render** → Rows or EmptyState visible < 1.5 s
      after navigation (local stack)
- [ ] `AUTO-P2` · **Workbench interaction** → Canvas + panels visible < 2 s on
      a shipped pack; node select → inspector update and live run-status overlays
      feel instant (< 100 ms, no layout jank while a run streams)
- [ ] `AUTO-P3` · **One organization's burst leaves room for another** — With
      one backend worker at the default `WORKER_CONCURRENCY` (5), set
      `AUTOMATION_ORG_CONCURRENCY=2` in `.env` and restart the worker. In
      organization A start ten live runs of an automation whose one step
      works for about 30 seconds; while they run, start one live run in
      organization B → B's run reads **Running**
      (`automations.runs.status.running`) within a few seconds and succeeds
      while most of A's runs still read **Queued**
      (`automations.runs.status.queued`); A's run list shows about two
      **Running** at a time — never five, one per worker slot — and all ten
      succeed. Remove the setting and restart the worker afterwards.
- [ ] `AUTO-P4` · **Fifty tests in the editor** → On a production build, with
      an automation of 50 tests, **Tests** opens the dock with all 50 rows in
      under 200 ms; holding ArrowDown through them leaves no task over 50 ms
      in the browser's Performance panel; **Run all**
      (`automations.tests.runAll`) answers every row within 2 s. A try of a
      10-node draft answers in under 300 ms server time (the run's `ms`) and a
      suite of 20 tests in under 3 s.
