# Tale — the repo contract

Repo-specific rules for the Tale monorepo. The shared contract in [`AGENTS.md`](../AGENTS.md)
applies first; this file adds what is true only here.

Tale is a monorepo on Bun workspaces; every workspace script runs through
`bun run --filter @tale/<workspace> <script>`.

## Layout

- `services/` — deployable units: `platform` (the flagship app: Vite + React 19 + TanStack Router +
  the Postgres backend), `web` (marketing site), `docs` (docs site at docs.tale.dev), `ui-docs`
  (the design-system docs site at [ui.tale.dev](https://ui.tale.dev), port 3003: a
  marketing-language front page on `@tale/marketing-ui`, app-language `/docs/*` pages with live
  `<Demo>` examples), plus `db`, `proxy`, and the `sandbox*` family. `docs` and `ui-docs` render
  one documentation frame, `@tale/ui/docs/*` (rail, header strip, article, outline, footer, 404,
  search); a site feeds it content and never forks a piece of it.
- `packages/` — `ui` (the design system: every reusable platform component, hook and UI util —
  the platform, docs and marketing site all build on it, and other repositories install it from
  GitHub), `marketing-ui` (the marketing design language — site chrome, marketing primitives,
  feature-page and product-demo frames — layered on `@tale/ui`; the marketing site builds on it
  and it is published from GitHub the same way), `shared` (schemas + pg), `e2e` (Playwright config
  factory). A component that carries tale business logic (org branding, abilities, backend
  queries) stays in its service and wraps the `@tale/ui` primitive; only UI-reusable logic lives
  in the package.
- `tools/` — `cli` (`@tale/cli`), `plop` (generators), `opengrep` (SAST gate), `lint-manual`
  (the manual-test gate; its `src/`, `cli.ts` and `tests/` are shared bytes with every
  tale-project repo — fix a rule in `example-project` and roll it, never here).
- `configs/platform/` — the builtin, org-independent config catalog (`system/` read-only,
  `custom/` seeded per org). Each client's private repository owns its `tale/` descriptor,
  packs, release catalogue and domain tests. Client content does not belong in this catalog.
- **Managed deployments** — the existing `@tale/cli` owns source acquisition, runtime/image
  verification, bundle preparation, rollout, native identity provisioning, configuration
  releases and deployment receipts. Ops selects destinations, full source commits and
  credential references, then calls the CLI; do not duplicate Tale deployment internals there.
  Model-server installation, hardware, model artifacts, routing and readiness are internal Ops
  responsibilities. Tale CLI manages native platform `configuration` resources through
  the same validate/plan/apply/readback flow in standalone commands and deployments.
  Shared native schemas live in `packages/shared/src/schemas/` and are imported
  through `@tale/shared/schemas/*`; the platform owns I/O, permissions and effects.
  New client configuration releases use their full source commit as identity and need no
  generated catalogue commit. Retained historical releases remain byte-preserved. Keep client
  names, fixtures, business rules and deployment targets out of the shared implementation;
  its tests use independent synthetic clients.
- `design/` — the design system contract (`docs/` + `sources/`). **UI in scope? Learn
  [`design/`](../design/) and `@tale/ui` first, then build to it.** The component guides —
  what each `@tale/ui` / `@tale/marketing-ui` component is for, its props, states and live
  examples — are published at [ui.tale.dev](https://ui.tale.dev); read their source offline in
  [`services/ui-docs/content/`](../services/ui-docs/content/) (index:
  [`content/nav.json`](../services/ui-docs/content/nav.json)) before picking or composing a
  component.

## Repo-specific boundaries

- **Org configuration is files, not tables** — per-org config is JSON/YAML under
  `$TALE_CONFIG_DIR/<org>/<domain>/` (Zod schemas in `@tale/shared/schemas/*`), never a DB row.
- **Tenant isolation — nothing org-owned is shared across organizations** — any new org-owned data
  (a table or column, an org config domain, a cache, a DB pool, an egress/browser-session
  store, the RAG/crawler corpora `private_knowledge`/`public_web` + their embeddings) MUST be
  scoped and queried per organization. Per-org knowledge routing is
  `getKnowledgePoolForOrg(orgSlug)`, never the deployment-default `getKnowledgePool()`; introducing
  a new cross-org shared surface is a defect.
- **A data-model or org-config schema change ships a migration** — one numbered `.sql` file under
  `services/platform/backend/db/migrations/`, forward-only and safe to apply to a live deployment
  mid-roll; the real-Postgres proof is `bun run --filter @tale/platform backend:integration`
  (there is no separate migrations gate or generated registry — filename order is the registry).
  Scaffold with `bun run gen:migration` and follow the
  [`create-migration`](skills/create-migration/SKILL.md) skill.
- **Every locale is covered, always** — a user-visible string never ships in fewer languages than
  the app supports: adding/changing/removing a key touches `en` AND every sibling locale (`de`,
  `fr`, relevant sparse `de-CH` overrides, shared package messages, and translated docs trees) in the same change, following the
  [`write-translations`](skills/write-translations/SKILL.md) skill. A key present in one catalog
  and missing in another full catalog is a defect, not a follow-up. Shared controls own their keys
  in `packages/ui`; marketing frames own theirs in `packages/marketing-ui`. Service catalogs
  override package keys per leaf. The product docs ship EN/DE/FR; `services/ui-docs/content` is
  an English-only guide with complete EN/DE/FR chrome catalogs.
- **Scaffold new parts from templates** — beyond the shared `gen:package|service|tool|skill`, tale
  adds `bun run gen:migration` and `bun run gen:episode` (docs-video episodes).
- **Four manual layers, one shape** — `services/{platform,web,docs,ui-docs}/tests/manual/` each carry the
  standard tree (`AGENTS.md` "Manual tests"), gated by `bun run lint:manual`: suites under
  `suites/`, the four registers under `reference/`, the round journal under `runs/`. Box IDs are
  `<PREFIX><kind><n>` (`NAV-F3`, `CHAT-B1`, `A11Y-A2`) — the prefix is the suite, the letter is
  what kind of check it is (F functional, B boundary, A accessibility, P performance). **Append,
  never renumber.** Ship new behaviour with its box, or with a row in `reference/automation.md`
  when a spec owns it end to end. The platform's `tests/manual/scripts/check-guide.ts` is the
  content half of the gate: it resolves the i18n keys, routes and spec names a suite cites, and is
  an authoring aid rather than a CI job — run it on every suite you touch.
- **Judge the platform against its user docs** — the pages under `docs/en/platform/` are the
  behaviour oracle for a manual round; a mismatch between the running app and its documented
  behaviour is a reportable defect of one or the other, never a silent judgment call.
- **Pencil**: `design/docs/comments.md` is strictly designer↔developer UI communication. Put
  code-level bug analysis in a GitHub issue, never there.
- **Git**: branch off `main`, never commit to it; PRs squash-merge (linear history), so the PR
  title must itself be commitlint-shaped.

## Skills index

Repo-dev skills live in [`.agents/skills/`](skills/); run `bun run skills:sync` after editing one.

| Skill                                                      | Read before…                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`create-migration`](skills/create-migration/SKILL.md)     | adding/changing/testing a versioned data migration, or a red `backend:integration` / corpus gate |
| [`write-docs`](skills/write-docs/SKILL.md)                 | writing/editing product or component guides — follow the affected content tree’s contract |
| [`write-translations`](skills/write-translations/SKILL.md) | editing any non-English locale file or doc, or touching the glossary                             |

The product skills are not repo-dev workflows: they live under
[`configs/platform/custom/skills/`](../configs/platform/custom/skills/) as the builtin catalog every
org is seeded with — `visual-aspect-analyzer` (also baked into the sandbox image for its
Playwright/Chromium deps) plus the official document skills `docx`, `pdf`, `pptx`, `xlsx`.

## Lint debt ledger

The shared `.oxlintrc.json` enforces rules this codebase has not paid down yet; the nested
workspace configs carry the explicit relaxations. Tightening one of these back to the shared
default means deleting the override and fixing what surfaces:

- **React Compiler family** (`react/refs`, `react/set-state-in-effect`,
  `react/exhaustive-effect-dependencies`, `react/memo-dependencies`, `react/immutability`,
  `react/purity`, `react/no-deriving-state-in-effects`, `react/hooks`, and friends) — off in
  `services/platform`, `services/web`, `services/docs`, `services/ui-docs`, `packages/ui`, and
  `packages/marketing-ui`. The original count predates the UI consolidation; inspect each
  workspace’s explicit overrides for current scope.
- **`promise/always-return`** — off in the same six workspaces.
- **`import/no-cycle`** — off in `services/platform` only (21 cycles, 2026-08).
- **jsx-a11y trio** (`no-noninteractive-element-to-interactive-role`, `interactive-supports-focus`,
  `no-noninteractive-element-interactions`, `no-noninteractive-tabindex`) — off in
  `services/platform` (11 sites needing real markup work, 2026-08); `interactive-supports-focus`
  and `no-noninteractive-tabindex` are also off for the three of those sites that moved into
  `packages/ui` with their components (file-scoped overrides in `packages/ui/.oxlintrc.json`).
- `typescript/no-unnecessary-type-assertion` is relaxed for platform test files: the tsgolint 7
  engine false-positives on widening assertions over frozen literals and on mock returns.

## Contract debt ledger

- **Unbounded named-array lists on `/api/v1`** — `GET /automations`,
  `GET /projects/{id}/automations`, the two `…/versions` listings, `GET /projects/{id}/folders`
  (per level) and `GET /browser-sessions` answer the whole set with no `LIMIT`; declared
  `x-tale-pagination: none` and documented as complete sets (2026-09). Paying it down means keyset
  pages behind `?cursor=` + `?limit=` on each, with the family flipped to `keyset` in
  `services/platform/scripts/openapi/spec.ts` so the envelope-family guard in
  `scripts/openapi/spec.test.ts` holds the new shape.
- **An identical zip upload rewrites the bundle** — `POST /api/app/skills/upload` (the app's
  bundle upload) stages and swaps every file and snapshots the superseded `SKILL.md` into the
  history trail even when the zip is byte-identical to the stored bundle, so `updatedAt` moves and
  a history entry appears where `PUT /api/v1/skills/{slug}` with an identical body writes nothing
  (2026-09, round e). Paying it down means comparing the normalized files (`normalizedBundleFiles`)
  against the stored bundle in `services/platform/backend/domains/skills/upload.ts` ahead of
  `writeSkillBundleFiles` and answering the stored view when nothing differs.
- **A cut tool call's arguments are not on the transcript** — when the reply cap cuts a model
  round mid-call, the stored `tool-call` part keeps `input: {}` while the raw text the model did
  emit lives only on the executor's `rawInput` (`services/platform/lib/chat/turn.ts`), so the
  timeline cannot show what was asked; the call itself no longer runs and its result reads
  `invalid_args` (2026-09, round e). Paying it down means carrying `rawInput` on the stored part
  (`MessagePart` in `services/platform/scripts/openapi/spec.ts` + the app renderer) as an
  additive field.
- **No image input on the REST chat send** — `GET /api/v1/models` advertises `capabilities.vision`
  ("Reads images") as a fact about the model, but `POST …/threads/{id}/messages` takes text only
  (`content`); the app's send carries `attachments[{fileId, fileName, fileType, fileSize}]`
  (`services/platform/backend/domains/chat/routes.ts`) into the same `runChatTurn`, whose gate
  (`backend/core/chat/turn_action.ts`, `validateTurnAttachments`) binds the blobs to the thread
  lineage and inlines an image for a vision model (`lib/chat/wire-parts.ts` lifts `image/*` parts to
  `attachmentRefs`). A data URI pasted into `content` reaches the model as text and is answered as
  text, billed (2026-09, round f). The surface now says so. Paying it down means an `attachments`
  field on the REST send naming staged uploads the key holder minted — `POST
  /api/v1/projects/{id}/uploads` for a project thread, plus an organization-level upload mint the
  unfiled `/api/v1/threads` lane lacks today — handed to `runChatTurn` as the app's
  `{fileId: <s3Ref>, fileName, fileType, fileSize}`, with the spec's send body, the `Message`
  `attachment` part on the read side, the upload allowlist (`UNSUPPORTED_FILE_TYPE`) and a
  contract bump.
- **Legacy NFD folder names beside NFC lookups** — folder names are now stored trimmed + NFC and
  every lookup canonicalises (`services/platform/backend/domains/folders/paths.ts`), but rows
  written before 2026-09 (round e) keep their bytes and the sibling index compares `lower(name)`
  only, so a sync engine's hub-path lookup can create an NFC twin beside a legacy NFD folder. No
  backfill was shipped (the `0093`/`0098` external-key precedent). Paying it down means a
  forward-only migration that canonicalises `app.folders.name` where no twin exists and detaches
  or renames the loser where one does, documented like `0098_external_keys_canonical_twins.sql`.
- **No usage or cost on a run** — `GET …/runs/{runId}` carries no `usage` block: an `llm`
  node's spend is not metered at all (`backend/core/automations/llm_call.ts` → `model_call.ts`
  parses no usage and writes no ledger row), and an `agent` node's cents settle on
  `app.sandbox_session_ops` under the automation's name and user, never on the run
  (`backend/domains/sandbox/spend-settlement.ts`, `op-attribution.ts`); the stepper drops the
  agent settle's `usage` when it records the node. A `usage` that read `0` for every `llm` node
  would be a fabricated figure, so the surface says a run carries none (2026-09, round g).
  Paying it down means (1) parsing usage in `parseChatReply` and booking it through
  `incrementUsageLedger({agentSlug: run.automation})` for `llm` nodes, (2) keeping
  `settled.usage` in the agent checkpoint trace, then (3) `?include=usage` summing both.
- **Approvals have no REST twin** — a run parked on `waitingFor: approval` can only be decided
  in the app (`backend/domains/approvals/routes.ts`); over REST the `detail`
  (`approval:<approvalId>`) names something no door takes (2026-09, round g). The ask half was
  paid down on 2026-09-18 (contract 1.16.0): `GET {run}/ask` → `{ask: PendingAsk|null}` and
  `POST {run}/asks/{askId}` `{answer, actor?}` sit beside cancel in
  `services/platform/backend/rest/v1-automations.ts` in both scopes, with `runId` on
  `answerAsk`'s locked read, the answer mirrored onto the task timeline, and `actor` (a member
  named by verified e-mail, `rest/actor.ts`, gated by `tale:rest.act-as`) so a relayed answer
  records the person; the same actor rides `POST …/tasks/{taskId}/review` (approve = the move
  to Done, request_changes = comment + restart). Paying down the approval half means, beside
  those: `GET {run}/approvals/{approvalId}` (a `connector_operation` card whose `metadata.runId`
  matches, else 404) and `POST {run}/approvals/{approvalId}` `{decision, comments?, actor?}` →
  `decideApproval`; membership for an org run, project write access for a project run, no
  developer capability, `rest:execute` charged; `ApprovalError`'s generic codes re-coded at the
  door; registry codes, schemas, docs and a contract bump.
- **A task cannot be archived or deleted over REST** — `Task.archivedAt` says "this door has
  no verb for it": the app's `POST /api/app/tasks/:taskId/archive` (`archiveTask`, editor) and
  `DELETE /api/app/tasks/:taskId` (`deleteTask`, owner/admin — the recursive retire in
  `backend/domains/tasks/retire.ts` cancels live runs, deletes the discussion thread,
  withdraws pending reviews, releases blob refs) have no twins in
  `services/platform/backend/rest/v1-tasks.ts` (2026-09, round g). Paying it down means
  `PATCH …/tasks/{taskId}` `{archived}` (the thread/project idiom, 200 `{task}`, no-op when
  already there) and `DELETE …/tasks/{taskId}` → 204 with the cascade named in its
  description, gated by `loadVisibleTask(tx, auth, projectId, taskId, {write: true})` first so
  `assertTaskWritable`'s `RBAC_FORBIDDEN`/`TASK_FORBIDDEN` never leak, the `archivedAt`
  sentences rewritten, and a contract bump.
- **A webhook bind does not say whether the deployed `inputs` schema admits a delivery** — a
  `PUT …/triggers` of kind `webhook` answers `deployed`, and every delivery then dies on 400
  `AUTOMATION_INPUT_INVALID` when the version's `inputs` schema does not take
  `{trigger: "webhook", payload}` at the top level (2026-09, round g). Paying it down means an
  additive `inputsAcceptDelivery` on the bind: compile the deployed version's `inputs` with the
  stepper's own `compileSchemaCached` key, check `{trigger: 'webhook', payload: {}}`, and
  judge only issues at `trigger`/`payload` or a top-level `is required` (requirements inside
  `payload.*` are not judged); absent without a schema or a deployment.
- **An exhausted `repeatUntil` is only a trace note** — a `repeat` node that spends its
  `maxRepeats` budget without its condition becoming true finishes the run `success` with the
  last pass's output and a free-text `trace[].note`; nothing structured says the loop gave up
  (2026-09, round g). Paying it down means `repeat: {passes, maxRepeats, satisfied}` on
  `NodeTrace` (`lib/engine/core/types.ts`, set in `backend/core/automations/stepper.ts` beside
  the note and mirrored in the in-memory executor) and a derived `repeatsExhausted: true` on
  `Run`/`RunSummary` (present only when true) in `toRunDetail`/`toRunSummary`; no migration.
- **The crawler's clocks and knobs are not on the wire** — `Website` carries no
  `scanStartedAt` (the chain argument is never persisted), and the ceilings
  the docs now state (10,000 URLs, 200 five-minute links, 25 MB / 30 s per page, five strikes)
  are constants with no page cap, path filter, wall-clock cap or stop verb of the caller's
  (2026-09, round g). Paying it down means a `scan_started_at` column on the corpus website row
  (set in `claimScan`) surfaced as `Website.scanStartedAt`, and optional `maxPages` /
  `includePaths` on `WebsiteInput` honoured by admission (the meta-robots `noindex` tag is
  honoured since round h, as the header is).
- **Website search has no dense leg and its substring fallback is silent** —
  `POST /api/v1/websites/{id}/search` is BM25 only (`paradedb.score`), and when the knowledge
  database lacks ParadeDB it falls back to an ILIKE match stamping `score: 0` on every hit with
  nothing on the wire saying so (2026-09, round g). Paying it down means `diagnostics: {leg:
  'keyword' | 'substring'}` on the response, and a `websiteId` filter on
  `POST /api/v1/knowledge/search` (`corpus: "web"`) for a per-site cosine without a second
  search stack.
- **No `Idempotency-Key` on the task start** — `POST …/tasks/{taskId}/start` runs behind a
  one-live-run-per-task invariant (the `automation_runs_one_live_per_task_subject` partial
  index and the in-transaction probe in `backend/domains/tasks/external-ref.ts`), so a retry while the
  run lives answers `already_running` with its `runId`, but a retry after it finished starts
  another run (2026-09, round g). Paying it down means `beginRunIdempotentInTx` behind
  `readIdempotencyKey(c)` with a door-specific request hash over `{taskId, workflowSlug}` —
  the default hash covers the task's `title` and `status`, which the workflow itself moves, so
  an honest retry would otherwise answer 409 `IDEMPOTENCY_KEY_REUSED`.
- **No queue position on a queued send** — the generation poll answers `queued` with no
  count of the accepted sends ahead; the deployment-wide queue is one `pg-boss` queue worked in
  batches of `WORKER_CONCURRENCY` (2026-09, round g). Paying it down means `queuedAhead` from
  `count(*) … WHERE generation_queued_since_ms < ${thread.queuedSince}` on
  `app.thread_metadata` behind a partial index (create-migration skill), an additive field on
  the poll and a contract bump; no ETA — batch waves times a turn's own length make any figure
  dishonest.
- **A corrupt Office document still fails as a raw parse error** — a PDF that does not parse
  now lands `unsupported` with `errorCode: malformed`, but `docx`/`pptx`/`xlsx`/`odt` parse
  failures ("Invalid or corrupt file" in `backend/core/lib/knowledge/extraction/{ooxml,pptx,
  xlsx,odt}.ts`) still reach the catch-all as `failed` + `indexer_error` and are retried five
  times (2026-09, round g). Paying it down means wrapping those throws in
  `ExtractionError('malformed')` the way `pdf.ts` does.
- **No `/.well-known/security.txt`** — nothing serves RFC 9116's disclosure channel; the path
  falls to the SPA tier's JSON 404 while the contact exists only in `.github/SECURITY.md`
  (2026-09, round g). Paying it down means an env-gated route in `server.ts` ahead of the SPA
  fallback (`SECURITY_CONTACT` = `mailto:`/`https:`/`tel:`, optional `SECURITY_POLICY_URL`,
  `Expires` under a year, `Canonical`), its `.env.example` block and environment-reference row,
  a `server.test.ts` case each way, and the operator's decision on the contact.
- **No changelog feed** — `tale.dev/changelog` prerenders a build-time snapshot and swaps in
  `/api/releases` after hydration, so `curl` and LLM readers see the image's release; there is
  no Atom/RSS render and a failing runtime refresh is only a `console.warn` (2026-09, round g).
  Paying it down means `<link rel="alternate">` to `/api/releases` on the page plus an llms.txt
  entry, `releasesFetchedAt`/`source` in the web health status reported through
  `monitoring.capture` when the last good fetch is older than six hours, and optionally a
  `/changelog.atom` render of the same list.
- **No SDK, collection or per-code table** — `openapi.json` is the generator-ready contract
  and the error registry (`backend/rest/error-codes.ts`) publishes names only: no per-code
  description or status map exists, so a generated table would be a bare list (2026-09,
  round g). The reference now gives the keyless `jq` recipe over the enum. Paying it down means
  a `{status, description}` map beside each registry entry, rendered into the reference by a
  docs build step with a guard test that every backticked `UPPER_SNAKE` token in
  `docs/en/develop/api-reference.md` is in the registry.
- **Notifications are untyped and poll-only** — `GET /api/v1/notifications` rows carry `type`
  as a free string with no closed vocabulary on the wire, and nothing pushes them (no SSE or
  webhook lane for a machine caller; `/events` is the app session's) (2026-09, round h). Paying
  it down means an enum over the emitters' kinds in `spec.ts` (the `notification_kinds` the
  domain already switches on) and a `since` parameter documented as the poll cursor.
- **A skill keeps no version history on the machine door** — `PUT /api/v1/skills/{slug}`
  replaces the bundle, and the superseded `SKILL.md` history the app keeps is not readable
  through `/api/v1` (2026-09, round h; the reference says so). Paying it down means
  `GET /api/v1/skills/{slug}/versions` over the app's history rows, same shape as the knowledge
  entries' `…/{id}/versions`.
- **The per-task circuit breaker is not built** — no counter pauses automation on a task after
  N automated runs in an hour; the one-engine rule and cancel are the only stops, and the docs
  now say so (2026-09, round h). Paying it down means a per-task window count on
  `app.automation_runs` (org, task subject, `started_at_ms`) checked in the task-start probe
  (`external-ref.ts`) answering 429 `TASK_AUTOMATION_PAUSED` until a human moves the status,
  and the guardrails bullet restored.
- **Mirrored conversation messages have no read-back** — `GET /api/v1/conversations` lists the
  mirrors, but the messages a snapshot applied are readable only in the app; a mirror cannot
  verify what landed (2026-09, round h). Paying it down means
  `GET /api/v1/conversations/{id}/messages` under the owner rule, keyset by
  (`createdAt`, `messageId`), attachments as refs.
- **A queued send is invisible on the message list** — while a turn waits in the deployment
  queue, `GET …/threads/{id}/messages` answers a complete page without it and
  `…/messages/{messageId}` 404s the id the 202 named; the generation poll is its only view
  (2026-09, round i). The reference says so. Paying it down means listing the user turn and a
  `pending` assistant row from the moment the send is accepted, not when a worker opens it.
- **A webhook delivery the deployed `inputs` schema refuses moves no trigger stamp** — the
  400 goes to the sender and `lastSkippedAt` / `lastSkipReason` stay as they were, so a binding
  refusing every delivery reads as never called (2026-09, round i). The reference says so.
  Paying it down means a `delivery_refused` skip reason stamped from the webhook door beside
  `start_refused`.
- **MCP `run_deployed` keys its idempotency apart from `start_run` and REST** — one key shared
  across them hard-fails `IDEMPOTENCY_KEY_REUSED` both ways and never answers the `duplicate`
  marker its schema documents (2026-09, round i). Paying it down means one ledger namespace
  for the three doors and the marker on the reply.
- **A page is fetched three to four times a scan** — the plain probe, the render pass and, for
  the homepage, a create-time metadata probe. The robots parser now honours group selection by
  product token (`User-agent: TaleBot` > `*`), `Allow` with longest-match precedence, `$`
  end-anchors and `Crawl-delay` (`lib/knowledge/crawl-parse.ts`, 2026-09 round J); paying down the
  remaining fetch count means one fetch per page per scan.
- **A cancelled run answers `trace: null` and `effects: null`** where a failed run answers both,
  so what a cancel did not undo is readable only through `checkpoints` (2026-09, round i).
  Paying it down means keeping the partial trace the way the failed path does.
