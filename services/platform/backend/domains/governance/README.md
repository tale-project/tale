# Governance — the usage ledger and its billing subject

Who a billable call is booked under, where that rule lives, and what enforces it. Read this
before adding a lane that spends on the organization's behalf or a reader that folds spend.

The ledger is `app.usage_ledger` (`db/migrations/0020_governance_usage.sql`): period buckets —
daily, weekly, monthly — per (organization, user, agent, model, provider, API key, connector
operation). `incrementUsageLedger` in [`service.ts`](service.ts) is its one writer; the usage
page, the budget gate, erasure and retention are its readers. Beside it, `app.project_usage`
(`0155_project_usage.sql`) sums the same bookings per project, for a `project` budget rule
(rule 9); the same writer fills it.

## Rules

1. **One ledger.** Every billable call books into `app.usage_ledger` and nowhere else. The
   per-turn `app.usage_events` table the chat lane used to write beside it had no reader; it is
   write-retired and goes in a later release (see _Not yet_).
2. **`user_id` is a bare user id** — the person responsible for the spend — or the one sentinel
   `__automation__` (`lib/shared/constants/usage.ts`, `AUTOMATION_SUBJECT_ID`) for spend nobody is
   responsible for. It never carries a door, a prefix, a session or a system marker. A team's, a
   project's or the organization's own API key (`domains/api_keys/owners.ts`) is the one subject
   that is a `"user"` id but no person: it books under the identity it acts as, the
   `principal_user_id` of its `app.api_key_owners` row.
3. **The person is who started the work.** A chat turn spends for the member who sent it (or the
   member a REST key acts for). A managed agent turn spends for the person who started the run —
   from a task, a comment, the REST API or the MCP endpoint — and a retry continues its starter's
   kick. A run a trigger (schedule, webhook, event) started has no person: it books under
   `__automation__`. A project agent run an automation step or another agent started
   (`domains/tasks/delegated-start.ts`) continues the starter of the run that asked: that run's
   person, or `trigger:<id>` for a schedule's chain, which books under `__automation__` too.
4. **A keyed start books to its key too.** When an API key authenticated the chat send or the run
   start, the ledger row carries `api_key_id` beside the person, so the key's own budget caps see
   the spend the docs promise them. Run rows keep the key in `automation_runs.api_key_id`
   (`0110_run_billing_subject.sql`); the reservation stamps it on `sandbox_session_ops`, and an
   unsettled op's hold counts against the key's caps as well as the person's.
5. **`agent_slug` is a stable identifier, never a display name.** A chat assistant books under its
   slug, a project agent under its id (`project_agents.id`), an automation under its name (a
   unique path per organization), the system lanes under their sentinels (`__tts__`,
   `__transcription__`, `__connector__`, `__direct_api__`, `thread-title`). Readers resolve names
   at read time (`usage-metrics.ts` resolves project agents).
6. **One resolver per lane, and only one reader of the door format.** The chat lane books
   `request.userId` (`lib/chat/turn.ts`, `recordUsage`). Managed turns — reservation
   (`domains/sandbox/turn-budget.ts`) and settlement (`domains/sandbox/spend-settlement.ts`)
   alike — resolve their subject through `resolveSessionOpAttribution`
   (`domains/sandbox/op-attribution.ts`). A request through the model endpoints for API keys
   (`/api/v1/openai`, `/api/v1/anthropic`) has no run: its door names the subject — the key holder,
   `__direct_api__`, the key — to the same reservation (`subject`), which stamps it on its op row
   (kind `model-api`), and the settlement's resolver reads that stamp. The same subject decides whom a task turn's connector
   calls act for: the connectors bridge (`domains/connectors/bridge-routes.ts`) resolves it on
   every call from the live run on the exec the turn's token names (`scope.connectorCaller`),
   so a call is booked, audited and run for one person. An automation's `llm` step — a
   subautomation's included, which runs as one step of its parent's run — spends outside any
   session: its run is its subject, through `resolveAutomationRunAttribution` — the mapping the
   run's agent turns resolve through too — and `domains/automations/llm-metering.ts` measures that
   subject before each call and books the call after it. Every lane that measures a run's subject
   builds it with `loadAttributedBudgetSubject` (`attributed-subject.ts`). A call the platform
   makes straight to a provider for an `llm` step, a chat title or the Inbox's Improve is a direct
   call (`direct-calls.ts`): it is recorded on an op row (kind `direct-call`) under the subject its
   lane names — holding its worst case while a budget binds, nothing otherwise — and its cost
   booked under that row's stamp, once. A transcription is one too — an uploaded recording's,
   held at its whole length, and a dictation's — priced per audio minute from the catalog
   (`files/transcription-metering.ts`); a video link's download is refused at the door while a
   limit is reached (`directCallBlocked`), and the transcription it leads to holds its own. Voice
   output holds on its pending chunk row instead; embeddings are not counted yet (spec, Not yet). A run's `started_by` is
   parsed only by `parseRunStarter` (`lib/shared/run-starter.ts`); a `split(':')` on a starter
   anywhere else is a defect.
7. **Door fields keep their format.** `automation_runs.started_by` stays `user:<id>` /
   `api-key:<userId>` / `trigger:<triggerId>` (the REST contract publishes it on `startedBy`;
   erasure and the trigger fire ledger read it) and `project_agent_runs.started_by` stays a bare
   id — or `trigger:<triggerId>` for a run a schedule began, directly or through a delegation from
   such a run (migration 0139). Fix attribution at the ledger boundary, never by rewriting a door
   field.
8. **Readers assume the rules above.** The usage page looks `user_id` up in `"user"` and labels
   the sentinel; the budget gate sums a member's rows by bare id and a team's by its members' bare
   ids; erasure deletes the subject's rows by bare id (and the legacy door forms); an impersonal
   subject (`OrgBudgetSubject.impersonal`) is measured against the organization's caps and, when
   keyed, the key's — never a personal or role cap, and a team's cap only for a team's own key
   (`loadBudgetSubject`), whose spend a team cap counts beside its members' (the key's binding,
   `o.team_id`, never the ledger's `team_id`). The usage page shows a key identity as its own
   labelled row and no active user.
9. **Spend in a project is the project's too.** Work that belongs to a project — a chat turn or
   title in one of its threads, an answer read aloud there, the chat's tool calls, a turn of one
   of its agents or of an automation run in it (and that turn's images), a model call of such a
   run's `llm` step, a call made with the
   project's own API key — names its projects to `incrementUsageLedger` (`projectIds`), which
   books the same figures into each project's buckets, `app.project_usage`, beside the ledger
   row. An automation run that names no project belongs to every project its automation is bound
   to — the set its language context, skills and session reach already use — so it counts toward
   each, as a member's spend counts toward each of their teams; an automation bound to none
   spends in no project. A `project` budget rule (`projectRules` in the budgets file) is measured
   against its project's buckets, whoever spent: a project cap binds an impersonal subject too,
   and work in several projects must fit each one's cap. A hold in flight counts toward its
   projects through its thread (`app.generations` and a pending voice chunk,
   `app.tts_audio_chunks`, → `app.thread_metadata.project_id`) or the projects its reservation
   stamped (`sandbox_session_ops.project_ids` — a managed turn's, a model request's, a direct
   call's). A project's key spends in
   its project whatever it calls (`loadBudgetSubject`). A recording's transcription is in the
   project of the chat it was added to, and a video link's door check reads that project too.

## Lanes (the write side)

| Lane | Resolver | `user_id` | `agent_slug` | `api_key_id` | project |
| --- | --- | --- | --- | --- | --- |
| Chat turn (App, REST) | `lib/chat/turn.ts` → `createPgUsageLedger` | the sender / the member acted for | assistant slug | the REST key | the thread's |
| Chat title | `core/chat/generate_title.ts`, held and booked as a direct call (`domains/chat/title-meter.ts`) | the thread's member | `thread-title` | the key that sent the message | the thread's (`chat.generate_title` job) |
| Inbox Improve with AI | `domains/conversations/improve.ts`, held and booked as a direct call | the writer | `inbox-improve` | — | — |
| Project agent turn (`task-agent` op) | `resolveSessionOpAttribution` | `project_agent_runs.started_by` (bare); `__automation__` for `trigger:` | `project_agents.id` | — | `project_agent_runs.project_id` |
| Automation agent turn (`workflow-agent` op) | `resolveSessionOpAttribution` | the person `started_by` names; `__automation__` for `trigger:` | automation name | `automation_runs.api_key_id` | `automation_runs.project_id`, else every project the automation is bound to |
| Automation `llm` step | `resolveAutomationRunAttribution` (`domains/automations/llm-metering.ts`), held and booked as a direct call | the person `started_by` names; `__automation__` for `trigger:` | automation name | `automation_runs.api_key_id` | `automation_runs.project_id`, else every project the automation is bound to |
| Agent image generation (`generate_image`, one row per billed request, no tokens) | `resolveSessionOpAttribution` on the op the turn's token names (`domains/sandbox/image-generation.ts`) | the turn's person, as above; `__automation__` for `trigger:` | the turn's agent id or automation name | the run's key, as above | the run's, as above |
| Voice output | `domains/tts` (held on its pending chunk row) | the requester | `__tts__` | — | the thread's |
| Transcription (an upload, a video link's audio, a dictation) | `domains/files/transcription-metering.ts`, held and booked as a direct call | the uploader — a retry continues their upload — or `__automation__` for a file nobody added; the dictating member | `__transcription__` | — | the chat's the recording was added to |
| Model endpoint request (`model-api` op) | `domains/model_api/metering.ts` stamps the op; settlement reads the stamp | the key holder | `__direct_api__` | the API key | a project's key's project |
| Connector call | `recordConnectorUsage` | the caller | optional | — | the chat's, for the assistant's tools |

## Readers

| Reader | What it assumes |
| --- | --- |
| Usage page (`core/governance/get_org_usage_metrics.ts`, `usage-metrics.ts`) | `user_id` is a `"user"` id or the sentinel, folded through `usageLedgerSubject` so a legacy door form (`user:<id>`, `api-key:<id>`) is the person's row and `trigger:<id>` the sentinel's; the sentinel is a labelled row and no active user; project agent slugs resolve to names; a row is a transcription or speech row only when its seconds or characters are `> 0` (the upsert once stamped `0` on every second request) |
| Budget gate (`budget-gate.ts`, `budget-reservations.ts`) | personal caps sum `user_id = ANY(<bare id>, user:<id>, api-key:<id>)` (`usageLedgerSubjectForms`), team caps the members' ids — and the identities of the team's own keys — under the same forms, key caps `api_key_id`, a project cap `app.project_usage`; an impersonal subject has no personal bucket |
| Member's own view (`/my/budget-status`, Settings > Usage) | the same `usageLedgerSubjectForms(<own id>)` as the gate |
| Erasure (`domains/erasure/service.ts`) | the subject's rows are `user_id IN (<id>, user:<id>, api-key:<id>)` — the two door forms cover rows booked before rule 2 held |
| Retention (`domains/retention/service.ts`) | buckets age by `updated_at_ms`; a legal hold protects a member's rows; a project's buckets age on the same clock and name no member |

## Guards

- `lib/shared/run-starter.test.ts` — the door parser.
- `domains/sandbox/op-attribution.test.ts` — the subject per lane, sentinel, key, stamp fallback,
  and a project agent run a schedule began.
- `domains/sandbox/turn-budget.test.ts`, `spend-settlement.test.ts` — reservation and settlement
  book the same subject and the key; a trigger run is impersonal.
- `core/automations/llm_call.test.ts`, `domains/automations/llm-metering.test.ts` — an
  automation's `llm` step is held before each call, refused with `budget_exceeded` when a cap has
  too little room, and booked under its run's subject after it, an empty reply included.
- `domains/governance/direct-calls.test.ts` — a direct call holds its worst case whole (a row
  that holds nothing while no budget binds), books once under its op row's stamp (a call past
  its deadline too, and under the pseudonym once its person was erased), and its lost hold
  lapses; `domains/erasure/service.lifecycle.test.ts` — erasure deletes a person's finished
  direct-call rows and pseudonymises the running ones before the ledger pass; `domains/chat/title-meter.test.ts`, `core/chat/generate_title.test.ts`,
  `jobs/task-list.generate-title.test.ts`, `domains/conversations/improve.test.ts` — the title and
  Improve calls are held under their member (and key) and pick only models the member may use;
  `domains/tts/service.project-budget.test.ts` — a voice chunk holds its estimate under the
  admission lock and books audio it paid for; `domains/chat/store.test.ts`, `lib/chat/turn.test.ts`
  — a reply's later rounds raise its hold; `core/file_metadata/transcribe_audio.metering.test.ts`,
  `domains/files/transcription-metering.test.ts` — an upload's transcription holds its whole length
  under its uploader and the chat's project, is refused (never retried) at a limit, books the
  minutes transcribed (a failed attempt's finished chunks too), and a dictation is refused with
  429 before the provider hears it; `domains/video_links/service.inflight_cap.test.ts` — a video
  link starts no download at a limit.
- `domains/model_api/metering.test.ts` — a model-endpoint request reserves under the key holder
  with the key and books the gateway's figure under the person, `__direct_api__` and the key.
- `domains/sandbox/image-generation.test.ts` — an agent's image is admitted and booked under its
  turn's subject, against every hold in flight (the turn's own allowance included) and the
  turn's allowance, and a trigger run's image is impersonal; `image-generation.integration.ts`
  proves racing admissions on the real schema.
- `core/tasks/agent_run_host.connector_caller.test.ts`, `domains/connectors/bridge-routes.test.ts`
  — a task turn's connector calls act for the run's starter while the run is live, and for
  nobody after it ends or when a trigger started it; `jobs/task-list.agent-retry.test.ts` — an
  auto-retry keeps the failed run's starter.
- `domains/governance/budget-gate.test.ts` — an impersonal subject binds no personal cap; a
  team's own key is held to its team's cap and counted toward it (`APIKEY-R9`); a project's cap
  binds the work in it, whoever spends, and a project's key spends in its project (`GOV-R14`).
- `domains/governance/usage-ledger.test.ts`, `budget-reservations.test.ts`,
  `domains/sandbox/op-attribution.test.ts`, `turn-budget.test.ts`, `domains/chat/budget-admission.test.ts`,
  `domains/tts/service.project-budget.test.ts`, `jobs/task-list.generate-title.test.ts` — each lane
  names the project (`GOV-R14`); `domains/governance/project-budget.integration.ts` proves the
  buckets, the holds and the refusal on the real schema.
- `domains/governance/usage-metrics.test.ts`, `app/features/analytics/usage/usage-metrics-page.test.tsx`
  — the sentinel is labelled and excluded from active users; a project agent shows its name; a
  key identity is its own row and no active user.
- `backend/integration-check.ts` — `checkSandboxGatewayKeyReclaim`: a trigger run books under the
  sentinel, a keyed run under person + key; the MCP one-shot run records its key.

## Not yet

- **Drop `app.usage_events`.** Write-retired in this release; erasure and retention still cover
  its legacy rows. The previous image writes it during a roll, so the `DROP TABLE` waits for the
  release after next.
- **A `CHECK` on `usage_ledger.user_id`** (no `:` unless the sentinel) would make rule 2 a schema
  fact. Historical rows carry the door forms and the previous image would violate it mid-roll, so
  it lands `NOT VALID` in a later release, once every image books bare ids.
- **History is not rewritten** (decision 2026-09-19): rows booked under `user:`/`api-key:` before
  this release stay as booked. Since 2026-09-26 every reader folds them onto the person
  (`usageLedgerSubject` / `usageLedgerSubjectForms` in `lib/shared/constants/usage.ts`), so the
  usage page shows one row per member and a cap sees a member's whole spend without a backfill.
