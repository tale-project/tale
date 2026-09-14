# Tale — the repo contract

Repo-specific rules for the Tale monorepo. The shared contract in [`AGENTS.md`](../AGENTS.md)
applies first; this file adds what is true only here.

Tale is a monorepo on Bun workspaces; every workspace script runs through
`bun run --filter @tale/<workspace> <script>`.

## Layout

- `services/` — deployable units: `platform` (the flagship app: Vite + React 19 + TanStack Router +
  the Postgres backend), `web` (marketing site), `docs` (docs site), plus `db`, `proxy`, and the
  `sandbox*` family.
- `packages/` — `ui` (the design system), `shared` (schemas + pg), `e2e` (Playwright config
  factory).
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
  [`design/`](../design/) and `@tale/ui` first, then build to it.**

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
  `fr`, `de-CH` overrides, `packages/ui` messages, docs trees) in the same change, following the
  [`write-translations`](skills/write-translations/SKILL.md) skill. A key present in one catalog
  and missing in another is a defect, not a follow-up.
- **Scaffold new parts from templates** — beyond the shared `gen:package|service|tool|skill`, tale
  adds `bun run gen:migration` and `bun run gen:episode` (docs-video episodes).
- **Three manual layers, one shape** — `services/{platform,web,docs}/tests/manual/` each carry the
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
| [`write-docs`](skills/write-docs/SKILL.md)                 | writing/editing any end-user docs page — journey-first, with the repo facts in `docs/AGENTS.md`  |
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
  `services/platform`, `services/web`, `services/docs`, `packages/ui` (~450 sites, 2026-08).
- **`promise/always-return`** — off in the same four workspaces.
- **`import/no-cycle`** — off in `services/platform` only (21 cycles, 2026-08).
- **jsx-a11y trio** (`no-noninteractive-element-to-interactive-role`, `interactive-supports-focus`,
  `no-noninteractive-element-interactions`, `no-noninteractive-tabindex`) — off in
  `services/platform` only (11 sites needing real markup work, 2026-08).
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
- **No single-file read on `/api/v1/projects/{id}/files`** — a project file's metadata
  (`fileName`, `folderId`, `size`, `indexing`) is readable only as a row of the folder listing
  (`GET /projects/{id}/files?folderId=`), so a poller waiting for one file's `indexing` after
  `POST …/files/{documentId}/retry-indexing` walks the listing (2026-09, round e; the
  `OBJECT_STORE_UNAVAILABLE` register row used to name a `GET …/files/{documentId}` that never
  existed). Paying it down means a `GET /api/v1/projects/{id}/files/{documentId}` answering the
  `ProjectFile` row through the shared `loadProjectFile` load in
  `services/platform/backend/rest/v1-projects.ts`, with its spec operation, an `ETag` + 304 like
  every JSON read, and a `FILE_NOT_FOUND` register row.
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
