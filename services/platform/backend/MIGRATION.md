# 0.5 migration ledger

The single tracking document for the Convex → Postgres port on branch `0.5`.
Every domain of `services/platform/convex/` must land here as `done` (or
`dropped` with a reason) before cutover. Update this file in the same change
that ports a domain — it is the campaign's source of truth across sessions.

Legend: `pending` · `in-progress` · `done` · `dropped(reason)`

## Porting rules (the constitution, enforced on every port)

1. Mutation-shaped handlers run through `transactSerializable`; callbacks are
   pure apart from DB writes (re-executed on retry).
2. Side effects = pg-boss jobs enqueued via `addJobInTx` in the same
   transaction (`send({db})` rides the caller's tx); handlers idempotent
   (at-least-once delivery), dedupe via `singletonKey` derived from durable
   ids. Queues are declared in `jobs/tasks.ts` (one queue per identifier,
   notify-enabled for ms wake-ups).
3. Tier-2 realtime = `emitHintInTx` in the changing transaction; hints carry
   identity, never data. Tier-1 hot streams get dedicated SSE lanes.
4. Convex at-most-once scheduling assumptions INVERT: every ported watchdog /
   liveness sweep keeps its job, but handlers gain idempotency guards instead
   of relying on lost-job semantics (invariant ledger INV-25).
5. Do not port faithfully (fix instead): one-turn-per-thread TOCTOU → partial
   unique index; task two-lane mutex → partial unique index; audit hash chain
   OCC trick → per-org `SELECT … FOR UPDATE`; vestigial workflow components,
   `agentRunsPausedAt` breaker fields, `scheduleCapacityWake` stub → drop.
6. App schema changes = a new numbered file in `db/migrations/` (boot-applied,
   advisory-lock guarded). Better Auth and pg-boss own their schemas.

## Infrastructure

| Piece | Status | Notes |
| --- | --- | --- |
| Runtime/image (Node in platform image, TALE_ROLE api/worker) | done | inc 02; compose profile `backend` |
| Node loader (0.4 pure-module reuse) | done | inc 05 (+14: bare-specifier `.js` retry for CJS deep paths; `lib/convex-shim.ts` re-points a reused module's runQuery/runMutation at SQL by function name — fail-loud on un-shimmed calls); `node-loader.mjs` resolve hook + `--experimental-transform-types`: the backend imports runtime-clean 0.4 modules (extensionless specifiers) unchanged — port-by-reference instead of fork-copying; those modules move under backend/ at cutover. inc 16: `convex/lib/helpers/id_shape.ts` id class widened to mixed case (Better Auth pg ids reach reused 0.4 callers; 0.4-safe — a mixed-case miss just reaches the adapter and nulls) |
| App DB + boot migrator | done | inc 03; `tale_app`, advisory lock, `app_migrations` |
| Serializable tx wrapper | done | inc 01; `@tale/shared/db/serializable` |
| Transactional enqueue (pg-boss 12) | done | inc 01 on Graphile; swapped to pg-boss in inc 05 (Larry's call): `send({db})` in-tx, LISTEN/NOTIFY wake (p50≈10ms), singletonKey dedupe, per-queue retry policy + DLQ available. postgres.js json serializer overridden to node-postgres semantics (strings pass through) — double-encode trap |
| Hint outbox + SSE `/events` | done | inc 01–04; session + org-membership gated; per-user hint scoping |
| Org-config reads (file, direct) | done | inc 05; `lib/org-config.ts` + `lib/governance-policies.ts` reuse the 0.4 reader/registry — the configCache DB mirror DIES (it existed only for V8). K8s: api+worker replicas mount the config volume RWX; compose wiring at cutover |
| Better Auth core on PG (email+password, organization plugin) | done | inc 03–05; org plugin with teams + access control + slug/name hooks; scaffold enqueued from afterCreateOrganization |
| Auth parity: apiKey, twoFactor, passkey plugins | done | inc 05; apikey `suffix` via schema plugin + after-hook; 2FA org-enforcement hooks + verify-endpoint lockout land with two_factor domain |
| Auth parity: login throttle (per-IP + lockout + jitter) | done | inc 05; before/after hooks on /sign-in/email; strictest org login_policy from files |
| Auth parity: JWT/JWKS lane | dropped(decided inc 19b) | not ported: sessions are same-process, and in-sandbox callbacks authenticate by session-token sha256 (never JWT); the 0.4 JWKS served the Convex WS provider, which dies with the WS layer |
| Org scaffold/seeding (builtin config catalog) | done | inc 05; `org.scaffold` + `org.cleanup_files` jobs reuse `scaffoldOrgFromCatalog`/`removeOrgSubtree` unchanged |
| RLS/membership helpers (queryWithRLS analogue) | done | inc 05; `auth/membership.ts` direct SQL (mirror apparatus dead) + `authorizeRls` role matrix |
| Rate limiting (63 rules) | done | inc 05; `lib/rate-limit.ts` PG token bucket + fixed window, atomic UPSERTs, full 0.4 rule catalog as data (shards dropped); call sites wire up as domains land; stale-row GC with crons infra |
| File storage router (per-org S3/MinIO + `_storage` replacement) | done | inc 08; S3-ONLY (Convex `_storage` dies): per-org BYO connection → deployment default (`default` tree's object-storage/connection.json; compose ships MinIO + seeded connection at cutover) → fail-closed. aws4fetch mechanics reused from 0.4 unchanged. Sandbox stage tokens with the sandbox domain |
| Frontend data layer (hint hook + auth client + api client) | in-progress | inc 17: `app/lib/backend/` — fetch client (base path + org scope + `BackendApiError` normalization), `['backend', orgId, entity]` query-key vocabulary bound to the outbox's entity names, and `useBackendHints` (`/events` EventSource → `invalidateQueries` by entity prefix); dev proxy: `TALE_BACKEND_URL` routes `/api/auth` + `/api/app` + `/events` to the pg backend while everything else keeps flowing to Convex (proven end-to-end through Vite: sign-up cookie → session → /api/app → /events 403 → non-migrated /api falls through). Auth client unchanged (already talks to `/api/auth`; the convex-token plugin dies with the WS provider at shell migration). NEXT: migrate the app shell (session/org bootstrap) + first feature verticals onto these hooks |
| Crons (~20) + watchdog jobs | in-progress | inc 09: pg-boss `schedule()` registry (`jobs/schedules.ts`, worker-boot upsert, UTC) + first sweeps (rate-limit GC, loginAttempts TTL); each domain port adds its rows |
| Proxy routes → backend-api | pending | cutover step |
| tale CLI (deploy/migrate/drain against PG backend) | pending | cutover step |
| Observability (SLA targets, status probe, metrics) | pending | port from server.ts lanes |

## Domains (from `services/platform/convex/`)

| Domain | Status | Notes |
| --- | --- | --- |
| accounts | pending | credential probe ported with users; OAuth account queries remain |
| agents | in-progress | inc 18: the file layer REUSED verbatim (`file_actions.ts` handler bodies hoisted into exported plain functions — the internalActions now wrap them; yaml definitions + history trail + visibility/owner/verify-before-write untouched) behind `/api/app/agents` (list/read/resolve-for-turn/save/delete/history/restore; `isOrgAdmin` = the same `orgSettings` ability derivation). `assertAgentAssigneeLive` twin already lives in tasks' assignee validation over app.project_agents. PENDING: REST v1 surface (machine door), turn-resolver call sites (sandbox/task-agent lanes) |
| agent_secrets | pending | |
| approvals | pending | |
| audit_logs | done | inc 05; chain head per org, `FOR UPDATE` append (rule 5), inline prior-row self-check, list route; export CSV + integrity-verify tooling + retention/pii-scrub with governance |
| automations | in-progress | inc 20: the durable run engine — migration 0019 (versions/bindings/deployments/triggers/upload-intents/runs/human-asks/tombstones) + `domains/automations/store.ts` (immutable contiguous versions, tests-gated deploy, name-bound triggers with once-shown webhook tokens + rotate, binding-set scope, the FULL run contract: claim epoch fence, heartbeat/progress wakeAt renewal, chainSeq-fenced suspend/poll chain, continue hand-offs, single terminal door writing the provenance audit row + stopping the run's workflow sessions) with the 0.4 STEPPER REUSED verbatim (`stepRunImpl` hoisted; `automationShimHandlers` = chat shim + the run contract; scheduler → pg-boss `automation.step`/`automation.poll` jobs enqueued in-tx) — llm nodes resolve serving through the same provider/credential seams (safeFetch auto-derives the private-host allow) and transform nodes run the vm runner; liveness sweep (`sweepOverdueRuns`) re-pokes lost resumes; `/api/app/automations` surface (list/get/save/deploy/trigger/projects/start/runs/cancel/delete). Integration proves the whole loop incl. outputSchema-validated llm output, the deploy gate, the sweep, and tombstone semantics. inc 21: trigger DELIVERY — the minute-cron matcher REUSED (`cron.ts`, IANA-zone wall clock) behind the `automation.trigger_scan` pg-boss schedule (lastFiredAt stamped BEFORE the start); the webhook door `POST /api/automations/webhook/<token>` (token IS the credential: reused mint/hash/constant-time-compare from `webhook_token.ts`; unknown/disabled = plain 404, bad projectId = 400); event triggers wired into the events emit seam (`dispatchAutomationEvent` runs INSIDE the producing tx — proven end-to-end: contact create → run) with the automation-origin loop guard; `automation.liveness` schedule sweeps overdue runs per minute. PENDING: agent nodes (sandbox lane) + human_asks flow, connector nodes (executor retired pending redesign), approvals gate (outbound refuses loudly), pack seed/upload, REST + builder surfaces, retention sweep |
| automations_builder | pending | |
| betterAuth | done | inc 05 → backend/auth (component dies); trusted-headers door tracked as trusted_headers_auth |
| branding | pending | |
| browser_sessions | pending | |
| changelog | pending | |
| chat | in-progress | inc 16: `executeTurn` REUSED verbatim (model resolution from org providers, attachment gate, budgeted history, context assembly, guardrail seams, tool rounds, streaming decode) with its store/usage ports swapped for PG (`app.generations` per-thread streaming row, throttled writes + NOTIFY, `app.usage_events`) and every ctx.run* dispatched via `chatShimHandlers`; the 0.4 three-tool executor (rag_search/rag_fetch/web_fetch) runs unchanged on the same shim (entity legs answered by SQL over ported domains; knowledge_entries/websites/conversations/mail/video legs are honest empties until those domains land); routes: threads create/list, history, send (caller awaits the turn — the 0.4 action contract, at-most-once), per-thread SSE progress lane (poll at the 250ms write throttle), mid-stream cancel. Governance seams allow-all/no-op until governance ports (checkModelAccess, context cap, recordConnectorUsage, per-subject read matrix). PENDING: Auto routing (resolveChatModel), branches/regenerate lineage, arena, memories, voice, deferred sends, queue steering, title generation, sandbox execution mode, project-shared thread reads, thread trash/rename |
| chat_filter_events | pending | |
| cloud_import | pending | |
| collab | pending | |
| connector_credentials | pending | |
| connectors | pending | in-sandbox bridge routes |
| contacts | in-progress | inc 12: CRUD/list-filter/find-or-create (email normalized), soft trash, contact.* events; bulk import + REST lanes with the machine door |
| control | pending | drain door for CLI |
| conversations | pending | IMAP polling jobs |
| debug | pending | likely dropped |
| deployment | pending | "Apply & restart" redesign (controller removed) |
| discussions | pending | |
| documents | in-progress | inc 10 (Tier A): create-from-upload bind, hub/project scoped reads (access module semantics mirrored), rename/move/team edits, trash/restore, project attach/detach (closes the projects gap), mention search, presigned serve. Tier B: controlled records (approvals), replacement uploads (redesign), generate-document lanes, sync configs, RAG dispatch (knowledge), WebDAV resolvers, hard delete + blob erasure (governance) |
| enterprise_sso | pending | |
| events | done | inc 09 seam + producers; inc 21 makes dispatch REAL: emit fans out to the org's enabled `event` automation triggers inside the producing transaction (run insert + step job commit atomically with the write), non-fatal to the producer, automation-origin events refused (loop safety) |
| feedback | done | inc 12; per-(message,user) upsert votes, toggle, org insights feed + stats (matrix-gated) |
| file_metadata | in-progress | inc 08: `app.file_metadata` ledger (all pipeline columns shipped nullable) + core reads; RAG dispatch pools → per-queue workers, transcription, OCR with knowledge/tts |
| files | in-progress | inc 08: upload handshake (server-minted keys, HEAD-verified register), presigned serve, org-scoped delete (uploader/admin); sandbox blob HTTP + rejected-upload lanes with sandbox/documents |
| folders | in-progress | inc 10: tree CRUD (depth cap, sibling-name uniqueness, scope inheritance/conflict rules), breadcrumb, hub/project listings; delete refuses on any descendant document until the trash-cascade lands (conservative); legal-hold/record guards + sync-config deactivation with governance/sync domains |
| google_drive | pending | |
| governance | in-progress | inc 23: policy ENFORCEMENT over governance files — the pure evaluators REUSED (`evaluateModelAccess`/`evaluateFeatureFlags` hoisted from the 0.4 modules; 0.4 suites still green) hosted on the 0.5 policy reader; the chat/tool shims' allow-all seams are now REAL verdicts (model access refuses at the turn boundary with the 0.4 wording, feature-flags `maxContextTokens` caps the window); usage metering = `app.usage_ledger` (migration 0020, the 0.4 three-period buckets as one `ON CONFLICT` increment on a coalesce-keyed unique index) fed by the chat turn ledger + the connector-tool dispatch. PENDING: budget ENFORCEMENT call sites (rules engine is reused-ready; record-only today), retention sweeps, erasure cascades + DSAR, legal holds, moderation/guardrail policies, session-idle enforcement, competence/review policies, usage analytics surfaces |
| http_connectors | pending | |
| identities | pending | |
| knowledge | in-progress | inc 15: search/fetch REUSED verbatim via the ctx shim (org lookup + credential loads + Tier-A retrievable filter re-pointed at 0.5); ingest = 0.5 composition of the exported pieces (extract→embed→indexDocument) on the `rag.index_file` job; default-corpus bootstrap at worker boot. PENDING: web corpus crawling (websites), transcript RAG (tts), conversation/email retrievable branches, corpus status/repair surfaces, KNOWLEDGE_MIGRATIONS_DIR in the runner image |
| knowledge_entries | pending | manual entries tab (writes through the same indexDocument lane) |
| legacy | dropped(vestigial 0.4 tables) | |
| lib | in-progress | port per-consumer, never wholesale; inc 05 reuses (loader): file_io, config_store read lane, audit_hash, pii_hash, client_ip, login helpers, scaffold |
| login_attempts | done | inc 05; lockout + block counters + per-org audit + lockout notification; 30-day retention sweep with crons infra |
| members | in-progress | inc 05: list/context reads + add/remove/role/transfer/display-name with 0.4 guards (mirrors dead); teams queries (getMyTeams/listOrgTeams/approxCount) pending; legal-hold guard on removal with governance |
| migrations | dropped(Convex-specific framework) | 0.5 uses backend/db/migrations |
| node_only | pending | sandbox spawner client et al |
| notifications | in-progress | inc 04–05: org-audience bell at the 0.4 shape (reads join table replaces readBy; security = admin-only; dedupe) + lockout producer; Slack/email dispatch lanes (event_catalog, notify_slack, email_notification, actionable emails) land with connectors/conversations |
| object_storage | in-progress | inc 08: resolution + presign lanes live (0.4 BYO configs work verbatim); admin save/test-connection surface pending; convex→s3 backfill DROPPED (no convex storage in 0.5) |
| onedrive | pending | |
| organizations | in-progress | inc 05: getOrganization/hasAny/recordOrgSwitch/resolveUserOrganization/prepare-deletion (+scaffold & cleanup jobs); reseed_all_orgs + provisioning-status/repair actions + slug-scoped file-surface guards pending; legal-hold guard with governance |
| products | in-progress | inc 13: catalog CRUD, case-insensitive per-org name uniqueness (expression index replaces the 0.4 full-table probe), translations upsert, filterable keyset list; REST/connector ingest lanes with the machine door |
| projects | in-progress | inc 06: core CRUD/settings/lifecycle/agents/search/overview + access matrix (reused) + audit actions (reused); per-org key/externalItemId unique via partial indexes; PENDING: doc/thread attach + delete-cascade walks (documents/chat), overdue rollup + label seed (tasks), bound-automations guard, REST v1 + upload intents (machine door), secrets prune (agent_secrets), rollup repair job (crons) |
| provider_credentials | in-progress | inc 14: the RESOLUTION path (api-key decrypt / env gate / broker pool) reuses the 0.4 module verbatim via the ctx shim over app.provider_credentials; admin CRUD (masked reads, default swap via partial unique index); inc 16 wires the chat direct wire through the same resolver (`resolveDirectWire` reused); rotation/failover call sites wire up with gateway |
| provisioning | pending | |
| sandbox | in-progress | inc 19a: the session SUBSTRATE — migration 0017 (sessions/tokens/ops/checkpoints/admission tickets/credential-access audit) + `domains/sandbox/sessions.ts`: per-owner cap, per-budget org caps from the `sandbox_quota` policy (pure budget/cap fns REUSED from `quota_policy.ts`), park-on-capacity FIFO tickets (heartbeat + reaper + release-edge fairness — proven head-vs-later in integration), hibernate/resume slot re-admission, hash-only session tokens, durable op rows (exactly-once finalize, watchdog staleness scan), workflow re-attach checkpoints. Rule 5: the 0.4 OCC recount ballet → one per-org `pg_advisory_xact_lock` section, same external semantics. inc 19b: spawner dispatch — `helpers/session_client.ts` REUSED verbatim (HMAC signing verified byte-level by the itest fake spawner) behind `domains/sandbox/service.ts` with the 0.4 provisioning choreography (reserve→create→activate; reuse-in-place on a live row; phantom heal on spawner 404 — session_id is deliberately NON-unique, newest incarnation wins; 409 orphan ADOPT; 429 host-busy re-parks the FIFO ticket) + `/api/app/sandbox` admin surface (list+ops, pin both sides, destroy) gated on the orgSettings ability. JWT/JWKS lane DECIDED DEAD: in-sandbox callbacks authenticate by session-token sha256 (`dispatch_auth` contract), and the 0.4 JWKS existed for the Convex WS provider, which 0.5 retires. inc 19c: the workspace-tool door — `POST /api/tools/{execute,status}` (top-level, the container-facing machine door; session-VK bearer → sha256 → token row, org/user/grants NEVER from the body) with the 0.4 bridge REUSED verbatim (`dispatchWorkspaceTool`/`workspaceToolStatus` handler bodies hoisted to exported plain functions) on `sandboxToolShimHandlers` = the chat shim + session seams (binding resolver: project_agent→its project, workflow_run→none until automations; knowledge scope per binding; tool-call ledger `app.sandbox_tool_calls` migration 0018; trusted `agentAddComment` over the comments store). `ask_human` deliberately un-shimmed (fails loud) until automations. PENDING: `/api/connectors/execute` door (connector dispatch is DEAD both lanes pending Larry's plan), exec/agent-run drains + external-turn engine, reconcile/watchdog crons, capacity-wake → task-agent runs |
| scim | pending | |
| skills | in-progress | inc 24: the file layer REUSED verbatim (`skills/file_actions.ts` handler bodies hoisted to exported plain functions — SKILL.md verify-before-write, org/team visibility, owner adoption, private-retired gate untouched; 0.4 suites 81/81 green) behind `/api/app/skills` (list/read/asset/save/delete; viewer = teams + orgSettings ability). PENDING: zip bundle upload lane (upload intents on S3 blobs), REST v1 skills routes, sandbox staging call sites (`readSkillBundleForViewer` ready) |
| status | pending | |
| support_cases | in-progress | inc 12: case lifecycle (status stamps, escalation, SLA fields), comments (first-response stamp), activity feed, archive; agent assignee lanes with agents domain |
| tasks | in-progress | inc 07 (Tier A): board core — CRUD/status choreography (human semantics, subtask close-guard)/assignee validation/claim/LexoRank moves (rank module reused)/labels catalog/dependencies (DAG-guarded)/board views/activity timeline/project rollup transitions/hard delete. Tier B with its infra: discussion comments+mentions (thread store), agent runs+review arc+status verbs that kick runs (INV 5–7, 20, 22), notify/event fan-outs, attachments/outputs blobs (storage router), REST surface, date notifications (crons), bulk ops, ops indicators. inc 11 adds: discussion comments on the message store (add/edit/delete, lockstep meta, comment counts, activity + audit) — mention directory/fan-outs with collab/agents/automations. inc 25a adds: the project-agent RUN LEDGER (migration 0021 `app.project_agent_runs` — the full 0.4 column set incl. `launched_at` distinct from kick time, broker-token hash, auto-retry bookkeeping) + `domains/tasks/agent-runs.ts` (kick reusing a live run, exactly-once settle/fail, capacity park with the clear-the-stamp single-winner claim, release-edge `wakeParkedAgentRuns` WIRED into the sandbox stop/destroy edges, watchdog lists) + the status choreography kick (agent-owned task → in_progress creates the queued run + `task.agent_turn` job IN the status write's transaction) + run views/cancel on the task routes. The TURN DRIVER (agent_run_host: brief, session provisioning, gateway VK, drain, settle→comment+in_review) is 25b |
| team_members | pending | |
| testing | dropped(convex-test harness) | replaced by vitest+throwaway PG |
| threads | in-progress | inc 11: the store (app.threads/messages, (order, step_order) turn model, jsonb parts + derived text) + thread_metadata sidecar table. inc 16 adds: chat message columns (model/provider_slug/reasoning/blocked_reason/truncation), thread+metadata create/list routes, generation lifecycle on thread_metadata; branches/share-links/lifecycle (trash/archive) remain |
| trusted_headers_auth | pending | |
| tts | pending | |
| two_factor | pending | plugin live (inc 05); org enforcement hooks + verify-endpoint lockout + grace windows remain |
| user_preferences | done | inc 05; tri-state flags on nullable booleans; org-default resolution happens where features consume it |
| users | in-progress | inc 05: me/has-any/password-expiry/last-active-org/notification-state/update-name/update-password/create-member/set-member-password; reset_owner CLI door + create_user_without_session + merge_auth_users utilities pending |
| video_links | pending | |
| webdav | pending | already Hono-side; re-home into backend |
| websites | pending | crawler jobs |

## HTTP surface (95 handlers / 122 routes)

Ported route-by-route with their domains; the REST machine door (82 routes,
`/api/v1/*`) and SCIM/SSO/webhook surfaces keep their exact request/response
contracts (`services/platform/public/openapi.json` is the compatibility
oracle).

inc 22 opens the door: `backend/rest/v1.ts` — Bearer API key through the
Better Auth apiKey plugin (the same `auth.api.getSession` surface, synthetic
`x-api-key` header), org resolution via `resolveUserOrganization` honouring
`X-Organization-Slug` (mandatory for multi-org keys on non-GET), per-IP
`rest:api` rate limiting, coded domain-error mapping. First adapter wave:
contacts (list/create/get/patch/delete), products (same), projects
(list/create/get), tasks (create/get), documents (list/get), agents
(list/get/put/delete via the reused file layer), automations
(list/versions/triggers/save/deploy/start/runs) + `/runs/:id` (+cancel) —
proven end-to-end in integration (a run saved AND executed through the
door). REMAINING v1 routes ride their domains: knowledge search,
knowledge-entries, skills, websites, threads/chat, MCP, uploads, bulk
lanes — the openapi oracle is the parity checklist at cutover.
