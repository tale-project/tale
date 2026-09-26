# Governance — the usage ledger and its billing subject

Who a billable call is booked under, where that rule lives, and what enforces it. Read this
before adding a lane that spends on the organization's behalf or a reader that folds spend.

The ledger is `app.usage_ledger` (`db/migrations/0020_governance_usage.sql`): period buckets —
daily, weekly, monthly — per (organization, user, agent, model, provider, API key, connector
operation). `incrementUsageLedger` in [`service.ts`](service.ts) is its one writer; the usage
page, the budget gate, erasure and retention are its readers.

## Rules

1. **One ledger.** Every billable call books into `app.usage_ledger` and nowhere else. The
   per-turn `app.usage_events` table the chat lane used to write beside it had no reader; it is
   write-retired and goes in a later release (see _Not yet_).
2. **`user_id` is a bare user id** — the person responsible for the spend — or the one sentinel
   `__automation__` (`lib/shared/constants/usage.ts`, `AUTOMATION_SUBJECT_ID`) for spend nobody is
   responsible for. It never carries a door, a prefix, a session or a system marker.
3. **The person is who started the work.** A chat turn spends for the member who sent it (or the
   member a REST key acts for). A managed agent turn spends for the person who started the run —
   from a task, a comment, the REST API or the MCP endpoint — and a retry continues its starter's
   kick. A run a trigger (schedule, webhook, event) started has no person: it books under
   `__automation__`.
4. **A keyed start books to its key too.** When an API key authenticated the chat send or the run
   start, the ledger row carries `api_key_id` beside the person, so the key's own budget caps see
   the spend the docs promise them. Run rows keep the key in `automation_runs.api_key_id`
   (`0110_run_billing_subject.sql`); the reservation stamps it on `sandbox_session_ops`.
5. **`agent_slug` is a stable identifier, never a display name.** A chat assistant books under its
   slug, a project agent under its id (`project_agents.id`), an automation under its name (a
   unique path per organization), the system lanes under their sentinels (`__tts__`,
   `__transcription__`, `__connector__`, `__direct_api__`, `thread-title`). Readers resolve names
   at read time (`usage-metrics.ts` resolves project agents).
6. **One resolver per lane, and only one reader of the door format.** The chat lane books
   `request.userId` (`lib/chat/turn.ts`, `recordUsage`). Managed turns — reservation
   (`domains/sandbox/turn-budget.ts`) and settlement (`domains/sandbox/spend-settlement.ts`)
   alike — resolve their subject through `resolveSessionOpAttribution`
   (`domains/sandbox/op-attribution.ts`). A run's `started_by` is parsed only by
   `parseRunStarter` (`lib/shared/run-starter.ts`); a `split(':')` on a starter anywhere else is
   a defect.
7. **Door fields keep their format.** `automation_runs.started_by` stays `user:<id>` /
   `api-key:<userId>` / `trigger:<triggerId>` (the REST contract publishes it on `startedBy`;
   erasure and the trigger fire ledger read it) and `project_agent_runs.started_by` stays a bare
   id. Fix attribution at the ledger boundary, never by rewriting a door field.
8. **Readers assume the rules above.** The usage page looks `user_id` up in `"user"` and labels
   the sentinel; the budget gate sums a member's rows by bare id and a team's by its members' bare
   ids; erasure deletes the subject's rows by bare id (and the legacy door forms); an impersonal
   subject (`OrgBudgetSubject.impersonal`) is measured against the organization's caps and, when
   keyed, the key's — never a personal, team or role cap.

## Lanes (the write side)

| Lane | Resolver | `user_id` | `agent_slug` | `api_key_id` |
| --- | --- | --- | --- | --- |
| Chat turn (App, REST) | `lib/chat/turn.ts` → `createPgUsageLedger` | the sender / the member acted for | assistant slug | the REST key |
| Chat title | `core/chat/generate_title.ts` → same ledger | the thread's member | `thread-title` | — |
| Project agent turn (`task-agent` op) | `resolveSessionOpAttribution` | `project_agent_runs.started_by` (bare) | `project_agents.id` | — |
| Automation agent turn (`workflow-agent` op) | `resolveSessionOpAttribution` | the person `started_by` names; `__automation__` for `trigger:` | automation name | `automation_runs.api_key_id` |
| Voice output, transcription | `domains/tts`, `domains/files/transcription.ts` | the requester | `__tts__`, `__transcription__` | — |
| Connector call | `recordConnectorUsage` | the caller | optional | — |

## Readers

| Reader | What it assumes |
| --- | --- |
| Usage page (`core/governance/get_org_usage_metrics.ts`, `usage-metrics.ts`) | `user_id` is a `"user"` id or the sentinel, folded through `usageLedgerSubject` so a legacy door form (`user:<id>`, `api-key:<id>`) is the person's row and `trigger:<id>` the sentinel's; the sentinel is a labelled row and no active user; project agent slugs resolve to names; a row is a transcription or speech row only when its seconds or characters are `> 0` (the upsert once stamped `0` on every second request) |
| Budget gate (`budget-gate.ts`, `budget-reservations.ts`) | personal caps sum `user_id = ANY(<bare id>, user:<id>, api-key:<id>)` (`usageLedgerSubjectForms`), team caps the members' ids under the same forms, key caps `api_key_id`; an impersonal subject has no personal bucket |
| Member's own view (`/my/budget-status`, Settings > Usage) | the same `usageLedgerSubjectForms(<own id>)` as the gate |
| Erasure (`domains/erasure/service.ts`) | the subject's rows are `user_id IN (<id>, user:<id>, api-key:<id>)` — the two door forms cover rows booked before rule 2 held |
| Retention (`domains/retention/service.ts`) | buckets age by `updated_at_ms`; a legal hold protects a member's rows |

## Guards

- `lib/shared/run-starter.test.ts` — the door parser.
- `domains/sandbox/op-attribution.test.ts` — the subject per lane, sentinel, key, stamp fallback.
- `domains/sandbox/turn-budget.test.ts`, `spend-settlement.test.ts` — reservation and settlement
  book the same subject and the key; a trigger run is impersonal.
- `domains/governance/budget-gate.test.ts` — an impersonal subject binds no personal cap.
- `domains/governance/usage-metrics.test.ts`, `app/features/analytics/usage/usage-metrics-page.test.tsx`
  — the sentinel is labelled and excluded from active users; a project agent shows its name.
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
