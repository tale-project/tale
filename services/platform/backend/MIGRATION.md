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
| Node loader (0.4 pure-module reuse) | done | inc 05; `node-loader.mjs` resolve hook + `--experimental-transform-types`: the backend imports runtime-clean 0.4 modules (extensionless specifiers) unchanged — port-by-reference instead of fork-copying; those modules move under backend/ at cutover |
| App DB + boot migrator | done | inc 03; `tale_app`, advisory lock, `app_migrations` |
| Serializable tx wrapper | done | inc 01; `@tale/shared/db/serializable` |
| Transactional enqueue (pg-boss 12) | done | inc 01 on Graphile; swapped to pg-boss in inc 05 (Larry's call): `send({db})` in-tx, LISTEN/NOTIFY wake (p50≈10ms), singletonKey dedupe, per-queue retry policy + DLQ available. postgres.js json serializer overridden to node-postgres semantics (strings pass through) — double-encode trap |
| Hint outbox + SSE `/events` | done | inc 01–04; session + org-membership gated; per-user hint scoping |
| Org-config reads (file, direct) | done | inc 05; `lib/org-config.ts` + `lib/governance-policies.ts` reuse the 0.4 reader/registry — the configCache DB mirror DIES (it existed only for V8). K8s: api+worker replicas mount the config volume RWX; compose wiring at cutover |
| Better Auth core on PG (email+password, organization plugin) | done | inc 03–05; org plugin with teams + access control + slug/name hooks; scaffold enqueued from afterCreateOrganization |
| Auth parity: apiKey, twoFactor, passkey plugins | done | inc 05; apikey `suffix` via schema plugin + after-hook; 2FA org-enforcement hooks + verify-endpoint lockout land with two_factor domain |
| Auth parity: login throttle (per-IP + lockout + jitter) | done | inc 05; before/after hooks on /sign-in/email; strictest org login_policy from files |
| Auth parity: JWT/JWKS lane | pending | maybe unnecessary in 0.5 (same-process session) — decide with sandbox domain |
| Org scaffold/seeding (builtin config catalog) | done | inc 05; `org.scaffold` + `org.cleanup_files` jobs reuse `scaffoldOrgFromCatalog`/`removeOrgSubtree` unchanged |
| RLS/membership helpers (queryWithRLS analogue) | done | inc 05; `auth/membership.ts` direct SQL (mirror apparatus dead) + `authorizeRls` role matrix |
| Rate limiting (63 rules) | done | inc 05; `lib/rate-limit.ts` PG token bucket + fixed window, atomic UPSERTs, full 0.4 rule catalog as data (shards dropped); call sites wire up as domains land; stale-row GC with crons infra |
| File storage router (per-org S3/MinIO + `_storage` replacement) | done | inc 08; S3-ONLY (Convex `_storage` dies): per-org BYO connection → deployment default (`default` tree's object-storage/connection.json; compose ships MinIO + seeded connection at cutover) → fail-closed. aws4fetch mechanics reused from 0.4 unchanged. Sandbox stage tokens with the sandbox domain |
| Frontend data layer (hint hook + auth client + api client) | pending | keep TanStack Query; wrapper-hook swap |
| Crons (~20) + watchdog jobs | pending | pg-boss `schedule()` (cron per queue); per-job idempotency |
| Proxy routes → backend-api | pending | cutover step |
| tale CLI (deploy/migrate/drain against PG backend) | pending | cutover step |
| Observability (SLA targets, status probe, metrics) | pending | port from server.ts lanes |

## Domains (from `services/platform/convex/`)

| Domain | Status | Notes |
| --- | --- | --- |
| accounts | pending | credential probe ported with users; OAuth account queries remain |
| agents | pending | |
| agent_secrets | pending | |
| approvals | pending | |
| audit_logs | done | inc 05; chain head per org, `FOR UPDATE` append (rule 5), inline prior-row self-check, list route; export CSV + integrity-verify tooling + retention/pii-scrub with governance |
| automations | pending | stepper port; INV ledger 1–4, 18–19, 24–25 |
| automations_builder | pending | |
| betterAuth | done | inc 05 → backend/auth (component dies); trusted-headers door tracked as trusted_headers_auth |
| branding | pending | |
| browser_sessions | pending | |
| changelog | pending | |
| chat | pending | Tier-1 SSE lane for streaming |
| chat_filter_events | pending | |
| cloud_import | pending | |
| collab | pending | |
| connector_credentials | pending | |
| connectors | pending | in-sandbox bridge routes |
| contacts | pending | |
| control | pending | drain door for CLI |
| conversations | pending | IMAP polling jobs |
| debug | pending | likely dropped |
| deployment | pending | "Apply & restart" redesign (controller removed) |
| discussions | pending | |
| documents | pending | replacement-upload handshake redesign |
| enterprise_sso | pending | |
| events | pending | |
| feedback | pending | |
| file_metadata | in-progress | inc 08: `app.file_metadata` ledger (all pipeline columns shipped nullable) + core reads; RAG dispatch pools → per-queue workers, transcription, OCR with knowledge/tts |
| files | in-progress | inc 08: upload handshake (server-minted keys, HEAD-verified register), presigned serve, org-scoped delete (uploader/admin); sandbox blob HTTP + rejected-upload lanes with sandbox/documents |
| folders | pending | |
| google_drive | pending | |
| governance | pending | erasure cascades; retention |
| http_connectors | pending | |
| identities | pending | |
| knowledge | pending | already PG-backed; move pool mgmt |
| knowledge_entries | pending | |
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
| products | pending | |
| projects | in-progress | inc 06: core CRUD/settings/lifecycle/agents/search/overview + access matrix (reused) + audit actions (reused); per-org key/externalItemId unique via partial indexes; PENDING: doc/thread attach + delete-cascade walks (documents/chat), overdue rollup + label seed (tasks), bound-automations guard, REST v1 + upload intents (machine door), secrets prune (agent_secrets), rollup repair job (crons) |
| provider_credentials | pending | |
| provisioning | pending | |
| sandbox | pending | sessions/slots/admission; INV 14–16 |
| scim | pending | |
| skills | pending | |
| status | pending | |
| support_cases | pending | |
| tasks | in-progress | inc 07 (Tier A): board core — CRUD/status choreography (human semantics, subtask close-guard)/assignee validation/claim/LexoRank moves (rank module reused)/labels catalog/dependencies (DAG-guarded)/board views/activity timeline/project rollup transitions/hard delete. Tier B with its infra: discussion comments+mentions (thread store), agent runs+review arc+status verbs that kick runs (INV 5–7, 20, 22), notify/event fan-outs, attachments/outputs blobs (storage router), REST surface, date notifications (crons), bulk ops, ops indicators |
| team_members | pending | |
| testing | dropped(convex-test harness) | replaced by vitest+throwaway PG |
| threads | pending | agent-component store replacement |
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
