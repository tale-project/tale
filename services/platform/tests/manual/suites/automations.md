# Automations

> **Prefix** `AUTO-` · **Reset** none · **Cost** 119 boxes

Exercise the draft→deploy→version automation surface: each automation is one
workflow document under a name, with an append-only version history, at most
one **deployed** (live) version, a trigger bound to the name, project
bindings, and a record of every run (mock or live). Tested here: the org list
with its create menu (blank or upload a pack), the detail page's tabs —
**Editor** (canvas + node inspector), **General** (trigger + project
bindings), the **Version** history and **Runs** — the run-detail page (status, effects,
agent log, approval/ask cards), and the metrics redirect. The Inbox that deployed email-sync packs open has its own
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

| Surface                   | Route                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Automations (org list)    | `/dashboard/{org}/automations`                                                                                                               |
| Automation detail (alias) | `/dashboard/{org}/automations/{slug}` → forwards to `…/{slug}/editor`                                                                        |
| Editor tab (default)      | `/dashboard/{org}/automations/{slug}/editor` — `?version={n}` pins a stored version on the canvas                                            |
| General tab               | `/dashboard/{org}/automations/{slug}/general`                                                                                                |
| Legacy version history link              | `/dashboard/{org}/automations/{slug}/versions`                                                                                               |
| Runs tab                  | `/dashboard/{org}/automations/{slug}/runs`                                                                                                   |
| Run detail                | `/dashboard/{org}/automations/{slug}/runs/{runId}`                                                                                           |
| Project-scoped list       | `/dashboard/{org}/projects/{projectId}/automations`                                                                                          |
| Project-scoped detail     | `/dashboard/{org}/projects/{projectId}/automations/{slug}` → forwards to `…/{slug}/editor`; carries the same four tabs            |
| Project-scoped run        | `/dashboard/{org}/projects/{projectId}/automations/{slug}/runs/{runId}`                                                                      |
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

**Seeding.** The builtin packs are provisioned from the builtin catalog
(`configs/platform/custom/automations/` when `TALE_CONFIG_BUILTIN_DIR` is
unset) at org creation and on deploy — and they always arrive as **Not
deployed drafts** (`automations.list.notDeployed`) whose triggers are switched
off; nothing runs until someone deploys a version and turns its trigger on. The eight org-scope packs are `gmail-sync-emails`,
`gmail-triage-inbox`, `outlook-sync-emails`, `outlook-triage-inbox`,
`imap-smtp-sync-emails`, `imap-smtp-triage-inbox`, `github-triage-issues`,
`github-review-pull-requests`. Two catches:

- The SETUP.md **mode A** stack pins `TALE_CONFIG_BUILTIN_DIR` to the e2e
  fixture dir, whose automation fixtures are in the retired pre-rewrite format
  (no pack manifest the loader reads) — a mode-A org therefore seeds **zero**
  packs and the list opens on the empty state. Author or upload your material
  (AUTO-F8–AUTO-F11), or run mode B for the shipped packs.
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
- [ ] `AUTO-F3` · **Seed packs into an org** — Run the provisioning command
      (Prerequisites) against an org missing the packs → reload
      `/dashboard/{org}/automations` → The eight org-scope packs appear, every one
      **Not deployed**; re-running the command changes nothing (idempotent); an
      org's own edits/triggers are untouched.
- [ ] `AUTO-F4` · **Row routing** — Click an org-level row, then a row bound
      to exactly one project → Org-level →
      `/dashboard/{org}/automations/{slug}/editor`; single-project-bound →
      `/dashboard/{org}/projects/{projectId}/automations/{slug}/editor` (inside
      the project shell) — a row opens the Editor tab directly, the way a
      project row opens Tasks; bound rows carry a blue project-name chip
      (fallback `automations.list.projectBound`)
- [ ] `AUTO-F5` · **Create menu** — **Create automation**
      (`automations.list.createButton`) on the org and project lists → A dropdown
      with two lanes: **Blank (trigger + agent)**
      (`automations.createMenu.blank`), and **Upload package**
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
      `/dashboard/{org}/automations/{slug}` for a seeded pack → The URL lands on
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
      a selected node's inspector does not grow the canvas); the
      trigger and the project bindings are the **General** tab (AUTO-F51),
      version history in the picker and executions in Runs (AUTO-F35) — none of them panels
      beside or under the canvas.
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
      empty canvas all close the inspector and hand its width back to the
      canvas. A box near the canvas's right edge that the opening inspector
      would cover pans back into view. Canvas height stays
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
      badges — deploying a failed one is refused
      (`automations.versions.deployRefused` alert). Version history rows have no
      **Deploy** control.
- [ ] `AUTO-F18` · **Test run (mock)** — On `qa/manual-probe` (undeployed is
  fine) → **Test run** (`automations.detail.runMock`); when the saved version declares inputs, fill **Run input (JSON)** (`automations.detail.runInput.label`) using **Input schema** (`automations.detail.runInput.schema`) — missing required fields and invalid JSON keep confirmation disabled → A run starts on the
  version on screen; the canvas icon **Show last run** / **Hide last run**
  (`automations.detail.showLastRun` / `automations.detail.hideLastRun`)
  toggles per-node status overlays on the canvas
  (`automations.runs.nodeStatus.*`), and the inspector gains an **In this
  run** section (`automations.editor.runTitle`) with **Resolved input** /
  **Output** (`automations.editor.resolvedInput` /
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
      test results and the **Live** badge, newest first; there is no Versions tab.
      The old `/dashboard/{org}/automations/{slug}/versions` link redirects to
      the editor with history open. **Runs** (`automations.navigation.runs`) →
      `/dashboard/{org}/automations/{slug}/runs`; the active tab carries the
      underline and `aria-current="page"`; the action cluster (Deploy
      / Test run / Run live / Discard / Save) shows on the Editor tab only; Version remains on every tab, and
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
      text `{ not json` into the **Input** field → Notice
      `automations.editor.invalidJson`; the node is NOT changed (no dirty state
      from the invalid text; Save version keeps the last valid document)
- [ ] `AUTO-B7` · **Two tabs editing the same automation** — Open the same
      automation's workbench in tabs A and B (both on the latest version). In
      B, edit a node and leave it unsaved. In A, edit another node → **Save**
      → **Save version** (a new version lands; B's version switcher follows
      it live). Now save in B → The save is refused with the dialog **This
      automation changed while you were editing**
      (`automations.detail.staleVersion.title`) naming the version that
      landed; **Discard my changes and reload**
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

## Performance

- [ ] `AUTO-P1` · **List first render** → Rows or EmptyState visible < 1.5 s
      after navigation (local stack)
- [ ] `AUTO-P2` · **Workbench interaction** → Canvas + panels visible < 2 s on
      a seeded pack; node select → inspector update and live run-status overlays
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
