# Tale — the repo contract

Repo-specific rules for the Tale monorepo. The shared contract in [`AGENTS.md`](../AGENTS.md)
applies first; this file adds what is true only here.

Tale is a monorepo on Bun workspaces; every workspace script runs through
`bun run --filter @tale/<workspace> <script>`.

## Layout

- `services/` — deployable units: `platform` (the flagship app: Vite + React 19 + TanStack Router +
  the Postgres backend), `web` (marketing site), `docs` (docs site at docs.tale.dev), `ui-docs`
  (the design-system docs site at [ui.tale.dev](https://ui.tale.dev), port 3003:
  app-language documentation at `/` and `/docs/*` with live `<Demo>` examples), plus `db`,
  `proxy`, and the `sandbox*` family. `docs` and `ui-docs` render
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
  tale-project repo — fix a rule in `example-project` and roll it, never here), `lint-links`
  (the link gate for the two documentation sites, `bun run lint:links`).
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
  mid-roll; a backfill that must decide with the app's own code (never a SQL copy of it) is a
  numbered `.ts` data migration in the same directory and order, which writes every statement
  itself and imports only pure rules (it runs against the schema at its number, with the newest
  image's code). The real-Postgres proof is
  `bun run --filter @tale/platform backend:integration`, which CI's **Backend integration** check
  runs against the `tale-db` image built from the change and the CLI's object-store pin (there is
  no separate migrations gate or generated registry — filename order is the registry).
  Scaffold with `bun run gen:migration` and follow the
  [`create-migration`](skills/create-migration/SKILL.md) skill.
- **Spend is booked under a person, never a door** — every `app.usage_ledger` write names its
  subject by bare user id (or the `__automation__` sentinel for a run a trigger started), plus the
  API key when one authenticated the start; a run's `started_by` is the door (`user:` /
  `api-key:` / `trigger:`) and is read only through `lib/shared/run-starter.ts`. The contract,
  lanes, readers and guards: [`services/platform/backend/domains/governance/README.md`](../services/platform/backend/domains/governance/README.md).
- **Every locale is covered, always** — a user-visible string never ships in fewer languages than
  the app supports: adding/changing/removing a key touches `en` AND every sibling locale (`de`,
  `fr`, relevant sparse `de-CH` overrides, shared package messages, and translated docs trees) in the same change, following the
  [`write-translations`](skills/write-translations/SKILL.md) skill. A key present in one catalog
  and missing in another full catalog is a defect, not a follow-up. Shared controls own their keys
  in `packages/ui`; marketing frames own theirs in `packages/marketing-ui`. Service catalogs
  override package keys per leaf. The platform keeps one file per topic and locale
  (`services/platform/messages/<locale>/<topic>.yml`, a topic being one top-level namespace), and
  every locale has the same topic files — `de-CH` only the ones it overrides; the i18n parity
  tests enforce both. Every locale also loads per topic: English ships with the modules that name
  a topic (the `messageTopics` plugin in `services/platform/vite.config.ts`), and the other
  locales are fetched as the session's pages need them. So name a namespace literally where it is
  read (`useT('tasks')`, `{ ns: 'tasks' }`); `lib/i18n/topic-references.test.ts` refuses a
  computed one. The product docs ship EN/DE/FR; `services/ui-docs/content` is
  an English-only guide with complete EN/DE/FR chrome catalogs.
- **A failure shows its words, never its payload** — a toast or an Alert reads what a call threw
  through `failureDetail` (`services/platform/app/lib/backend/adapters.ts`: a refusal's own words,
  a lapsed session and a lost connection as localized sentences, nothing for a fault) or, in
  `packages/ui`, through `readableErrorMessage` (`@tale/ui/error-message`), the floor
  `failureDetail` builds on: a plain error's sentence, and nothing for a structured error, a
  runtime error (`TypeError`, `SyntaxError`, …) or a thrown non-error. Never through
  `error.message`, where an `AppError` serializes its whole payload.
  `services/platform/tests/guards/error-message-description.guard.test.ts` fails on a
  `description` or `title` built from an error's message under `services/platform/app` and
  `packages/ui/src`.
- **One failure, one toast** — a failed `useBackendMutation` / `useBackendAction` raises a
  destructive toast of its own unless its call passes `errorToast: false`; a custom `errorToast`
  still toasts, and so does a `mutateAsync` awaited inside the caller's own `try`. A failure is
  reported once: by that default toast, or by the caller — its `catch`, `.catch` or `onError`
  toast, a batch's summary toast, `EditorActions` (and `useFormEditor`'s native submit) for a
  controller whose `save` rethrows (a `useFormEditor`, or a hand-written `EditorController`),
  `BulkDeleteBar` / `BulkArchiveBar` / `EntityDeleteDialog` for a callback that rejects (give
  them `describeFailure`, so their one toast keeps the reason), `EnvVarListEditor` for an
  `onSet` / `onDelete` that rejects, a react-query `queryFn` that runs the write (each retry
  would toast; report the query's final error once) — never both. A caller that reports opts
  out: in the hook when every caller reports, else through the hook's options at that call site;
  a caller that only logs keeps the default toast. A write that opts out is reported from its
  call's own promise (`mutateAsync(args).then(onSuccess, onError)`, or a `try`), or keeps its
  own toast (a custom `errorToast` with the verb's title and `failureDetail`) — never from
  `mutate(args, { onError })` alone: react-query drops that callback once another `mutate`
  starts on the same hook or the caller unmounts first, and the failure goes unreported.
  `services/platform/tests/guards/single-failure-toast.guard.test.ts` follows each write's
  rejection to what reports it, and fails on a second toast, on a quiet write whose one report
  hangs on `mutate`'s `onError`, and on a batch surface without `describeFailure`.
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
- **A domain's rules are a checked spec** — `services/platform/backend/domains/<domain>/spec.md`
  states what a domain guarantees for a reader who has not opened the code, in the shape
  [`spec-template.md`](../services/platform/backend/domains/spec-template.md) describes: a prefix
  shared with the feature's manual suite (`TASK-R4` beside `TASK-F63`), topic headings a reader
  would look up, one card per rule, then Not yet. A card's heading is the rule as one plain
  sentence ("Only owners and admins can delete a task"); under it comes an example with a named
  person. A spec carries rules and nothing about them: no status and no list of tests. Whether
  a rule is the intended one is settled in the review of the change that adds it. Never guess
  an intent: a question nobody has decided goes under Not yet as `**Undecided: …?**`, not into
  a rule. A test holds every rule and says so in its title (`it('… [TASK-R4]', …)`, or the
  `describe` when the whole block does). The guard,
  `services/platform/tests/guards/domain-specs.guard.test.ts`, parses every spec and the test
  titles of the workspace, and fails on a shape it does not know, a rule with no example, a
  rule no running test names, and a title that names a rule no spec states. Change what a rule
  says the code does, and its card and its test move in the same change. Every domain under
  `backend/domains/` has a spec (2026-10). A spec covers part of its domain and says which
  parts it leaves out; a rule the code keeps and no test holds is listed under its Not yet,
  not as a rule.
- **Pencil**: `design/docs/comments.md` is strictly designer↔developer UI communication. Put
  code-level bug analysis in a GitHub issue, never there.
- **Git**: branch off `main`, never commit to it; PRs squash-merge (linear history), so the PR
  title must itself be commitlint-shaped.
- **A release tags one validated candidate** — a version tag goes only on the full `main` SHA
  whose `build.yml` candidate run and release gate
  (`tools/cli/scripts/release-candidate-gate.ts`) passed, and merging never freezes for it:
  [`.github/RELEASING.md`](../.github/RELEASING.md).
- **No conflict markers** — `bun run lint:conflicts` (`scripts/check-conflict-markers.ts`)
  refuses a `<<<<<<<`, `|||||||` or `>>>>>>>` line in any tracked text file: the pre-commit hook
  runs it on the staged files, CI's Format job and `bun run check` on the whole tree. Markdown and
  shell still parse with a conflict left in them, and one was committed that way (2026-09).
- **A published docs address never turns into a 404** — every page slug docs.tale.dev and
  ui.tale.dev ever served is recorded in `docs/published.json` and
  `services/ui-docs/content/published.json` (append-only; the content build records new pages), and
  each must still answer as a page or through its site's `redirects.json`. Moving, merging or
  deleting a page therefore needs a redirect for its old slug, or the published suites fail. Every
  link in the two sites and every link into them from the rest of the repository (in-app help, the
  marketing site, the CLI, READMEs) must land on a page directly: not a 404, not a redirect.
  `bun run lint:links` (`tools/lint-links`, CI's Format job and `bun run check`) enforces this. It
  compares a change with its base commit, and refuses a deleted or renamed page whose old address
  now 404s or a line removed from a ledger. `test:prerender` crawls the built sites after `build`.
  The retirement procedure is in [`docs/AGENTS.md`](../docs/AGENTS.md#retire-rename-or-merge-a-page). An address that names nothing (a guess, a
  retired `/de-CH/…` tree) is answered by the near-miss resolver (`@tale/ui/docs/near-miss`)
  before the 404 page: a 359-of-932 loss of published URLs and agents guessing translated slugs
  showed why (2026-09).
- **A patched dependency stays pinned, proven and dated** — `patches/` holds the Bun
  `patchedDependencies` patches (today postgres.js 3.4.7, #4041), and
  [`patches/README.md`](../patches/README.md) says for each why it exists, which test proves it and
  when to remove it. Every Dockerfile that installs from the root manifests copies `patches/`
  (`bun install` fails without a listed patch), and bumping a patched package regenerates or
  deletes its patch in the same change.

## A green check is not always a run

The seven workflow-specific **CI ready** terminal jobs judge complete native PR/merge-group
dependencies and validated scope. Their source contract, conditional/advisory limits and
separate required-check activation procedure are in [`.github/CI.md`](../.github/CI.md).
They do not replace independent review or the release-candidate gate.

Most CI check jobs use `setup-turbo` plus a root script, so many results are **replays**:
`@tale/ui:test:browser`, for instance, actually executed four times in one recent stretch of
forty `checks.yml` runs. Whichever run first executes a given input hash freezes its verdict for
every later run that shares those inputs — so a task that is flaky but passed once reads green
until its inputs change, and "it passes on `main`" is not evidence the suite ran there. Before
concluding that a failure is yours, inspect the task cache status in the job's `turbo-*`
artifact. Most check jobs print only failing logs; the summary preserves per-task execution
evidence. Type check retains full logs (`cache hit, replaying logs`); `--output-logs=full`
restores that detail locally, and `--force` re-runs the task. A task whose result depends on anything but its
declared inputs — test file ordering, wall-clock, a shared browser page — is not safely
cacheable, and the fix is the determinism, not the cache.

For a candidate whose source C differs from workflow H, Turbo's summary `scm.sha`
uses the CI environment's H. Verify C from the checkout log and the cache action's
actual `git rev-parse HEAD` source key; keep task cache HIT/MISS evidence separate
from source identity. [The CI guide](../.github/CI.md) records the upstream behavior
and the observed C/H proof.

The stable **Unit** check aggregates two platform unit shards and a separate job for
every other workspace's unit tests. Both platform shards retain the live YouTube service
and the PII project's isolation policy. The aggregate needs no dependency installation
and rejects failed, cancelled, skipped or missing results. Candidate receipts require
every individual unit job as well as the aggregate.

The stable **UI** check aggregates four platform UI shards and fails unless all four
succeed. It does not install dependencies. Shard 1 also runs every other workspace's
`test:ui` once; the platform shards retain the suite's bounded worker pool. **E2E** uses
four single-worker platform shards, each with its own stack, and builds the preview
bundle once through the same Turbo task used by Checks. A run artifact carries those
exact bytes to every shard through the build's validated immutable artifact ID.
Full reruns publish a new attempt-specific artifact; failed-only reruns reuse the
successful build's original ID. Unit and UI workers reuse a job-local Node bytecode
cache without relaxing isolation. Static-site browser and web prerender suites also reuse
one complete Turbo build, including client, SSR, SEO, frontmatter and translated search
outputs. Native cache archives share a build scope but retain distinct workflow/job/matrix
writers. Hosted jobs use Turbo's native 512 MiB startup eviction target. Eviction
is best-effort; short runs or new outputs can leave a larger saved archive.
Local shared caches keep their existing policy. Chromium caches use the installed Playwright version,
runner OS and architecture. E2E and cold Browser jobs install its headless shell and
native dependencies; a Browser task whose complete executable prerequisite graph has
verified local hits can skip provisioning while still running its normal Turbo command.
The probe and verdict disable archive eviction to keep those hits available. See [the CI scheduling guide](../.github/CI.md).

Web E2E's SEO step runs the workspace script directly against its browser-tested build:
release fetching rewrites a tracked snapshot, so another Turbo prerequisite invocation
would rebuild different bytes. Historical candidates keep forced, uncached static builds
because their browser configs can predate preview reuse and overwrite prerendered HTML.

E2E pull requests first compute a fail-closed platform, web and docs service scope;
candidates, nightly and manual runs select every service. Candidate receipts require
the scope, the stable UI aggregate and every individual UI and E2E shard.

The **Type check** job gives every `tsc` a 6 GiB Node heap (`NODE_OPTIONS`, #4005). The
platform checks its frontend, backend and tests as one program, which outgrew V8's default of
about 4 GiB on the hosted runner. The job logs the Node it resolves, the heap limit, each
program's `--extendedDiagnostics` and the largest process's peak RSS. `NODE_OPTIONS` is not
part of a task's hash, so a budget change alone replays cached verdicts; the pass-through
`--extendedDiagnostics` is. A job that dies with `Ineffective mark-compacts near heap limit`
(exit 137) and no TypeScript diagnostic has run out of budget. Measure before you read it as a
type error or raise the budget.

The **Backend integration** check is always a run: it calls `backend:integration` directly,
never through turbo, with `ITEST_REQUIRE_ALL_LANES=1`, so a lane that cannot run fails instead of
skipping. Its **Integration scope** job owes it to every push to `main`, merge group and release
candidate, and to a pull request that touches the backend, its libraries, either database's
migrations, the database image, the object-store pin, the dependencies or `checks.yml`; on other
pull requests the check reads skipped, and when the scope job itself fails the check fails. The
path list is held to every module the harness imports and every file it reads by
`services/platform/tests/guards/integration-scope.guard.test.ts`: a new import from outside the
list fails that guard until the list names it.

A green **Playwright** job in `e2e.yml` can still hold a failure: CI retries a failed test twice
(`@tale/e2e/config`), and a test that passes on a retry leaves its job green. Such a job carries
a **Playwright diagnostics** notice and uploads the same report and test results a failed job
does, as `playwright-report-<shard|service>-attempt-<n>` for 14 days (#4013). Open that artifact
before you call a run clean; the platform shards and the static sites share the step, and
`tools/cli/scripts/deployment-ci.test.ts` holds both to it. When the step cannot read
`test-results/`, it fails the job with a **Playwright diagnostics** error instead of reading
clean, and the upload runs as for any failure.

Turbo's default source inputs cover a task's own workspace. A task that reads a file outside
it lists the file in its workspace's `turbo.json` `inputs`; otherwise an edit to that file
alone replays the cached verdict. Open the list with `$TURBO_EXTENDS$` (keeps the root task's
inputs, which a workspace list otherwise replaces) and `$TURBO_DEFAULT$` (keeps the workspace's
own files), then list the outside files as `$TURBO_ROOT$/<path>`:

- [`services/platform/turbo.json`](../services/platform/turbo.json) gives `@tale/platform`'s
  tests the catalogs under `configs/platform/`, compose files, tale-db init scripts,
  the shared automation-name grammar inspected by the engine purity guard,
  knowledge-db migrations, `packages/ui/src` (two suites read it as text), `checks.yml` (the
  integration scope guard) and other outside files; its `test:ui` and `test:browser` list `packages/ui/src` as well, since their
  component suites render it, and all three list `@tale/ui`'s `package.json` and every file
  it exports from outside `src/` (`tailwind-preset.ts`). Its `lint` and `typecheck` list the
  sandbox runtime's `build-gemini-settings.ts` and daemon `file-ops.ts` and
  `exec-replay.ts`, which suites import, plus the daemon modules' shared `protocol.ts`:
  `tsc` and oxlint's type-aware rules type every module the sources import. Its guard is
  `services/platform/tests/guards/turbo-inputs.guard.test.ts`. The catalog glob explicitly
  excludes nested `.turbo/` output: explicit inputs include otherwise ignored task logs, so
  running a catalog skill must not invalidate the platform test cache. The guard changes logs
  and real catalog/skill source in an isolated Git fixture and checks the actual Turbo hashes.
  Component tasks exclude unrelated backend trees and manual/E2E evidence; the same guard
  follows runtime imports and re-exports and requires every visited module and source-text read
  to remain hashed, including recursive workspace dependencies. Keep that proof green before
  narrowing a component input list.
- [`services/sandbox-runtime/daemon/turbo.json`](../services/sandbox-runtime/daemon/turbo.json)
  gives daemon tests, type-aware lint and typecheck the sandbox client closure reached by
  `src/exec-completion.test.ts`: `session/runnerd-client.ts`, `session/runnerd-protocol.ts`
  and `operation-budget.ts` under `services/sandbox/src`. The dependency fixture in
  `tools/cli/scripts/turbo-dependencies.test.ts` proves each edit invalidates those checks
  while unrelated sandbox source and the daemon's production build retain their hashes.
- [`services/docs/turbo.json`](../services/docs/turbo.json) gives `@tale/docs` the root `docs/`
  tree (test, build), its JSON maps (typecheck, lint), and the root `README*.md` plus `@tale/ui`'s
  i18n catalogs and test framework (test). Its guard is `services/docs/tests/turbo-inputs.test.ts`.
- [`tools/cli/turbo.json`](../tools/cli/turbo.json) hashes the shared root
  `.github/release-candidate-contract.json` through CLI transit for lint/typecheck/test
  and directly for its source-reading tests. The candidate contract refresh script
  and existing graph guard own its admission assertions; `.github/RELEASING.md`
  describes the reviewed Ops digest transition. It also gives `@tale/cli`'s tests the CLI install
  pages; the CI files `scripts/deployment-ci.test.ts` and the candidate graph suite
  (`scripts/release-candidate-workflows.test.ts`) check: the `build.yml`, `checks.yml`,
  `cleanup-pr-images.yml`, `commitlint.yml`, `e2e.yml`, `sast.yml`, `security.yml` and both
  `release-candidate-*` workflows and the `setup-cli` action, plus the container image harness used to prove fork
  build coverage; the files the compose parity
  suite reads: `compose.yml`, the proxy's `Caddyfile` and entrypoint, the platform's
  `Dockerfile`, entrypoint and `env.sh`, the db and sandbox-egress `Dockerfile`s, and the
  `cli.yml` and `release.yml` workflows. The runtime suites prepare, read and apply the
  release's own `compose.yml` and proxy `Caddyfile` (`REPOSITORY_RUNTIME_SOURCE` in
  `runtime-test-helper.ts`). The package publication suite also reads the publisher, root
  `LICENSE`, both published packages’ manifests and READMEs, and `publish-packages.yml`.
  Its guard is `tools/cli/src/lib/config/platform-docs.test.ts`.

These guards ask `turbo --dry=json` whether the files are hashed. Each also reads its
`turbo.json` to hold the two-entry prefix, since the dry run hashes the same files with or
without `$TURBO_EXTENDS$` while no root task declares inputs. A suite that starts reading
another outside file adds it to both the task's inputs and its guard.

Generic workspace checks depend on `^transit`: scriptless nodes recursively hash
dependency workspaces. A shared package change therefore invalidates its consumers
without serializing their actual test, lint or typecheck processes. Each check's
effective inputs hash its own selected source, preserving component input narrowing.
CLI checks also depend on their own `transit` to hash their extra outside-module closure.
Explicit outside-file inputs remain necessary for imports and reads that are not
workspace dependencies. The platform's UI input guards still hold its direct source
reads and exported files to that contract. Every root `tsconfig*.json`, `bunfig.toml`,
lint and formatter configuration, patch and the setup action participate in the global hash.
The UI, marketing-UI and E2E transit lists omit only package-root `README.md` prose;
package-owned checks and ordinary `^build` consumers keep their default inputs, and CLI
publication tests explicitly hash the published READMEs. Source, catalogs, exports and
toolchains still invalidate consumers. The dependency fixture also models the root's
`@tale/shared` dependency: its README must retain global invalidation, since narrowing
only shared transit would not change that separate hash.

Checks skip echo-only setup tasks. The CLI keeps its real generation prerequisite explicitly;
a workspace that adds substantive setup must attach it to its checks. The dependency fixture
holds workspace setup scripts to this contract.

CLI generation and builds record the checkout's Git revision and clean state; they are
uncached because those values are not source-file hashes. CI generates that identity before
changing the tracked package version and then compiles the same module on every target.
The Windows CI entry `build:windows:compile` shares the compiler and bundle check with
`build:windows`; only the public local entry regenerates identity. An older candidate/tag
checkout may lack that helper: after generation and version injection, CI derives it only
from the selected source's known `bun run generate && bun build --compile …` script,
preserving its compiler arguments and bundle check. Unrecognized or invalid entries fail.
Dirty local source must still record `clean: false`. CLI transit inputs cover its
generator's embedded trees and the platform modules reached by relative imports;
module-closure and generator-tree guards require those actual outside inputs to be hashed.
CLI lint/test run generation directly and do not repeat the setup alias. External catalog
inputs exclude nested `.turbo/` logs and `*.tsbuildinfo` incremental outputs; CLI embedding
already omits both. The real Turbo fixture in
`tools/cli/scripts/ci-cache-optimization.test.ts` proves creating and rewriting either
artifact preserves consumer hashes while real catalog sources and toolchain inputs invalidate them.
Do not cache these artifacts without including and
verifying their complete source identity.

`setup-turbo` always runs a frozen install. Its download cache separates OS,
architecture, Bun version, manifests, lockfile and patches, and saves after a successful
install so a later workload failure does not lose the downloaded packages.
CLI's Windows native row keeps its Bun store beside the checkout, outside the source
tree, to permit same-volume hardlinks; Linux/macOS native rows retain their home store.
Native Windows skips download-archive restore/save; its normalized store still backs
the complete frozen install. Other native and cross rows retain their archives.
All native rows keep the full frozen install. Cross rows retain the separate CLI-only
store and filtered frozen install.
Browser checks and Playwright share an exact installed-version/OS/architecture
headless-shell cache. Successful browser provisioning is saved before later suites can
fail. Native dependencies are installed for every E2E runner and cold Browser run;
fully cached Browser prerequisites use the guarded exception above.
Shared setup pins Node from the production image and hashes actual Bun/Node/OS/architecture/
distribution identity. Keep unknown or forced Browser plans on the cold path.
The [CI guide](../.github/CI.md) documents task cache boundaries and the four-way
UI and platform Playwright matrices, including their required release evidence.

## Skills index

Repo-dev skills live in [`.agents/skills/`](skills/); run `bun run skills:sync` after editing one.

| Skill                                                      | Read before…                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`create-migration`](skills/create-migration/SKILL.md)     | adding/changing/testing a versioned data migration, or a red `backend:integration` / corpus gate |
| [`write-docs`](skills/write-docs/SKILL.md)                 | writing/editing product or component guides — follow the affected content tree’s contract        |
| [`write-translations`](skills/write-translations/SKILL.md) | editing any non-English locale file or doc, or touching the glossary                             |

The product skills are not repo-dev workflows: they live under
[`configs/platform/custom/skills/`](../configs/platform/custom/skills/) as the builtin catalog every
org is seeded with — `visual-aspect-analyzer` (also baked into the sandbox image for its
Playwright/Chromium deps) plus the official document skills `docx`, `pdf`, `pptx`, `xlsx`, whose
Python and Node libraries the sandbox image bakes from hash-locked files
(`services/sandbox-runtime/document-python-requirements.txt`, `document-node/`) while the skills
themselves stay org-seeded.

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
- **`DataTable` rows that open only on pointer click** — `onRowClick` is a bare `onClick` on a
  `<tr>`, and the data-table guide's rule ("keep a named keyboard-accessible link or action in the
  row") is enforced by no lint. The automations list, the projects list and the metrics
  drill-down tables carry a real link/button in the lead cell (2026-09); the other `onRowClick`
  lists (contacts, knowledge entries, skills, websites, teams, audit logs, …) still rely on the row click alone
  where the lead cell is plain text. Paying it down means the same lead-cell control per list, or
  a `DataTable` `rowLink` prop rendering the first cell as the row's link for every list at once.

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
- **A task cannot be deleted over REST** — the app's `DELETE /api/app/tasks/:taskId`
  (`deleteTask`, owner/admin — the recursive retire in `backend/domains/tasks/retire.ts`
  cancels live runs, deletes the discussion thread, withdraws pending reviews, releases blob
  refs) has no twin in `services/platform/backend/rest/v1-tasks.ts` (2026-09, round g). The
  archive half was paid down on 2026-09-21 (contract 1.20.0): `PATCH …/tasks/{taskId}`
  `{archived}` runs the board's `archiveTask`/`restoreTask` inside the door's serializable
  transaction, idempotent both ways, behind the active-project check, the project-scoped task
  lookup and the task's work gate (an archived task must stay writable there, or nothing could
  restore it). Paying down the delete means `DELETE …/tasks/{taskId}` → 204 with the cascade
  named in its description, gated the way the PATCH is (the active project, the task's own
  project, then `assertTaskWorkable` — an archived task stays deletable) so its
  `TASK_FORBIDDEN` never leaks, `deleteTask`'s owner/admin rule surfaced as 403
  `ROLE_FORBIDDEN`, and a contract bump.
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
  the docs now state (10,000 URLs, 200 five-minute links, 100 MiB / 30 s per page, five strikes)
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
  count of the accepted sends ahead; the deployment-wide queue is one `pg-boss` queue worked through
  independent slots at `WORKER_CONCURRENCY` (2026-09, round g). Paying it down means `queuedAhead` from
  `count(*) … WHERE generation_queued_since_ms < ${thread.queuedSince}` on
  `app.thread_metadata` behind a partial index (create-migration skill), an additive field on
  the poll and a contract bump; no ETA — turn durations and provider capacity make any figure
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
- **The per-task circuit breaker covers project agents only** — starts of a project agent by an
  automation step or another agent stop after three per task in a rolling hour, their automatic
  retries included except a single broker cooldown immediately after the same agent's HTTP 429
  (`freeCooldownWaits`; consecutive cooldowns still count)
  (`AUTOMATED_STARTS_PER_TASK_PER_HOUR`, `backend/domains/tasks/delegated-start.ts`, refused as
  `paused` with an `agent_run.refused` timeline row, 2026-09-29), but nothing counts AUTOMATION
  runs on a task: between two automations that keep mentioning each other the one-engine rule and
  cancel are the only stops, and the docs say so (2026-09, round h). Paying it down means a
  per-task window count on `app.automation_runs` (org, task subject, `started_at_ms`) checked in
  the task-start probe (`external-ref.ts`) answering 429 `TASK_AUTOMATION_PAUSED` until a human
  moves the status, and the guardrails bullet restored.
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
- **A changed page is fetched twice a scan** — the plain probe and the render pass — and the
  homepage once more at create, for its metadata. A page that did not change is asked for once
  and not rendered (2026-10: the probe's validators and the text of its plain HTML decide,
  `core/knowledge/crawl_action.ts`); a page built by its JavaScript is still rendered on every
  scan. The robots parser honours group selection by product token (`User-agent: TaleBot` >
  `*`), `Allow` with longest-match precedence, `$` end-anchors and `Crawl-delay`
  (`lib/knowledge/crawl-parse.ts`, 2026-09 round J). Paying down the rest means one fetch per
  changed page: a server-rendered page read from the probe's own bytes, without the browser.
- **A cancelled run answers `trace: null` and `effects: null`** where a failed run answers both,
  so what a cancel did not undo is readable only through `checkpoints` (2026-09, round i).
  Paying it down means keeping the partial trace the way the failed path does.
- **`app.usage_events` is write-retired, not dropped** — the chat lane stopped writing the
  per-turn row (no reader ever folded it; `0110`, 2026-09); erasure and retention still sweep its
  legacy rows. Paying it down means a `DROP TABLE` migration one release after every image has
  stopped writing it, and removing the two sweeps with it.
- **`app.memories` and `user_preferences.memories_enabled` are retired, not dropped** — chat
  memories lost their routes, their capability methods and the `user_memories` policy
  (2026-09-27); nothing reads or writes either any more, but rows proposed while the review UI
  shipped may exist, and organization deletion and erasure still sweep the table. Paying it down
  means a migration that drops both once a release has run without them, with the erasure pass
  and its breakdown category going in the same change.
- **`private_knowledge.semantic_cache` is an empty table** — the knowledge baseline creates it, and
  `backend/core/knowledge/teardown.ts` still keeps it in step, but the cache seam that could have
  filled it was removed without ever shipping an implementation (2026-09-27). Paying it down means
  a knowledge-db migration that drops it, with that upkeep removed in the same change.
- **`chunks.embedding` is retired, not dropped** — vectors live in a table per width beside the
  chunks (`chunk_vectors_<width>`, knowledge-db migrations `15` and `16`, 2026-10-06), and nothing
  reads or writes the old column in either corpus schema. It stays for one release, with its HNSW
  index and `create_chunks_hnsw_index()`, because the previous image still uses it while a
  deployment rolls; the `chunks_mirror_legacy_embedding` trigger copies what that image writes
  into the table of its width. Until the column goes, a corpus that was migrated stores its
  vectors twice. Paying it down means one knowledge-db migration per schema, a release after every
  image has stopped writing the column, that copies any row the trigger missed, then drops the
  trigger and its function, the index, `create_chunks_hnsw_index()` and the column.
- **Nine `app.projects` settings columns are retired, not dropped** — `knowledge_mode`,
  `agent_mode`, `recommended_agent_slugs`, `allowed_agent_slugs`, `model_mode`,
  `recommended_models`, `allowed_models`, `connectors_mode` and `allowed_connector_slugs` lost
  their only writers (four project-settings routes no screen called) and every reader, the
  mention directory's legacy agent allow-list included (2026-09-27). Paying it down means a
  `DROP COLUMN` migration one release after every image has stopped selecting them.
- **Nothing in the schema forbids a door string in `usage_ledger.user_id`** — rule 2 of the
  governance contract is enforced by the resolver and its tests only, because rows booked before
  2026-09 carry `user:` / `api-key:` forms and the previous image writes them mid-roll. Paying it
  down means a `CHECK (user_id NOT LIKE '%:%' OR user_id = '__automation__') NOT VALID` once every
  image books bare ids.
- **Unreadable matches can empty a member's chat search** — the chat assistant's conversations
  leg (`services/platform/backend/domains/conversations/search-chat.ts`) stops its body pre-pass
  at 50 matching conversations and its contact pre-pass at 25 matching contacts BEFORE
  `conversationAssignmentAllows` runs, and a walk a match cap stopped reports `truncated: false`.
  When the newest matches are conversations a member may not read, the member's own older match
  is dropped and the tool answers `searched (no matches)`; the contact scan cap (500) cuts the
  same way. 0.4 behaved alike (2026-09, TALE-47 review). Paying it down means scoping each
  pre-pass before it counts (read the matched conversation's assignment stamps with the match
  and hand them to the same predicate), or at least reporting `truncated` when a cap stopped a
  pre-pass and the answer came back short of its limit, with a case in
  `search-chat.privacy.test.ts` where 50 unreadable body matches sit ahead of the member's own.
- **The pinned model gateway books nothing for a call cut short** — Bifrost
  (`services/sandbox-llm-gateway/Dockerfile`) cancels the vendor call when its caller hangs up,
  whole answer or stream, but keeps none of the usage the call had reached unless the vendor
  reported it before the cut (an Anthropic stream's input tokens; an OpenAI-wire stream reports
  usage only in its closing frame). It also ends an OpenAI-wire stream on two keepalive comments
  after the finish reason, so an upstream that sends them before its usage frame is booked at
  nothing. So the model endpoints for API keys (`services/platform/backend/domains/model_api/`)
  book an answer that ended early at a local floor (the prompt and the relayed output at the
  catalog price) instead of the vendor's own figure, and a sandbox turn's call cut mid-answer
  books only what the gateway kept (2026-09). Paying it down means a gateway release that keeps
  the usage a cancelled call had reached, then booking the gateway's figure alone in
  `metering.ts`.
- **Gemini CLI never continues a conversation** — the pinned CLI's `--resume` replays every tool
  result of the recorded session twice (its `toolCalls[].result` and the user record it also
  writes for the same response — google-gemini/gemini-cli#29365, fix PRs open), so the first
  request of a resumed conversation that ever ran a tool is refused by the model. The gemini
  harness YAML declares `capabilities.resume: false`: every later kick of a task, every automatic
  retry and every answered ask starts a fresh conversation over the preserved workspace with the
  brief and the earlier rounds restated, where the other harnesses hand the exec the announced
  handle (2026-10). The runtime now bakes root-owned system settings for Gemini 0.62.0;
  the resume bug remains open. Paying it down means a sandbox-runtime pin that carries
  the upstream fix, then flipping the flag and restoring the `resume` argv slot (the schema
  holds the two coherent).
- **An in-doubt step is decided in the app only** — a run parked on `waitingFor: in_doubt` (a
  write its server was making when it stopped may already have reached the service) is read and
  decided through `GET`/`POST /api/app/automations/runs/{runId}/in-doubt[/{attemptId}]`
  (`backend/domains/automations/routes.ts`) and the card on the run page and in the task
  panel: `/api/v1` and MCP name the wait but offer no door, and the card names a write inside a
  subautomation by its raw path (`batch[1:0]/send`) (2026-10). Paying it down means
  `GET {run}/in-doubt` and `POST {run}/in-doubt/{attemptId}` `{resolution, attempt, actor?}` in both
  scopes of `backend/rest/v1-automations.ts` beside the ask doors (the stop's write gate,
  `rest:execute` charged, the store's 409s re-coded at the door), an MCP tool, a contract bump,
  and a readable name for a nested path.
- **An in-doubt park is silent** — nothing tells anyone that a run waits on an in-doubt step: no
  bell, no email; the run list and the run's status say it waits for a decision only to someone
  who opens them, so an unattended scheduled run can wait until somebody does (2026-10). Paying it down
  means a notification kind with its preferences, emitted in the park's transaction to the
  run's starter (an organization run's owners when a trigger started it) and marked read when
  the step is decided.
- **No shipped connector action is marked `idempotent`** — the connector schema takes
  `idempotent: true` (`packages/shared/src/schemas/connectors.ts`), and a write so marked is
  sent again after an interruption instead of waiting for a person; no catalog action declares
  it yet, so every write cut mid-call parks in doubt, even one whose service dedupes by the
  idempotency key Tale sends (2026-10). Paying it down means a review of each action's vendor
  call (does the service honour the key, or a natural key such as a message id), then the flag
  on the actions that pass, with a test per action.
- **An erasure leaves the subject's id on decisions in other people's runs** —
  `app.automation_human_asks.answered_by` and `app.automation_node_attempts.resolved_by` keep
  the bare user id of whoever answered an agent's question or decided an in-doubt step; the
  erasure pass deletes only the runs the subject started (`automationRuns` in
  `backend/domains/erasure/service.ts`), so the id stays on a run someone else started
  (2026-10). Paying it down means a pass that pseudonymises both columns the way review
  decisions are, with its breakdown category and a case in the erasure tests.
- **Legacy execution holds need a proven retirement before release** — migration 0163 preserves
  pre-protocol queued/running/waiting runs as `quarantined`, fences legacy database writers and
  keeps their task subjects occupied. An already-admitted legacy external call can still finish;
  the database cannot establish its outcome. The app and REST stop-request doors record an
  explicit acknowledgement and request owned session cancellation, but deliberately keep the
  run, asks and task exclusion on hold (2026-10). Paying this down requires source-bound proof
  that the old execution is retired, an authorized decision about unknown external effects, and
  a guarded release contract. Never clear the hold or manufacture node-attempt evidence merely
  because a stop was requested, a lease expired, or the old containers disappeared.
- **A run lease compares the clocks of the hosts it spans** — the stepper stamps and checks the
  30 s lease with its own host's clock (`claimRun`, `heartbeatRun`, `sweepOverdueRuns`), and the
  read model's `stalled` compares it with the database's. Workers on hosts whose clocks differ by
  more than about 30 s read each other's live leases as lapsed and take runs over (the epoch
  fence and the ledger keep that from repeating a write, but every such takeover of a write in
  flight parks it in doubt), so a multi-host deployment needs synchronised clocks (2026-10).
  Paying it down means stamping and comparing leases with the database's clock
  (`clock_timestamp()`) in the claim, heartbeat, progress, park and sweep statements.
