# Governance

> **Prefix** `GOV-` · **Reset** none · **Cost** 72 boxes

Exercise the org-wide governance controls — content/model defaults, guardrails
(content-safety / PII / moderation), policies & limits (budgets, upload,
retention), security & monitoring (login / password / 2FA / session), the
competence register, legal hold, data-subject requests (DSAR), and the read-only surfaces (feedback
metrics, usage metrics, logs, trash). Most write controls are
admin/owner-gated. **Restore every toggle you flip** — these are org-wide
settings. > Mock-LLM mode is fine for everything except F3's actual
content-safety filtering, which exercises a local chat-filter (no LLM needed)
but requires you to configure a word-list category first, and F17's
real-provider moderation test (mode B).

## Scope & routes

All routes are under `/dashboard/{org}/settings/governance/…`. The bare
`…/governance` index redirects to `content-models`.

| Surface               | Route (sub-path)                          | Page contents (verified)                                                                    |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| Index →               | ``(redirects to`content-models`)          | 307 → `content-models`                                                                      |
| Content & Models      | `content-models`                          | Default models, Model access, Model endpoints for API keys, Vision model, Image generation, Audio transcription model |
| Policies & Limits     | `policies-limits`                         | Budget rules, Upload policy, Retention policy, feature flags, personalization, voice output, confidentiality notice, skill sharing, conversation routing |
| Security & Monitoring | `security-monitoring`                     | Login attempt limits, Password policy, Two-factor policy, Session idle timeout              |
| Competences           | `competences`                             | Competence register: grants (member, competence, status, granted, evidence); **Grant competence**, per-row **Revoke** |
| Guardrails            | `guardrails`                              | Guardrails overview, Custom instructions, Content safety, PII protection, Moderation provider |
| Logs                  | `logs` (+ `?category=`)                   | Tabs: Audit logs · Sign-in blocks · Activity logs · Error logs; Export CSV/JSON             |
| Usage                 | `usage`                                   | Read-only org usage metrics (cards + chart + tables)                                        |
| Legal hold            | `legal-hold`                              | Active holds + Release requests; **Place legal hold**                                       |
| DSAR                  | `data-subject-requests` · `…/{requestId}` | DSAR governance policy + request list; **File request**                                     |
| Trash                 | `trash`                                   | Filterable list of retention-trashed rows; per-row **Restore** (no manual permanent delete) |
| Feedback              | `feedback`                                | **Read-only** Feedback Metrics dashboard (thumbs up/down + arena verdicts)                  |
| Audit-logs (legacy)   | `audit-logs` (+ `?category=`)             | 307 → `logs` (preserves `category`)                                                         |

Group labels in the settings rail: **Content & Models**
(`governance.groups.contentAndModels`) and **Security & Monitoring**
(`governance.groups.securityAndMonitoring`).

## Preconditions

Stack up + signed in per [SETUP.md](../setup.md) as owner/admin. Mock mode (A)
is sufficient. **GOV-F4b (per-API-key budget)** needs at least one API key to
target — create one first under **Settings → API → REST**
(`…/settings/api/rest`, see [settings.md](settings.md) SET-F9); the API-key
select lists every member's live key, read from
`GET /api/app/governance/api-keys` (disabled and expired keys are left out).

**GOV-F40–GOV-F46 and GOV-B15–GOV-B17 (model endpoints for API keys)** call
`/api/v1/openai/…` and `/api/v1/anthropic/…` with API keys minted under
**Settings → API → REST** and need a chat model that a provider credential of
type **API key** or **Environment variable** serves — in mode A, connect the
`e2e-mock` provider's environment credential. Every refusal those boxes judge
is answered before the model gateway is reached, so they run in mode A; a
successful answer needs mode B with the sandbox model gateway running (mode A
ends such a call in 503 `MODEL_API_UNAVAILABLE`).

> **Agent note**: save → reload → assert the **persisted control state**,
> never the toast. Voice output autosaves on toggle (no Save button); the
> other editors have an explicit **Save** (`common.actions.save`). On a
> freshly bootstrapped org the `policies-limits` page logs a benign
> `RETENTION_CONFIG_MISSING` console error (the retention config file isn't
> seeded) — the page still renders; that's an environment seam, not a page
> bug.

## Functional tests

- [ ] `GOV-F1` · **Index redirect** — Open `…/governance` → URL becomes
  `…/governance/content-models`
- [ ] `GOV-F2` · **System prompt persist** — `guardrails` → in the
  **Custom instructions** section (`governance.systemPrompt.title`) flip the
  section Switch ON (aria-label `governance.systemPrompt.enabled`) → type into
  the textarea (placeholder `governance.systemPrompt.instructionsPlaceholder`,
  aria-label = the section title) → **Save** (`common.actions.save`, the
  settings header's global bar) → reload → After reload the section Switch is
  still ON and the textarea still holds the typed text.
- [ ] `GOV-F35` · **Custom instructions reach agents** — On `guardrails`, with
  GOV-F2's **Custom instructions** section ON and holding "End every report
  with the line: Finance desk.", start a project agent on a task, then run an
  automation whose agent node writes a short report → Both the task's agent
  report and the agent node's output end with **Finance desk.**, as a chat
  reply does; switch the section OFF, save, and use a new task and a new
  automation run with fresh conversations → the line no longer appears.
- [ ] `GOV-F2b` · **Voice-output toggle** — `policies-limits` → flip **Voice
  output enabled for this organization**
  (`governance.voiceOutput.enabledLabel`) — it **autosaves** (toast
  `governance.voiceOutput.saved`, no Save button) → reload → After reload the
  switch's `aria-checked` reflects the new state; toggle it back to restore.
- [ ] `GOV-F3` · **Content-safety filter** — `guardrails` → enable **Enable
  content safety** (`governance.contentSafety.enableLabel`); add a category
  (**Add category** `governance.contentSafety.addCategory`) with a banned word
  in **block** mode → Save; then in chat send that exact word → The chat
  message containing the banned word is blocked/masked (a guardrail audit
  event appears under **Recent events**); enabling the toggle **alone** does
  nothing (there is no built-in disallowed-content list)
- [ ] `GOV-F4` · **Budget rule** — `policies-limits` → **Budget rules**
  (`governance.budgets.title`) → **Add rule** (`governance.budgets.addRule`) →
  set Period + **Max tokens** (`governance.budgets.tokenLimit`) / **Max cost
  (USD)** (`governance.budgets.costLimitUsd`) / **Max requests**
  (`governance.budgets.maxRequests`) → confirm → reload → The new rule row
  appears in the Budget rules table and survives reload.
- [ ] `GOV-F4b` · **Per-API-key budget** — `policies-limits` → **Budget
  rules** (`governance.budgets.title`) → **Add rule**
  (`governance.budgets.addRule`) → in the **Add budget rule** dialog
  (`governance.budgets.addRuleDialogTitle`) set **Scope**
  (`governance.budgets.scope`) = **API key** (`governance.budgets.apiKey`);
  the **API key** searchable select appears (placeholder
  `governance.budgets.selectApiKey`, aria-label
  `governance.budgets.selectApiKeyAriaLabel`) → pick a key → set **Max
  requests** (`governance.budgets.maxRequests`) → **Confirm**
  (`governance.budgets.confirm`) → reload → The rule row's **Scope** cell
  reads **ApiKey** (CSS-capitalized `scope`) and its **Target**
  (`governance.budgets.target`) cell shows the chosen key's name and its
  owner, "CI Key · Dana" (falls back to the raw key id if the key is no longer
  held by a member); the row survives reload. **Precondition:** ≥1 API key
  exists (see Prerequisites)
- [ ] `GOV-F4c` · **API-key budget refuses REST** — with the GOV-F4b rule
  saved at **Max requests** 1 → send twice through
  `POST /api/v1/threads/{id}/messages` with that key → The second send answers
  429 `BUDGET_EXCEEDED` with `Retry-After` and a `data` object whose `scope`
  is `apiKey`, and
  nothing is queued; the same person's in-app chat is not refused by the key's
  cap. **Delete the rule after**
- [ ] `GOV-F36` · **Cap a member's key** — As a Developer member, create an API
  key "opencode"; as an Admin, open the GOV-F4b dialog → the **API key**
  select lists the Developer's key as **opencode · ‹their name›** beside the
  Admin's own keys, and no key of someone outside the organization; save a
  rule on it → a REST send with the Developer's key over the cap answers 429
  `BUDGET_EXCEEDED` as in GOV-F4c. With the dialog still open, the Developer
  creates a second key in their own session → it joins the select within
  seconds, no reload. `GET /api/app/governance/api-keys` as a non-admin
  answers 403, and no response carries a key secret.
- [ ] `GOV-F6` · **Feedback metrics** — `feedback` → Read-only **Feedback
  Metrics** dashboard renders (`analytics.feedback.title`); with no feedback
  it shows the empty state **No feedback collected yet**
  (`analytics.feedback.empty.title`). **There is nothing to configure/save
  here.**.
- [ ] `GOV-F7` · **Legal hold** — `legal-hold` → **Place legal hold**
  (`governance.legalHold.actions.placeHold`) opens a dialog; place a hold;
  view **Active holds** (`governance.legalHold.sections.activeHolds.title`);
  request release; a different admin approves under **Release requests**
  (`governance.legalHold.sections.releaseRequests.title`) → The placed hold
  appears in the Active holds table; the release request appears under Release
  requests and requires a **different** admin to approve.
- [ ] `GOV-F8` · **DSAR** — `data-subject-requests` → **File request**
  (`governance.dataSubjectRequests.actions.fileRequest`) opens **File erasure
  request** (`governance.dataSubjectRequests.dialogs.fileRequest.title`); file
  one; open it (`…/{requestId}`); fulfill / deny / extend → The request
  appears in the list with a Status; opening `…/{requestId}` renders the
  detail; status transitions persist on reload.
- [ ] `GOV-F9` · **Security & monitoring** — `security-monitoring` → flip
  **Enable login attempt limits** (`governance.loginPolicy.enabled`); set
  **Failures before lockout** (`governance.loginPolicy.maxAttempts`) and
  **Password policy → Minimum length** (`governance.passwordPolicy.minLength`)
  → **Save** → reload → Each editor's value survives reload (the page is
  login/password/2FA/session policy, **not** alert/anomaly rules)
- [ ] `GOV-F10` · **Usage** — `usage` → Org-wide usage metrics (cards + chart
  + tables) render read-only; empty org shows zeroed cards, no error.
- [ ] `GOV-F11` · **Logs tabs** — `logs` → click each tab: **Audit logs**
  (`settings.logs.auditLogs`), **Sign-in blocks**
  (`settings.logs.blockCounters.tabLabel`), **Activity logs**
  (`settings.logs.activityLogs`), **Error logs** (`settings.logs.errorLogs`) →
  All four tabs render their table/empty-state; the Audit-logs table has
  caption **Audit logs data table** (`settings.logs.audit.tableCaption`); a
  seeded org shows ≥1 audit row.
- [ ] `GOV-F12` · **Trash restore** — `trash` → if a trashed row exists, click
  **Restore** (`governance.trash.restore.label`) and confirm
  (`governance.trash.restore.confirm`); use **Filter**
  (`governance.trash.filterTitle` = "Category") to filter by resource type →
  reload → The restored row leaves the trash list after reload. **NOTE:**
  there is **no manual "permanently delete"** action and **no "Memory audit"
  tab** — rows are auto-purged at the end of their grace window
  (`governance.trash.empty` describes this)
- [ ] `GOV-F13` · **Sandbox quota** — `/dashboard/{org}/settings/sandboxes` →
  **Organization limits** (`sandboxes.limits.title`) → change **Project agent
  sessions**, **Workflow sessions**, and **Render sessions**
  (`sandboxes.quota.budgets.project` / `…workflow` / `…render`) within the
  displayed deployment capacity → Save →
  reload → No page toast on save — the header Save cluster flashes **Saved**
  (`common.actions.saved`) and Save goes disabled again; after reload the
  three fields and allocated/limit summaries hold the saved limits;
  **Total organization sessions** (`sandboxes.limits.total`) shows their sum
  against the deployment capacity — **restore afterwards**. Other organizations
  share the deployment capacity. Bounds: see GOV-B7.
- [ ] `GOV-F14` · **Retention editor** — `policies-limits` → **Retention
  policy** (`governance.retentionPolicy.title`) summary → open the edit drawer
  **Edit retention policy** (`governance.retentionPolicy.drawer.title`) →
  change a category (e.g. **Notifications**,
  `governance.retentionPolicy.notifications.title`) → **Save changes**
  (`governance.retentionPolicy.save`) → diff dialog **Confirm retention
  changes** (`governance.retentionPolicy.diff.title`) → confirm via **Save
  changes** (`governance.retentionPolicy.diff.confirmLabel`) → reload → Toast
  (`governance.retentionPolicy.saved`); after reload the summary reflects the
  new value. Verified live on a fresh org: the editor renders with defaults
  and saves fine (the `RETENTION_CONFIG_MISSING` seam did not bite), but a
  **reduction applies immediately** — the pending banner **A retention
  reduction is pending.** (`governance.retentionPolicy.pendingChange.title`,
  apply-in text `…pendingChange.applyIn`, **Cancel** `…pendingChange.cancel`)
  triggers **only after the operator retention bounds are applied** (GOV-F15's
  first-approval banner sits unapproved on a fresh org). **Restore
  afterwards.**.
- [ ] `GOV-F15` · **Operator bounds banner** — **Env-gated** — needs
  operator-proposed retention bounds in the deployment config.
  `policies-limits` → banner **Operator has proposed retention bound
  changes.** (`governance.retentionPolicy.boundsProposal.title`) or, on first
  approval, **Operator retention bounds need your initial approval.**
  (`…boundsProposal.firstApplyTitle`) with **Apply**
  (`…boundsProposal.applyLabel`) / **Reject** (`…boundsProposal.rejectLabel`)
  / **View details** (`…boundsProposal.detailsLabel`) → open the details
  drawer **Proposed bound changes** (`…boundsProposal.detailsTitle`) → The
  details drawer lists the proposed bounds; **Apply** shows the toast
  (`…boundsProposal.appliedToast`) and the banner clears; **Reject** shows the
  toast (`…boundsProposal.rejectedToast`) and the banner clears — cleared
  state survives reload.
- [ ] `GOV-F16` · **PII protection** — `guardrails` → **PII protection**
  (`governance.pii.title`) → flip **Enable PII protection**
  (`governance.pii.enableLabel`) → pick a **Mode**
  (`piiConfigPanel.modeLabel`: **Tokenize**/**Mask**/**Block**,
  `piiConfigPanel.modeTokenize`/`…modeMask`/`…modeBlock`) → toggle a pattern
  under **Detection patterns** (`piiConfigPanel.patternsTitle`) → reload → The
  panel **autosaves each change** — there is no Save button; every toggle
  fires the toast (`governance.pii.saved`). After reload the enable toggle,
  mode, and pattern selection persist — **restore afterwards** (each restore
  step autosaves too). (The live-preview pane was removed in the AI-backend
  rewrite — the detector no longer runs client-side; mode/pattern persistence
  is the observable contract now)
- [ ] `GOV-F17` · **Moderation provider** — Config = mode A; live test = mode
  B. `guardrails` → **Moderation provider**
  (`governance.moderationProvider.title`) → flip **Enable moderation
  provider** (`governance.moderationProvider.enableLabel`) → preset **Use
  OpenAI Moderation** (`governance.moderationProvider.presetOpenai`) → **Set
  key** (`governance.moderationProvider.setKey`) → review **Category
  mappings** (`governance.moderationProvider.categoryMappings`; **Add category
  mapping** `governance.moderationProvider.addMapping`) → Save → reload; then
  **Test connection** (`governance.moderationProvider.testConnection`) → **Run
  test** (`governance.moderationProvider.runTest`) → Preset shows toast
  **Preset applied** (`governance.moderationProvider.presetApplied`) plus the
  mappings note (`…presetAppliedMappings`); key save shows **API key saved**
  (`governance.moderationProvider.apiKeySaved`); Save shows
  (`governance.moderationProvider.saved`) and the config survives reload —
  **restore afterwards**. **Test connection** pre-fills the default sample
  (`governance.moderationProvider.testDefaultText`); with **no key** the
  result reads **Not configured**
  (`governance.moderationProvider.testNotConfigured`); a real-provider test is
  mode B. The **Endpoint URL** field description explicitly allows HTTP for
  internal/localhost mocks
  (`governance.moderationProvider.endpointUrlFieldDescription`) — verified
  live: **Run test** against `http://127.0.0.1:4141/…` reaches the gateway
  end-to-end (the gateway currently 404s the moderations path, so the verdict
  reads "endpoint URL is wrong" — a passing mode-A verdict needs a moderations
  route in the mock). Caveats: enabling the provider **before** an endpoint is
  configured autosaves and fails with a raw error toast (see Issues #1); a
  stored key can only be **Replaced**, never cleared from the UI.
- [ ] `GOV-F18` · **Agent runs land in Usage and under the cap** — Let a
  project agent (managed credential) finish one task, then open
  **Governance > Usage** → The run's cost appears in the period totals and
  in the per-agent breakdown under the agent's name, attributed to the
  person who started the run; with an org-scoped cost rule set just above
  that total, the next run starts with a smaller allowance and a rule set
  below it refuses the next run at start (see [tasks.md](tasks.md)
  `TASK-B5`) — the refusal names the cap, and nothing in **Sandboxes** shows
  a running turn for it.
- [ ] `GOV-F19` · **Confidentiality notice** — `policies-limits` → in
  **Confidentiality notice** (`governance.dataNotice.title`) turn the switch
  (`governance.dataNotice.enabledLabel`) on — it saves instantly — type a text
  in the **English** language tab (`common.localeTabs.default` beside it) →
  **Save** (`common.actions.save`) → reload → The switch is still on and the
  **English** tab holds the text; the **Deutsch** tab carries the
  **untranslated** pill (`common.localeTabs.untranslated`) and its empty
  field's placeholder shows that English text; a text over 280 characters puts
  a red dot on its tab, keeps **Save** disabled and, once the field is left,
  shows `governance.dataNotice.charLimitExceeded`; turning the switch off hides
  the tabs and turning it on again brings the saved text back. Turn it off to
  restore.
- [ ] `GOV-F20` · **Automation spend lands on the person; triggers on one row** —
  Start a deployed automation that has an agent step by hand from its run
  list and let the run finish; let a schedule or webhook trigger start
  another run of it; open `usage` → In **Per-user usage**
  (`analytics.usage.tables.users.title`) the run you started sits on YOUR
  row — no row reads `user:…` or `api-key:…` — and the trigger's run sits on
  the single **Automations (triggers)** row
  (`analytics.usage.tables.users.automations`), which does not raise
  **Active users** (`analytics.usage.cards.activeUsers`); in **Top
  assistants** (`analytics.usage.tables.topAgents.title`) the automation
  appears under its name and a project agent under its name, never an id.

- [ ] `GOV-F21` · **Trash scrolls its rows, not the page** — Seed >20 trashed
  rows (e.g. delete several contacts), open `trash` at 1280×720 and scroll
  with the wheel → The rows move INSIDE the bordered table while the **Trash**
  heading, its description, the **Filter** button, the column header row and
  the "Showing all N records" footer (`governance.trash.entityLabel`) stay
  put; the settings pane itself never scrolls, and the
  **Restore** button (`governance.trash.restore.label`) is fully visible at
  the right of every row with no horizontal scrollbar. In the console,
  `[...document.querySelectorAll('*')].filter(el => el.scrollHeight >
  el.clientHeight + 4 && ['auto','scroll'].includes(getComputedStyle(el).overflowY))`
  returns exactly ONE element and it is `[data-testid="data-table-scrollport"]`
  — the same frame `logs` renders in.

- [ ] `GOV-F22` · **Grant a platform capability** — Add a second account to
  the org with the **Developer** role and mint it an API key. As owner/admin
  open `competences` → **Grant competence**
  (`governance.competences.actions.grant`) → **Member** = that account,
  **Competence** = **Act for another member**
  (`governance.competences.capabilities.restActAs.label`), **Expires** =
  **Never**, a line of **Evidence** → **Grant** → toast **Competence granted**
  (`governance.competences.toasts.granted`); the row reads **Active** with
  **No expiry** (`governance.competences.statusDetail.noExpiry`), **by** your
  name, and the evidence. `GET /api/v1/me` with the Developer's key now
  answers `capabilities.actAs: true` without any restart.
- [ ] `GOV-F23` · **Qualification with an expiry** — **Grant competence** →
  **Competence** = **Qualification** → **Qualification name** `tax-reviewer`
  → **Expires** = **In 30 days** → **Grant** → the row shows the name alone
  (no capability label) and **Until** the date 30 days out
  (`governance.competences.statusDetail.until`); the list stays on **Active**
  after a reload.
- [ ] `GOV-F24` · **Revoke and read the history** — On GOV-F22's row press
  **Revoke** (`governance.competences.actions.revoke`) → the dialog names the
  member and **Act for another member** → **Revoke** → toast **Competence
  revoked**; the row leaves the Active list. **Filter** → **Status** →
  **Revoked** shows it with today's date under **Revoked**, and pointing at
  the date reads **Revoked by** your name. **Logs** lists
  `competence_granted` and `competence_revoked`; the Developer's `/api/v1/me`
  answers `capabilities.actAs: false` on its next call.
- [ ] `GOV-F34` · **Removal revokes qualifications too** — Grant GOV-F22's
  member a **Qualification** named `removal-check` with **Expires** =
  **Never**, then remove the member from the org (**Members** → row menu →
  remove) → back on `competences` the **Active** view no longer lists the
  member; **Filter** → **Status** → **Revoked** shows both the capability and
  `removal-check` as **Former member**, revoked today. Re-add the same e-mail
  → the **Active** view stays empty for them (no grant re-attaches) and
  **Logs** shows a `competence_revoked` line per grant.
- [ ] `GOV-F25` · **Route by mailbox and address** — With TWO mailboxes on one
  email connector (A and B) and a team T1 and T2, `policies-limits` →
  **Conversation routing** → add three rules: **Any mailbox** · `support@…` →
  T1; mailbox A with no address → T2; mailbox A · `sales@…` → yourself. Mail
  `support+eu@…` at B → the new conversation lands on T1 (a base address
  catches its tag). Mail `jobs@…` at A → T2. Mail `sales@…` at A → you. Mail
  `support@…` at A → T1: an address on any mailbox beats a mailbox alone, as
  the section's precedence line (`governance.conversationRouting.precedence`)
  says. The table's **Arrives on** column names each mailbox by its name.
- [ ] `GOV-F26` · **Route an API app** — With an API app that has synced one
  conversation, add a rule with **Arrives on** set to that app → **Sent to**
  disappears; route to T1 and save. Sync a NEW conversation from the app → it
  lands on T1 and its members can open it, where before only admins could.
  Switch **Conversation routing** off and sync another → it stays unassigned;
  switch it back on → every rule, the API one included, is still there.
- [ ] `GOV-F27` · **Auto assign opens the thread's own rule** — In the Inbox,
  open a thread received on mailbox B, then the assignee picker's **Auto
  assign** (`conversations.header.autoAssignSettings`) → the **Add rule**
  dialog opens with **Arrives on** set to B and **Sent to** set to the
  thread's address. From an API thread → **Arrives on** is its app and there
  is no **Sent to**.
- [ ] `GOV-F28` · **Ordinary numbers survive PII masking** — With **PII
  protection** on in **Mask** mode and **National ID** ticked (no locale
  chosen — every dataset runs), send in a new chat: `order 12345678; date
  2026-09-10; build 20260926; ref 87654321` → The user bubble and the reply
  keep all four values (no `[PASSPORT]`, no `[NZ_IRD]`) and **Recent events**
  (`governance.guardrailsOverview.recentEvents.title`) logs nothing for the
  turn. Then send
  `passnummer 12345678` → the bubble reads `passnummer [PASSPORT]` (the
  stored message is the masked text — reload to confirm) and the event names
  `se-passport`.
- [ ] `GOV-F29` · **Team changes reach the audit log** — As an admin, under
  **Settings > Teams** create a team, rename it, add a second member, remove
  that member again, then delete the team → `logs` → **Audit logs** lists,
  newest first, **Team deleted**
  (`settings.logs.audit.actionLabels.team.deleted`), **Team member removed**
  (`settings.logs.audit.actionLabels.team.member_removed`), **Team member
  added** (`settings.logs.audit.actionLabels.team.member_added`), **Team
  updated** (`settings.logs.audit.actionLabels.team.updated`) and **Team
  created** (`settings.logs.audit.actionLabels.team.created`), every row
  naming you as the actor and the team (its resource type reads **Team**,
  `settings.logs.audit.resourceTypeLabels.team`) by its name; the rename's
  detail shows the old and the new name.
- [ ] `GOV-F30` · **WebDAV writes and branding changes reach the audit log**
  — With a WebDAV client connected as you (`/dashboard/{org}/settings/api/webdav`
  for the details) upload a new file into the hub, upload it again, then
  delete it; then under `/dashboard/{org}/settings/branding` upload a logo,
  change the accent colour and **Save**, and remove the logo → `logs` →
  **Audit logs** shows **Document created**
  (`settings.logs.audit.actionLabels.document.created`), **Document
  updated** (`settings.logs.audit.actionLabels.document.updated`) and
  **Document moved to trash**
  (`settings.logs.audit.actionLabels.document.trashed`) in your name, each
  detail carrying `door` = `webdav`, and **Branding image uploaded**
  (`settings.logs.audit.actionLabels.branding.image_uploaded`), **Branding
  updated** (`settings.logs.audit.actionLabels.branding.updated`, its changed
  fields naming **accentColor** and its detail the old and the new value)
  and **Branding image removed**
  (`settings.logs.audit.actionLabels.branding.image_deleted`) on the
  organization; the trashed file also sits in the client's `.trash/`
  collection and under `trash`.
- [ ] `GOV-F31` · **Trash names chats and lists each category once** — As a
  member, edit a message in a chat you own so it has two versions, then
  delete the chat; as an admin open `trash` → The row's **Name**
  (`governance.trash.column.name`) is the chat's title, not its id, its
  **Type** reads **Chats** (`governance.trash.tab.chatThread`), and the
  edited version is NOT a second row; **Filter** → **Category**
  (`governance.trash.filterTitle`) offers exactly **Chats**, **Documents**
  (`governance.trash.tab.document`), **Temporary files**
  (`governance.trash.tab.fileMetadata`), **Message feedback**
  (`governance.trash.tab.messageFeedback`), **Contacts**
  (`governance.trash.tab.contact`) and **External conversations**
  (`governance.trash.tab.externalConversation`) — no **Chat history**, no
  raw `automationRun`, no category twice; **Restore**
  (`governance.trash.restore.label`) → the chat is back in the owner's list
  with both versions in its branch navigator.
- [ ] `GOV-F32` · **Log counts never claim more than they show** — In an org
  with more audit events than one page (seed a few hundred), open `logs` →
  **Audit logs** (`settings.logs.auditLogs`) → The footer reads **Showing the
  first N audit logs — scroll for more** (the shared data-table footer over
  `settings.logs.audit.entityLabel`), never **Showing all N** while a scroll
  still loads rows; scroll to the end → once nothing more loads the footer
  switches to **Showing all N audit logs**; then **Activity logs**
  (`settings.logs.activityLogs`) → above the
  stat cards a caption reads **Period: Last 7 days. All totals below cover
  this period.** (`settings.logs.activity.periodCaption`); **Filter** →
  **Period** (`settings.logs.activity.period.label`) → **Last 30 days**
  (`settings.logs.activity.period.last30Days`) → the caption and the totals
  change together.
- [ ] `GOV-F33` · **A blocked erasure receipt tells the truth about the
  hold** — Place a custodian hold on a member (GOV-F7), then file an erasure
  request for them (GOV-F8) → the receipt is **Blocked** and its panel reads
  **The subject is on a custodian hold**
  (`governance.dataSubjectRequests.legalHoldBlock.userCustodianHeld`), not the
  generic line. Release the hold (request + second admin + cooldown) and reopen
  the receipt → the status stays **Blocked** but the panel now reads **The
  hold was released — choose Retry to continue the erasure**
  (`governance.dataSubjectRequests.legalHoldBlock.released`); **Retry**
  (`governance.dataSubjectRequests.actions.retry`) re-arms it. With **Require
  dual approval** on, file another request, then turn dual approval off → the
  pending receipt still shows the approval actions with the hint **The
  approval requirement was captured when the request was filed**
  (`governance.dataSubjectRequests.approval.capturedPolicy`).
- [ ] `GOV-F37` · **Skill sharing policy** — As an admin on Policies & Limits,
  find **Skill sharing** (`governance.skillSharing.title`); switch **Share
  skills with the organization** (`governance.skillSharing.label`) through
  **Editors and above** and **Owners and admins only**, saving each through
  the page's Save cluster, then back to **Every member** → A fresh
  organization reads **Every member**
  (`governance.skillSharing.modes.everyone`); each saved mode survives a
  reload; Discard restores the saved one; Logs lists a
  `governance_policy.created` then `governance_policy.updated` row for
  `skill_sharing`; a Member never reaches the page. What each mode does to
  skills is `SKILL-B5` / `SKILL-B6`.
- [ ] `GOV-F40` · **Model endpoints are off by default** — On an org whose
  model access policy never turned them on, with an owner's API key (see
  [settings.md](settings.md) SET-F32), call `GET /api/v1/openai/models`,
  `POST /api/v1/openai/chat/completions` and
  `POST /api/v1/anthropic/v1/messages` (any body) → Each answers 403 with code
  `MODEL_API_DISABLED` in its interface's error shape: the OpenAI paths as
  `{"error": {"message": "…", "type": "permission_error", "param": null, "code": "MODEL_API_DISABLED"}}`,
  the Anthropic path as
  `{"type": "error", "error": {"type": "permission_error", "message": "…", "code": "MODEL_API_DISABLED"}, "request_id": "…"}`
  with a `request-id` header of the same value — never the flat
  `{"error", "code"}` envelope; `GET /api/v1/me` answers
  `capabilities.modelApi: false`; on `content-models` the **Model endpoints
  for API keys** section (`governance.modelAccess.modelApi.title`) shows its
  switch (`governance.modelAccess.modelApi.enabled`) off.
- [ ] `GOV-F41` · **Turn the model endpoints on** — As an admin on
  `content-models`, turn on the **Model endpoints for API keys** switch
  (`governance.modelAccess.modelApi.enabled`) → It saves at once (toast
  `governance.modelAccess.saved`) and is still on after a reload, while
  **Enable model access policy** (`governance.modelAccess.enabled`) keeps its
  own state — neither switch moves the other; **Logs** lists a
  `governance_policy.created` or `governance_policy.updated` row for
  `model_access`; with an owner's or a developer's key, `GET /api/v1/me`
  answers `capabilities.modelApi: true` and `GET /api/v1/openai/models` answers
  200 with `{"object": "list", "data": […]}` whose ids read
  `<providerSlug>/<modelId>`, with `owned_by` the provider slug and `created`
  0 — the ids the **Models** tab lists (SET-F65). Switch it off → the next call
  answers 403 `MODEL_API_DISABLED` without a restart. Switch it back on for
  the boxes below, and restore the state you found at the end of the run.
- [ ] `GOV-F42` · **Model access binds every model call** — With the model
  endpoints on (GOV-F41) and **Enable model access policy** on in
  **Blocklist** mode, add a rule for a Developer account that blocks model M →
  With that account's key, `GET /api/v1/openai/models` no longer lists M's id;
  a chat completion naming it answers 403 `MODEL_API_MODEL_FORBIDDEN` (`param`
  is `model`) and a message on the Anthropic path the same, in its shape,
  while a model the rule leaves alone gets past this check (mode A: 503
  `MODEL_API_UNAVAILABLE` from the gateway step; mode B: 200); a made-up id
  such as `openrouter/no-such-model` answers 404 `MODEL_API_MODEL_UNKNOWN`, and
  so does a listed model's bare catalog id without its provider prefix. The
  owner's key still lists M. Remove the rule afterwards.
- [ ] `GOV-F43` · **Grant Call models over the API** — With the model
  endpoints on, give a second account the **Developer** role, let it create an
  API key under `/dashboard/{org}/settings/api/rest`, then change its role to
  **Member** → The same key's `GET /api/v1/openai/models` answers 403
  `MODEL_API_FORBIDDEN` whose message names **Call models over the API** and
  `tale:models.api`, and `GET /api/v1/me` answers
  `capabilities.modelApi: false`. On `competences` grant it **Call models over
  the API** (`governance.competences.capabilities.modelsApi.label`) → the key's
  next call lists the member's models with no restart, and `GET /api/v1/me`
  answers `capabilities.modelApi: true`; **Revoke** the grant → the next call answers
  403 `MODEL_API_FORBIDDEN` again, and **Logs** lists `competence_granted` and
  `competence_revoked`. What the member sees under **Settings → API** is
  SET-B26.
- [ ] `GOV-F44` · **A budget cap refuses a model call in the interface's
  shape** — Save the GOV-F4b rule on a key at **Max requests** 1, spend that
  request with one REST send (`POST /api/v1/threads/{id}/messages`) or one
  model call with the key, wait a few seconds, then call
  `POST /api/v1/openai/chat/completions` and
  `POST /api/v1/anthropic/v1/messages` with it → Both answer 429
  `BUDGET_EXCEEDED`, the OpenAI one with `type` `insufficient_quota` and the
  Anthropic one with `type` `rate_limit_error`, each carrying `Retry-After` in
  seconds (at most the time until the period resets), `x-should-retry: false`
  and a message naming the cap; the OpenAI Python SDK raises its rate-limit
  error at once instead of retrying. **Delete the rule after**.
- [ ] `GOV-F45` · **Model calls land in Usage as Direct API** — Mode B. Make a
  few chat completions and messages with a Developer's key, then open `usage`
  → In **Top assistants** (`analytics.usage.tables.topAgents.title`) the calls
  sit on one **Direct API** row (`analytics.usage.directApi`) whose request
  count equals the calls made and whose cost is above zero; in **Per-user
  usage** (`analytics.usage.tables.users.title`) they sit on the Developer's
  own row — no row reads `api-key:…`; a GOV-F4b rule on that key and the
  Developer's personal caps under **Settings → Usage** count the same requests.
- [ ] `GOV-F46` · **Input guardrails judge model calls** — On `guardrails`,
  with a **Content safety** category checking user input in **Block** mode,
  send a chat completion whose user message contains its word → 400
  `MODEL_API_GUARDRAIL_BLOCKED` whose message says nothing was sent to the
  model, and **Recent events**
  (`governance.guardrailsOverview.recentEvents.title`) shows the block; the
  same word only inside an assistant turn or a tool result gets past the
  guardrails. Mode B: switch the category to **Mask** → the call answers 200,
  **Recent events** shows the mask, and a model asked to repeat the message
  word for word repeats the placeholder, not the word; a category that checks
  only model output leaves the answer untouched. Restore the guardrails.
- [ ] `GOV-F38` · **Image generation is off until an admin turns it on** — On
  `content-models` in a fresh organization, find **Image generation**
  (`governance.imageGeneration.title`), then **Start agent**
  (`tasks.agentRun.start`) on a task whose description asks the agent to call
  `workspace_status` and list the workspace tools it was granted → The
  section's switch (`governance.imageGeneration.enabledLabel`) is off, no
  **Image model** row (`governance.imageGeneration.label`) shows, and the
  agent's report lists no `generate_image`. Turn the switch on and reload → it
  is still on; **Image model** reads **Automatic**
  (`governance.imageGeneration.automaticLabel`) and the line below names the
  model a turn would use (`governance.imageGeneration.currentModel.preferred`),
  or, with neither an OpenRouter nor an OpenAI credential, the warning
  `governance.imageGeneration.noAvailable` shows; a new run's report now lists
  `generate_image`. Restore: switch it off — env-gated: mark the two runs
  **ENVIRONMENT** without a runnable harness.
- [ ] `GOV-F39` · **Pin an image model** — With **Image generation** on, open
  **Image model** (`governance.imageGeneration.label`), pick a listed model
  (e.g. `OpenAI · gpt-image-1`), **Save** (`common.actions.save`) and reload →
  The list offers only image models the organization's credentials reach,
  never a chat model; the pin survives the reload and
  `governance.imageGeneration.currentModel.pinned` names it. Switch image
  generation off and on again → the same pin is still selected. Restore: pick
  **Automatic**, **Save**, and switch image generation off.

## Boundary & error tests

- [ ] `GOV-B1` · **DSAR cooling-off bounds** — `data-subject-requests` →
  **Cooling-off window (hours)**
  (`governance.dsarPolicy.coolingOffHours.label`) → enter `99` (>72) → Save →
  Validation message **"Cooling-off window must be a whole number between 0
  and 72."** (`governance.dsarPolicy.invalidCoolingOffHours`); save blocked.
- [ ] `GOV-B2` · **DSAR daily-limit bounds** — **Daily limit per admin**
  (`governance.dsarPolicy.dailyLimitPerAdmin.label`) → enter `0` or `99`
  (valid range 1–50) → Save → Validation; save blocked (field documents range
  1–50)
- [ ] `GOV-B3` · **Login-policy attempt bounds** — `security-monitoring` →
  **Failures before lockout** (`governance.loginPolicy.maxAttempts`) → enter
  `0` or `99` (valid 1–50) → Save → Validation message **"Failure threshold
  must be an integer between 1 and 50."**
  (`governance.loginPolicy.invalidAttempts`); save blocked.
- [ ] `GOV-B5` · **Restore toggles** — After GOV-F2/GOV-F2b/GOV-F9, reload →
  Every flipped toggle/field is back to its original value (you restored them)
- [ ] `GOV-B6` · **Budget apiKey target** — `policies-limits` → **Add rule** →
  **Scope** (`governance.budgets.scope`) = **API key**, leave the API-key
  select empty → **Confirm** (`governance.budgets.confirm`) → **Confirm** is
  blocked; the inline error **"Select a target for this scope, or the rule
  will never apply."** (`governance.budgets.targetRequired`) shows under the
  scope row; no rule row is added (reload confirms). The same guard already
  covers the user/team/role scopes.
- [ ] `GOV-B7` · **Sandbox quota bounds** — `/dashboard/{org}/settings/sandboxes` →
  **Project agent sessions** (`sandboxes.quota.budgets.project`) → enter `0` or `501` →
  Save → Validation message **"Must be a whole number between 1 and 500."**
  (`sandboxes.limits.invalidSessions`); save blocked. The same bounds apply to
  workflow and render limits.
- [ ] `GOV-B8` · **A second live grant is refused in the form** — Grant
  GOV-F22's member **Act for another member** again → the dialog stays open
  with **"This member already holds this competence. Revoke the current grant
  before you grant it again."** (`governance.competences.errors.alreadyGranted`);
  no second row appears. Picking another competence clears the message.
- [ ] `GOV-B9` · **The platform namespace is reserved** — **Competence** =
  **Qualification**, **Qualification name** `tale:anything` → the field
  reports **"Names starting with "tale:" are reserved for platform
  capabilities."** (`governance.competences.grantDialog.validation.qualificationReserved`)
  and **Grant** stays disabled.
- [ ] `GOV-B10` · **Long owners in the trash** — `trash` with a trashed row
  whose owner is a long unbroken address (a test account's email will do) →
  The **Owner** cell (`governance.trash.column.owner`) ends in an ellipsis
  inside its own column, never over the **Trashed** badge
  (`governance.trash.status.trashed`); hovering it shows the full owner.
- [ ] `GOV-B11` · **Stale routing rules never break ingest** — Keep a rule for
  mailbox B, then remove mailbox B under **Settings > Connectors** → the row's
  **Arrives on** reads **Removed mailbox**
  (`governance.conversationRouting.removedMailbox`) and editing it keeps that
  entry. Point a rule at a person, then remove them from the organization, and
  mail its address → the conversation still arrives, unassigned. Adding a
  second rule for the same mailbox and address is refused inline
  (`governance.conversationRouting.duplicateRule`).
- [ ] `GOV-B12` · **A member's deep link is refused fast** — Signed in as a
  **member** in a fresh browser, open `policies-limits`, `content-models`,
  `security-monitoring` and `data-subject-requests` by URL → Each renders
  the access-denied message (`accessDenied.organization`) **within 2 s**, the
  same as `/dashboard/{org}/settings/members`; the skeleton never sits
  longer, and the network log shows every admin read refused once (no
  retried 403s) — or, on a warm in-app navigation, not asked at all.
- [ ] `GOV-B13` · **A member never asks for an admin-only policy** — Two
  browser profiles, devtools Network filtered to `governance/policies`. As a
  **member**, open `policies-limits`, `security-monitoring` and
  `content-models` by URL in a fresh tab, and reload each → The access-denied
  message (`accessDenied.organization`) renders, and no request names
  `budgets`, `retention_policy`, `voice_output`, `conversation_routing`,
  `login_policy`, `password_policy`, `two_factor_policy`, `model_access`,
  `vision_model`, `image_generation` or `transcription_model`; no
  `governance/policies` request
  answers 403. As an **admin** in the other profile, open `policies-limits`
  by URL the same way → **Budget rules** (`governance.budgets.title`),
  **Retention policy** (`governance.retentionPolicy.title`), **Voice output**
  (`governance.voiceOutput.title`) and **Conversation routing**
  (`governance.conversationRouting.title`) paint their saved state, and every
  policy read answers 200.
- [ ] `GOV-B15` · **Tokenize mode refuses every model call** — On
  `guardrails` turn **PII protection** (`governance.pii.title`) on in
  **Tokenize** mode (`piiConfigPanel.modeTokenize`), then send a chat
  completion and a message naming a listed model → Both answer 403
  `MODEL_API_GUARDRAIL_UNSUPPORTED` whose message says to set the PII policy to
  mask or block, even when the text holds no personal data; switch the mode to
  **Mask** (`piiConfigPanel.modeMask`) → that refusal is gone. Restore the
  mode.
- [ ] `GOV-B16` · **A failing moderation provider closes the door** —
  Configure the **Moderation provider**
  (`governance.moderationProvider.title`) with an unreachable endpoint
  (`http://127.0.0.1:9/`) and **Fail behavior**
  (`governance.moderationProvider.failBehavior`) for input set to **Fail closed
  (block)** (`governance.moderationProvider.failClosed`), then send a chat
  completion with user text → 503 `MODEL_API_GUARDRAIL_UNAVAILABLE` saying the
  text was not relayed; with **Fail open (pass)**
  (`governance.moderationProvider.failOpen`) the same call gets past the
  guardrails. Restore the provider.
- [ ] `GOV-B17` · **A credential's allowlist narrows the list for everyone** —
  Under **Settings → AI providers** edit the default credential of a provider
  and leave model M out of its **Model allowlist** → For every key holder, the
  owner included, `GET /api/v1/openai/models` drops M, and a call naming it
  answers 404 `MODEL_API_MODEL_UNKNOWN`; put M back → it is listed again.
- [ ] `GOV-B14` · **An unavailable image model refuses, never falls back** —
  With **Image generation** on and a model pinned (GOV-F39), disable the
  default credential of the pinned model's provider on
  `/dashboard/{org}/settings/providers`, reload `content-models`, then **Start
  agent** (`tasks.agentRun.start`) on a task that asks the agent to list its
  workspace tools → The picker still shows the saved pin, marked
  `governance.imageGeneration.savedUnavailable`, above the warning
  `governance.imageGeneration.unavailable`; the run's report lists no
  `generate_image`, and no other model stands in. Restore the credential —
  env-gated: mark the run **ENVIRONMENT** without a runnable harness.

## Accessibility (WCAG 2.1 AA)

- [ ] `GOV-A1` · **Toggles** → Each governance switch (voice output, content
  safety, login limits) is reachable by role `switch` with a name; on/off
  announced via `aria-checked`
- [ ] `GOV-A2` · **Logs table** → The Audit-logs table exposes a caption
  (`settings.logs.audit.tableCaption` = "Audit logs data table") and
  `scope="col"` headers.
- [ ] `GOV-A3` · **Dialogs** → DSAR **File erasure request** and legal-hold
  **Place legal hold** dialogs trap focus; **Close** (`common.aria.close`)
  returns focus to the trigger.
- [ ] `GOV-A4` · **Competences by keyboard** → Tab to **Grant competence**,
  open it with Enter, and complete a grant with Tab, arrows and Enter only;
  each field is announced by its label. Tab to a row's **Revoke** — its name
  says which competence and member (`governance.competences.actions.revokeFor`)
  — confirm the revocation, and focus lands on the register region named
  **Competences**, not on the page body.
- [ ] `GOV-A5` · **Routing rules by keyboard** → Tab to **Add rule**, open it
  with Enter, and complete a rule with Tab, arrows and Enter only: **Arrives
  on**, **Sent to** and **Route to** are each announced by their label, the
  plus-address hint is read with **Sent to**, and an invalid or duplicate
  address is announced as the field's error.
- [ ] `GOV-A6` · **Model endpoints switch by keyboard** → On
  `content-models`, Tab reaches the **Model endpoints for API keys** switch
  after the model access rules; it is a `switch` named **Enable model
  endpoints for API keys** (`governance.modelAccess.modelApi.enabled`), Space
  toggles it and `aria-checked` follows; the section's title and description
  (`governance.modelAccess.modelApi.description`) stand right before it, and in
  `de` and `fr` the description wraps without clipping or horizontal scrolling
  at narrow widths.

## Performance

- [ ] `GOV-P1` · **Governance tab nav** → Warm in-app navigation between two
  governance sub-pages commits in **< 1 s** (loader-prefetched policies; no
  skeleton flash)
- [ ] `GOV-P2` · **Logs first page** → `logs` Audit-logs first page renders in
  **< 2 s** on a freshly seeded org (≤ a few dozen rows)
