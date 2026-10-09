# Governance

> **Prefix** `GOV-` · **Reset** none · **Cost** 93 boxes

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
| Content & Models      | `content-models`                          | Default models, Model access, Model endpoints for API keys, Vision model, Image generation, Standard agent, Audio transcription model |
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
select lists every live key that works in the organization — members' own
keys and the keys made for members, teams, projects and the organization —
read from `GET /api/app/governance/api-keys` (disabled and expired keys are
left out; GOV-F48 covers a rule on such a key).

**GOV-F40–GOV-F47 and GOV-B15–GOV-B17 (model endpoints for API keys)** call
`/api/v1/openai/…` and `/api/v1/anthropic/…` with API keys minted under
**Settings → API → REST** and need a chat model that a provider credential of
type **API key** or **Environment variable** serves — in mode A, the
`e2e-mock` provider's environment credential, wired per
[SETUP.md](../setup.md) §1.A. Every refusal those boxes judge
is answered before the model gateway is reached, so they run in mode A; a
successful answer needs mode B with the sandbox model gateway running (mode A
ends such a call in 503 `MODEL_API_UNAVAILABLE`).

**GOV-F50–GOV-F52 and GOV-B18–GOV-B19 (the standard agent)** need a project
without agents of its own (the docs demo seed's **Customer onboarding
portal**) and, for GOV-B19, a Member; their runs need a runnable harness
(mode B, or the mock gateway with a sandbox) and are env-gated otherwise.
[tasks.md](tasks.md) `TASK-F61` hands such a project's task to the standard
agent.

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
  reads **API key** (`governance.budgets.scopeLabels.apiKey`), its **Period**
  cell the period's label (**Monthly**,
  `governance.budgets.periodLabels.monthly`), and its **Target**
  (`governance.budgets.target`) cell the chosen key's name, "CI Key", with its
  owner, "Dana", on a line beneath; the row survives reload. **Precondition:**
  ≥1 API key exists (see Prerequisites)
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
- [ ] `GOV-F53` · **A team's key spends as the team** — create the Finance
  team's API key (settings.md SET-F78) and a GOV-F4-style **Team** rule on
  Finance with **Max requests** 2; open the GOV-F4b dialog → the **API key**
  select lists the team's key as **‹name› · Team Finance**
  (`governance.budgets.apiKeyOwnerTeam`) and the organization's key as
  **‹name› · The organization**
  (`governance.budgets.apiKeyOwnerOrganization`). Send REST chat messages
  with the team's key until the team's cap is reached → the next send answers
  429 `BUDGET_EXCEEDED` naming the team's cap, while no member's personal
  usage under **Settings → Usage** grew; **Usage analytics** lists the key as
  its own row, **API key of team Finance**
  (`analytics.usage.tables.users.teamKey`), and the active-user count does
  not count it. **Delete the rule after**
- [ ] `GOV-F54` · **A project's budget caps the project** — GOV-F4 → **Add
  rule**, **Scope** = **Project** (`governance.budgets.scopeLabels.project`):
  the **Project** select appears (placeholder
  `governance.budgets.selectProject`, aria-label
  `governance.budgets.selectProjectAriaLabel`) and offers the active
  projects, and **Warning threshold (%)** says everyone chatting in the
  project sees its warning (`governance.budgets.warningThresholdProjectHelp`);
  pick one, set **Max
  requests** 2 → **Confirm** → reload → the row's **Scope** reads
  **Project** and its **Target** the project's name. As a member far from
  any personal cap, send one message in a new chat of that project (its
  reply and the chat's title are the project's two requests) → the next send
  is refused with **Usage limit reached** (`chat.toast.budgetExceeded`) and
  **This project's usage limit has been reached…**
  (`chat.errorHintProjectBudgetExceeded`), while a chat outside the project
  still answers; with the model endpoints on (GOV-F40), the project's own key
  (settings.md SET-F78) is refused at the same cap on
  `POST /api/v1/openai/chat/completions` with 429 `BUDGET_EXCEEDED`. Archive
  the project → the row still names it, marked **Archived**, and **Edit
  rule** keeps it selected while the select offers only active projects
  besides it; delete the project → the row reads **Deleted project**
  (`governance.budgets.projectDeleted`). Every label reads in German and
  French too. **Delete the rule after**
- [ ] `GOV-F55` · **An automation's `llm` step is held to the budget** —
  install an automation with one `llm` node in a new project P1, and
  GOV-F54-style give P1 a **Project** rule with **Max requests** 1. Deploy
  it and choose **Run live** in the editor → it succeeds, and **Usage
  analytics** counts the call under the automation's name in **Top
  assistants**. **Run live** again → the run fails with `failureCode`
  `budget_exceeded`, its detail reading **‹node id›: the llm call was
  refused: Usage limit reached. This project's monthly request limit is
  used up until … — wait until the limit resets, or ask an administrator
  to raise it**, and the provider received no second request. Delete P1's
  rule, install the automation in a second new project P2 as well, and
  give P2 the same rule; let its schedule start a run (it names no
  project, so it is both projects' work) → it succeeds, and the next
  scheduled run is refused naming **This project's** request limit: the
  first one counted toward P2 too, not only toward P1. **Delete the rule
  after**
- [ ] `GOV-F56` · **Improve with AI and a chat's title are held to the
  budget** — read your monthly requests under **Settings → Usage**, then
  GOV-F4-style give yourself a **User** rule with **Max requests** one above
  them. Send the first message of a new chat → the reply comes, and the
  chat is named from the first words of the message, not by a model: the
  reply took the last request, so the naming call was refused, and **Usage
  analytics** books no `thread-title` request for it. In the Inbox, choose
  **Improve with AI** on a draft → it is refused with **Usage limit
  reached** (`conversations.editor.improveLimitReached`), its description
  sending you to **Settings → Usage**
  (`conversations.editor.improveLimitReachedDescription`) — in your
  language, German and French too, never the server's English. **Delete
  the rule after**
- [ ] `GOV-F57` · **A transcription is held to the limits of whoever added
  the recording** — with an OpenAI credential serving `whisper-1`, read
  your monthly cost under **Settings → Usage**, then GOV-F4-style give
  yourself a **User** rule with **Max cost** a cent above it. In a
  project's new chat, add a recording longer than two minutes before the
  first send → its chip reads **Usage limit reached**
  (`chat.transcription.limitReached`), its tooltip saying where to see the
  limit (`chat.transcription.limitReachedHint`), in German and French too,
  and it never retries by itself. In a browser without built-in speech
  recognition (Firefox), dictate into the composer → the toast reads
  `chat.dictation.limitReached`. Paste a YouTube link → refused before any
  download. Delete the rule, choose **Try again**
  (`chat.transcription.retry`) on the chip → it transcribes, and **Usage
  analytics** books **Transcription** under you at 0.6¢ a minute — and the
  project's usage counts it too, though the chat had no thread yet
- [ ] `GOV-F58` · **Knowledge indexing and search wait for a reached limit**
  — with an embedding model set, GOV-F4-style give yourself a **User** rule
  with **Max cost** at your monthly cost under **Settings → Usage**. Upload
  a text document → its badge reads **Waiting for a usage limit**
  (`documents.rag.status.usageLimit`), its dialog explains it in your
  language, German and French too. Search with your API key
  (`POST /api/v1/knowledge/search`) → 429 `BUDGET_EXCEEDED` with
  `Retry-After`. Add a website → its details say a usage limit stopped the
  scan (`websites.viewDialog.embeddingLimitNotice`). Raise the rule's
  **Max cost** to a few cents above your monthly cost and, in a new chat,
  ask about something your documents hold → the reply runs, holding what
  is left, and the assistant says the search did not run because of a
  usage limit, naming it, never that nothing was found. Delete the rule →
  within the hour the document reads **Indexed**, the website's notice is
  gone, and **Usage analytics** lists **Knowledge indexing and search**
  (`analytics.usage.embedding`) under you
- [ ] `GOV-F59` · **A connector call never counts as a request** — read your
  monthly requests under **Settings → Usage**, then GOV-F4-style give
  yourself a **User** rule with **Max requests** two above that figure. In a
  chat you already have (a new chat's title is a request of its own), ask
  the assistant to search your documents for three different things in one
  message → the reply runs, and **Settings → Usage** shows your requests up
  by one, the reply, never by its searches. Send one more message there →
  it runs. Delete the rule
- [ ] `GOV-F60` · **A subscription turn is a request at no cost** — with a
  project agent whose model a provider subscription serves (a Claude or
  ChatGPT subscription credential), GOV-F4-style give yourself a **User**
  rule with **Max cost** at your monthly cost under **Settings → Usage**.
  Start the agent on a task → it runs, and **Usage analytics** books one
  request for it at $0.00, with its tokens. Change the rule to **Max
  requests** at your monthly requests and start it again → the run fails
  at its start with the request limit named, and no subscription account
  is used. Delete the rule
- [ ] `GOV-F61` · **An agent run started with a key counts toward the key**
  — GOV-F4b-style give your own REST key a rule with **Max requests** 1.
  With that key, comment on a task in a project that has an agent
  (`POST /api/v1/projects/{id}/tasks/{taskId}/comments`, a body that
  mentions the agent) → the agent starts working. Once its run has ended,
  comment again the same way → the new run fails at its start with the API
  key's limit named, while you can still start the agent from the task in
  the app. Delete the rule
- [ ] `GOV-F62` · **A project's budget warns in its chats** — GOV-F54-style
  give a project a **Project** rule with **Max requests** 10 and **Warning
  threshold (%)** 10. As a member far from any personal cap, send one message
  in a new chat of that project → the banner above the composer reads
  **Project ‹name›: 8 of 10 request left this month**
  (`chat.budgetRemainingProject`), with **Dismiss** and no **View usage**
  link; a chat outside the project shows no such banner. Edit the rule to
  **Max requests** 2 → in the project's chat the banner turns destructive,
  reading **Project ‹name›: Usage limit reached · resets monthly**
  (`chat.budgetLimitReachedProject`), and Send is blocked, while the chat
  outside the project still sends. Every label reads in German and French
  too. **Delete the rule after**
- [ ] `GOV-F48` · **A rule outlives its key** — Save GOV-F4b-style rules on
  three members' keys, then make each key stop working: the holder revokes
  one under **Settings → API → REST**, an Admin removes the holder of the
  second from the organization, and the third passes its expiry → reload
  `policies-limits` → Every row still names its key and its owner, never a
  bare key id, each beside its status — **Revoked**, **Former member** and
  **Expired** while the expired key is still stored. Once expiry cleanup
  removes that key, it reads **Unavailable**, keeping its name and owner;
  cleanup alone must never make it **Revoked**
  (`governance.budgets.apiKeyStatus.*`). **Edit rule** on one of them: the
  **API key** field still shows that key, with **This key can no longer spend
  in this organization…** (`governance.budgets.apiKeyInactive`) above it, and
  the select offers only live keys besides it. Every label reads in German
  and French too.
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
  **Organization limits** (`sandboxes.limits.title`) → change **Agent
  workers**, **Workflow sessions**, and **Render sessions**
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
- [ ] `GOV-F47` · **A call you break off ends at the gateway and is still
  booked** — Mode B, on a model with a catalog price. With a Developer's key,
  start `POST /api/v1/openai/chat/completions` without `stream` on a model that
  takes a while to answer (ask for a long essay) and stop the client after a
  few seconds (Ctrl-C on `curl`); repeat with `"stream": true` once the first
  chunks have arrived → Within about a second the gateway's log (`docker logs`
  on the `sandbox-llm-gateway` container) records each call as `499`; a
  self-hosted upstream's own log shows the request cancelled, not finished.
  Within a minute both calls sit on the Developer's **Direct API**
  row in `usage` (GOV-F45): the whole answer costs about its prompt, the stream
  its prompt plus the chunks received — never nothing, and never a full answer
  that was not delivered.
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
- [ ] `GOV-F49` · **An erasure deletes the subject's workspaces** — With a
  Member whose own run of a project agent is listed on Sandboxes
  (`SET-F71`'s setup), file and run an erasure for them (`GOV-F8`) → the
  receipt lists **Sandbox workspaces**
  (`governance.dataSubjectRequests.categories.sandboxWorkspaces`) with `1`,
  and the member's workspace is gone from Sandboxes.
- [ ] `GOV-F63` · **A receipt names every category** — after an erasure
  (`GOV-F8`), open its receipt's **Full breakdown across all data
  categories** (`governance.dataSubjectRequests.drawer.fullBreakdownTitle`)
  → every row
  reads a name — **Chats**, **Agent runs**, **Audit log entries** and the
  rest (`governance.dataSubjectRequests.categories.*`) — never a bare pass
  name such as `agentRuns`; German and French too.
- [ ] `GOV-F50` · **The standard agent is on, and automatic** — On
  `content-models` in a fresh organization, find **Standard agent**
  (`governance.standardAgent.title`) → its switch
  (`governance.standardAgent.enabledLabel`) is on; **Agent type**
  (`governance.standardAgent.harnessLabel`) and **Model**
  (`governance.standardAgent.modelLabel`) read **Automatic**
  (`governance.standardAgent.automaticLabel`); **Instructions**
  (`governance.standardAgent.instructionsLabel`) is empty, showing
  `governance.standardAgent.instructionsPlaceholder`; and the section's last
  line (`governance.standardAgent.current`) names the agent type and model it
  runs on for you. **Model** lists only models the chosen agent type can run.
  With no credential serving a model you may use, the alert
  `governance.standardAgent.refusal.noModel` shows instead of that line, with
  a link to **AI providers** (`governance.standardAgent.providersLink`).
- [ ] `GOV-F51` · **Pin the standard agent's model and instructions** — Pick
  a model under **Model** and type `Answer in one sentence.` under
  **Instructions** → `governance.standardAgent.draftHint` shows and nothing
  is saved yet; **Save** (`common.actions.save`) and reload → the pin and the
  text survive, and the last line names the pinned model. Start a task given
  to a standard agent ([tasks.md](tasks.md) `TASK-F61`) → once the run has
  started, the standard agent's row on the project's **Agents** tab names the
  pinned model, and the agent's closing comment is one sentence. Restore:
  **Automatic**, empty **Instructions**, **Save** — env-gated: mark the run
  **ENVIRONMENT** without a runnable harness.
- [ ] `GOV-F52` · **Switching it off stops it at once and keeps the
  choices** — With a model pinned (`GOV-F51`), turn the switch off → it
  saves at once and still reads off after a reload; the note
  `governance.standardAgent.offNote` shows, and **Agent type**, **Model** and
  **Instructions** are hidden. In a project without agents, **Assignee**
  (`tasks.fields.assignee`) offers no **Standard agent**
  (`tasks.assignee.standardAgent`), and **Start agent**
  (`tasks.agentRun.start`) on a task already given to a standard agent
  answers the toast `tasks.agentRun.standardAgent.switchedOff` and queues
  nothing. A comment there that @mentions the standard agent shows
  `tasks.mentionPreview.standardAgentUnavailable` under the comment box and
  saves as a plain mention: no run, the assignee and status unchanged. Turn
  it back on → the pin is still selected, and the same task starts.

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
  **Agent workers** (`sandboxes.quota.budgets.project`) → enter `0` or `501` →
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
- [ ] `GOV-B22` · **A Trash read that fails is not an empty Trash** — Block
  `*/api/app/governance/trash*` in DevTools (Network → request blocking) and
  reload `trash` → after the retries (a few seconds) an alert reads
  **Couldn't load the records in Trash.** (`governance.trash.loadFailed`)
  with **Try again** (`common.actions.tryAgain`) where the table was, never
  **Trash is empty** (`governance.trash.emptyTitle`) with a disabled
  **Filter**; a screen reader announces the alert, and **Try again** pressed
  while still blocked stays focused (busy) and announces the failure again;
  unblock → **Try again** → the list returns without a reload and the focus
  lands on the **Trash** section. With more than 20
  trashed rows, block only `*/api/app/governance/trash?cursor=*` and scroll
  to the end of the list → one notice above the table
  (`governance.trash.refreshFailed`) with **Try again**
  (`common.actions.tryAgain`), the footer reads **the rest couldn't be
  loaded** (`common.pagination.showingLoadedFailed`), never **Showing all**
  (`common.pagination.showingAll`), and Network shows one run of four
  requests for that page; unblock → **Try again** → the remaining rows appear
  below the ones already listed. No toast in either case.
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
- [ ] `GOV-B18` · **A malformed standard agent policy is never read as on** —
  Write `enabled: perhaps` into the organization's
  `governance/standard-agent.yml` under `TALE_CONFIG_DIR` and reload
  `content-models` → **Standard agent** shows the alert
  `governance.standardAgent.invalidPolicy` with its controls enabled, and
  **Start agent** (`tasks.agentRun.start`) on a task given to a standard
  agent answers the toast `tasks.agentRun.standardAgent.unreadable` and
  queues nothing. Turn the switch off and on again (each saves at once) →
  the file parses again, the alert is gone, and the task starts.
- [ ] `GOV-B19` · **A pinned model follows the person who starts the run** —
  Pin a model (`GOV-F51`), then add a **Model access** rule that blocks it for
  the Member role. As a Member, open a task given to a standard agent and
  **Start agent** (`tasks.agentRun.start`) → the toast
  `tasks.agentRun.standardAgent.pinUnavailable` says to ask an Admin, nothing
  is queued, and no other model stands in; as the owner, the same task starts
  on the pinned model. In a project without agents, the Member's
  **Assignee** offers no **Standard agent**, its footer reading
  `tasks.assignee.noAgentsReader`. Restore the rule and **Automatic**.
- [ ] `GOV-B20` · **A slow switch write never undoes a Save beside it** — On
  `security-monitoring`, throttle the network (DevTools **Network**, **Slow
  4G**). Turn on the **Session idle timeout** switch
  (`governance.sessionIdleTimeout.enabled`) and, while it saves, set **Idle
  timeout (minutes)** (`governance.sessionIdleTimeout.minutes`) to `15` and
  select **Save** (`common.actions.save`) → **Save** stays busy until the
  switch's write has landed, then saves; a reload shows the switch on and
  `15`. Set `20` and **Save** again → the switch stays disabled until the
  page has read the policy back, and turning it off after that keeps `20`.
  Restore: throttling off, the switch off.

- [ ] `GOV-B21` · **Fractional login delays survive unrelated edits** — On
  `security-monitoring`, enable **Login attempt limits** and record the current
  schedule and attempt limit. Set **Backoff schedule (seconds)**
  (`governance.loginPolicy.backoffSchedule`) to `0.4, 1.5`, then **Save**
  (`common.actions.save`) and reload → the schedule still reads `0.4, 1.5`.
  Change only **Failures before lockout** (`governance.loginPolicy.maxAttempts`)
  and **Save**, then reload → the schedule still reads `0.4, 1.5`, never
  `0, 2`. Repeat with `1, 2` → whole-second delays remain unchanged too.
  Restore the original schedule, attempt limit and enabled state.

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
