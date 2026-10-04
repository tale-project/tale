# CI scheduling and caches

Optimize both time to feedback and total runner work. Inspect job queue time separately
from step duration before adding shards: a short test behind a large setup cost usually
needs fewer runners, while a long CPU-bound suite can benefit from more slices.

## Current execution graph

- **Checks / UI** is the stable required aggregate. Four platform UI shards run the same
  suite with Vitest's `--shard=N/4`; shard 1 also runs other workspaces' `test:ui` once.
  The aggregate fails on failed, cancelled, skipped or missing shard results. It needs no
  checkout or dependency installation. Keep all matrix legs in the candidate receipt.
- **E2E** builds the platform preview bundle once using the ordinary Turbo build task,
  then uploads it for four single-worker Playwright shards. Each shard owns its database,
  backend and worker-scoped org fixture. Reports still capture failed tests and retries. The web and
  docs suites keep their independent jobs. Pull requests first compute affected service
  scope from the PR diff; missing or nonboolean filter results fail the scope job.
  Nightly, manual and candidate rounds always select platform, web and docs. Static
  suites use two workers, verified with all 90 web and 55 docs cases passing without retries.
- **Build** distinguishes the platform stack from standalone sites. Site-only changes run
  their container tests without building the eight-image platform stack. Shared package,
  dependency, toolchain and test-harness inputs expand to full coverage. Release candidates
  always run the complete graph, regardless of changed paths.
  Forks build on their consuming smoke and image-validation runners rather than additionally
  scheduling eight isolated builds that those runners cannot use. Published image checks
  preflight every digest receipt, pull at most three images concurrently, and check each
  source revision before tagging it locally. Every child must succeed before the runtime
  alias is created.
- The four standalone container tests load their cached Buildx image into Docker and pass
  `SKIP_BUILD=true` and `PULL_POLICY=never` to the existing probes. Their Compose commands
  test those local bytes. Compose produces the Bake plan, preserving its build arguments,
  overrides, targets and tags. They reclaim disk only below 20 GiB of free space;
  full-stack jobs retain their larger cleanup.
- **Release** starts sandbox-runtime and platform builds first within its existing
  six-job limit. Architecture-specific registry caches survive tag boundaries; the main
  branch's service caches can warm a first release.
- **CLI** runs source tests on native Linux, macOS and Windows rows. Cross-compilation rows
  still generate and build their binaries; repeating the same source suite on the same
  host OS adds no platform coverage. Binary artifacts use fast compression.

## Cache boundaries

Turbo owns workspace task caching. The `transit` task has no script; its recursive
`^transit` dependencies propagate shared-package changes to consumer checks without
forcing real tests or compilers to run sequentially. Explicit `inputs` still cover files
read outside a workspace dependency. Root TypeScript config family members and the Bun
setup action participate in the global hash. Bun download caches separate OS and CPU
architecture.

Unit and UI jobs also share a job-local Node compile cache between isolated workers.
It stores bytecode, not test verdicts, and its temporary location passes through Turbo
without affecting task hashes. Playwright browser caches use the installed version,
OS and architecture; every runner still installs native dependencies. The formatter's
uv cache hashes the manifest that pins Ruff instead of walking installed dependencies.

`setup-turbo` restores `.turbo/cache` through GitHub's native cache action. Keys
separate task scope, OS, architecture, Bun version and lockfile; the checked-out
source SHA and workflow writer make successful writes immutable. Restore prefixes
stay within that task scope. Separate writer keys let E2E save its platform bundle
without preventing Checks from saving the larger build archive.
Checks and E2E share the `build` scope, while every UI shard has its own scope.
Turbo still compares task hashes before replaying any restored result.

GitHub restricts a pull request's cache to its merge ref; `main` cannot restore it.
This preserves the [documented cache visibility boundary](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
without an artifact-server token or repository-wide artifact lookup. Do not restore
untrusted run artifacts as executable build outputs or successful test verdicts.

A candidate can predate this setup action while its trusted workflow is newer.
Callers therefore keep the old token input and explicitly set `start-turbo-cache=false`:
an older checkout installs dependencies and runs uncached; the current action ignores
those deprecated inputs and uses `turbo-cache` and `cache-scope`. The old artifact
server must stay disabled in every caller during this compatibility period.

CLI generation and builds embed Git revision and clean-state metadata, so they are
uncached. Their outside catalog and reference sources are declared inputs; generated skill
task logs are excluded. Source-only hashes cannot certify that identity. E2E has no independent
hand-maintained file-list cache for its preview bundle; it reuses the ordinary build
inputs and passes the result through a per-run artifact.

Static E2E jobs do not restore Turbo caches. Web prerendering generates release content
and SEO output outside `dist/`; those external inputs and outputs must be fully modeled
before that build or its dependent prerender verdict can be safely restored.

Only main pushes publish the shared platform-stack Docker layer cache; pull requests
and candidates read it. This removes costly PR-local exports and prevents old release
candidates from replacing main's cache. PR reruns may rebuild layers unique to that PR.
Ephemeral hosted builders skip teardown. Forks build on the runners that test their
images and retain builtin catalog validation, without a second unused image matrix.
Candidate SAST retains its full blocking scan and omits only the unused SARIF pass.

See [the repo contract](../.agents/repo.md#a-green-check-is-not-always-a-run) before
interpreting a green cached result. Backend integration always executes its strict lanes;
performance measurements and Playwright journeys are never replayed as tests.

## Evidence and regression checks

The 2026-10-04 audit used [Checks run 37219931026](https://github.com/tale-project/tale/actions/runs/37219931026)
and [E2E run 37216457306](https://github.com/tale-project/tale/actions/runs/37216457306).
The UI job spent 10m48s executing; platform E2E slices spent roughly 22–37s testing after
70–100s of setup. Both runs also showed queue waits exceeding 100 minutes. Moving E2E
from sixteen to four runners removes twelve repeated stack setups; UI gets four slices
without increasing its worker pool. These are baseline observations and graph changes,
not a claim about the duration of a future hosted run.

[Release run 37136987405](https://github.com/tale-project/tale/actions/runs/37136987405)
took 31m21s, with sandbox-runtime starting about eleven minutes after Prepare.
Starting it first removes that scheduling delay when capacity is available.
[Build candidate 37199185890](https://github.com/tale-project/tale/actions/runs/37199185890)
spent 70–113s reclaiming disk per standalone site, before doing any site work.

[Build run 37208030678](https://github.com/tale-project/tale/actions/runs/37208030678)
spent 148 seconds exporting the platform's PR-local cache and 47 seconds deleting its
ephemeral builder. [CLI run 37210592060](https://github.com/tale-project/tale/actions/runs/37210592060)
repeated source tests for 132 seconds on macOS and 115 seconds on Linux cross rows.

Run workflow and source-identity regressions with:

```bash
bun test --timeout 30000 tools/cli/scripts/ci-*.test.ts \
  tools/cli/scripts/cli-ci.test.ts \
  tools/cli/scripts/deployment-ci.test.ts \
  tools/cli/scripts/release-candidate-workflows.test.ts \
  tools/cli/scripts/release-candidate-gate.test.ts
```

Also run `actionlint`, the cache-input guards, and `bun run check`. When a matrix or
required job changes, update `CANDIDATE_JOBS` in
`tools/cli/scripts/release-candidate-gate.ts` and its workflow graph tests together.
A release receipt must reject missing or skipped shards even if an aggregate is green.

Type check retains its 6 GiB heap, compiler diagnostics and peak memory evidence. Other
Turbo check commands print failing logs; the seven-day `turbo-*` artifacts preserve task
hashes, timings and cache status, including failed jobs. Use `--output-logs=full` to inspect
replayed logs locally and `--force` for fresh execution. Candidate SAST and dependency scans
retain their blocking passes while skipping informational SARIF that cannot be published.
