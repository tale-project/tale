# CI scheduling and caches

Optimize both time to feedback and total runner work. Inspect job queue time separately
from step duration before adding shards: a short test behind a large setup cost usually
needs fewer runners, while a long CPU-bound suite can benefit from more slices.

The cumulative audit records [129 distinct implemented improvements](CI-improvements.json)
since `c8f31b2b9`: 78 authored here, 47 integrated from concurrent upstream work and four
combining both. Each entry records before/after behavior, changed paths, source commits
and proof. Repeated patterns across workflows count once; suggestions and retained
baseline behavior do not count.

## Current execution graph

- **Checks / Unit** is the stable required aggregate. Two platform Vitest shards run
  `test` with `--shard=N/2`; a separate job runs every other workspace's `test` once
  with Turbo concurrency limited to two. Both platform runners retain the live
  YouTube service and environment and the PII project's isolation policy. The aggregate
  needs no checkout or installation and rejects failed, cancelled, skipped or missing
  results. Candidate receipts require the aggregate, both platform shards and the
  other-workspace job.
- **Checks / UI** is the stable required aggregate. Four platform UI shards run the same
  suite with Vitest's `--shard=N/4`; shard 1 also runs other workspaces' `test:ui` once.
  The aggregate fails on failed, cancelled, skipped or missing shard results. It needs no
  checkout or dependency installation. Its `always()` predicate admits cancellation so
  the explicit result check can reject missing evidence. Keep all matrix legs in the
  candidate receipt.
- **E2E** builds the platform preview bundle once using the ordinary Turbo build task,
  then uploads it for four single-worker Playwright shards. Each shard owns its database,
  backend and worker-scoped org fixture. Reports still capture failed tests and retries.
  The web and docs suites restore/build their complete output once through Turbo and opt into
  `E2E_USE_BUILD=1` preview. Web SEO runs the workspace script directly against those
  production bytes and still runs after a browser failure when the build succeeded.
  Calling its Turbo prerequisite again would rebuild after release fetching changes the
  tracked snapshot. Historical candidates use an uncached compatibility lane with forced
  complete builds before browsers and SEO: their older browser configs may rebuild only
  the client and overwrite prerendered HTML. Pull requests first compute affected service
  scope from the PR diff; missing or nonboolean filter results fail the scope job.
  Nightly, manual and candidate rounds always select platform, web and docs. Static
  suites use two workers. Ordinary interactive web journeys await a test-only root
  snapshot marker being removed by the client commit, so prerendered nodes cannot
  satisfy their readiness check. Cold-start tests still exercise the transition itself.
- **Build** distinguishes the platform stack from standalone sites. Site-only changes run
  their container tests without building the eight-image platform stack. Shared package,
  dependency, toolchain and test-harness inputs expand to full coverage. Release candidates
  always run the complete graph, regardless of changed paths.
  Edits to the four service-specific container probes select their standalone container
  job without the platform stack; shared probes, helper libraries and platform sources
  retain full stack coverage. Storybook still scans those probe files for CSS classes.
  Forks build on their consuming smoke and image-validation runners rather than additionally
  scheduling eight isolated builds that those runners cannot use. Published image checks
  preflight every digest receipt, pull at most three images concurrently, and check each
  source revision before tagging it locally. Every child must succeed before the runtime
  alias is created.
  Image metadata/document checks and sandbox runtime conformance then run as two
  independent processes against those accepted images. Their containers own private
  temporary filesystems; both processes finish and print their separate logs even when
  one fails, and either failure rejects the job. Full or partial logs are retained for
  seven days, including when a probe times out. Forks retain their sequential local
  build and conformance path.
- The four standalone container tests load their cached Buildx image into Docker and pass
  `SKIP_BUILD=true` and `PULL_POLICY=never` to the existing probes. Their Compose commands
  test those local bytes. Compose produces the Bake plan, preserving its build arguments,
  overrides, targets and tags. They reclaim disk only below 20 GiB of free space;
  full-stack builders aim for 40 GiB and pull-only gates for 28 GiB. Cleanup logs free
  space, removes existing tool directories one at a time and stops when the job's
  target is met. If all existing cleanup still leaves less space, it warns and preserves
  the existing build behavior; these targets are not new admission requirements.
- **Release** starts sandbox-runtime and platform builds first within its existing
  six-job limit. Separate service/architecture registry cache images survive tag boundaries;
  main's amd64 service caches can warm a first release. Only trusted Release writes registry
  caches; a failed optional export does not block publication.
- **CLI** runs source tests on native Linux, macOS and Windows rows. Cross-compilation rows
  still generate and build their binaries; repeating the same source suite on the same
  host OS adds no platform coverage. Cross legs use a proven CLI-only frozen install
  and keep its download cache in a separate namespace. Native source tests retain
  the full workspace install because they import platform auth modules. macOS runs at
  most two source test files in parallel, isolating each file's modules and globals;
  tests within a file remain serial. Linux and Windows source tests and compiled smoke
  discovery remain serial. Two workers made Windows fixtures exceed their unchanged
  30-second limits; Linux two-worker runs also failed to finish promptly. Serial suites
  retain all assertions and the same limits. The native command fixture checks complete
  discovery, serial case order and real synchronous/asynchronous subprocess completion
  under each host's selected command. The macOS lane also checks file isolation and its
  worker bound.
  Binary artifacts use fast compression; all five targets still build, native binaries
  retain smoke tests, and both macOS targets retain signature checks. Command suites
  run source cases before compilation, then select only the explicit `TALE_BINARY`
  artifact in the smoke lane. A missing selected artifact fails instead of falling
  back to source; every command suite remains part of smoke discovery.
  All targets compile the identity generated from the clean checkout before CI injects
  the release version. Windows uses `build:windows:compile` for that step; the public
  `build:windows` command still regenerates identity for local builds. When a trusted
  workflow checks out an older candidate/tag without the helper, it derives the helper
  after generation and version injection by removing only the known generate prefix
  from that source's `bun build --compile …` script. The selected source remains the
  authority for compiler arguments and bundle validation; malformed scripts fail closed.
  Do not regenerate after CI changes the tracked manifest or bypass dirty-source
  rejection.

## Cache boundaries

Turbo owns workspace task caching. Generic checks depend on `^transit`: scriptless
nodes hash dependency workspaces recursively and propagate shared-package changes
without forcing real tests or compilers to run sequentially. Each check's effective
inputs still hash its own selected source; component tasks can omit unrelated trees.
Explicit `inputs` cover files read outside a workspace dependency. Root `tsconfig*.json`,
lint and formatter configurations, `bunfig.toml`, patches and the Bun setup action
participate in the global hash. Bun download caches separate OS and CPU architecture.

Shared checks install the exact Node version from the production platform image once.
Their actual Bun, Node, OS, architecture and Linux distribution fingerprint participates
in task hashes, preventing runtime changes from replaying source-identical verdicts.
Performance and backend integration also support older candidate composites without the
Node-version output: only those checkouts resolve and install their production Node at the
job level. Current composites skip that fallback. Integration evidence verifies and records
the actual selected version.

The Bun download key also includes workspace manifests, the lockfile and patches.
A frozen install remains authoritative after a cache hit, and successful downloads
are saved before the workload begins. Browser checks and E2E share an exact
installed Playwright version, OS and architecture cache for the Chromium headless
shell. Cold Browser jobs and every E2E runner install native dependencies. Checks can skip
Chromium provisioning only when the actual Turbo plan proves every executable Browser
prerequisite has a local cached verdict. Candidates, forced runs, unknown plans and
uncached prerequisites retain provisioning. Both the probe and unconditional final test
command disable size and age eviction so planned verdict archives stay available. A
malformed version fails
before cache restoration or browser installation.

Unit and UI jobs also share a job-local Node compile cache between isolated workers.
It stores bytecode, not test verdicts, and its temporary location passes through Turbo
without affecting task hashes. The formatter's uv cache hashes the manifest that
pins Ruff instead of walking installed dependencies.

Checks skip workspace setup scripts that only print a message. CLI checks keep their real
generation prerequisite. A workspace that adds substantive setup must attach it to its checks;
the dependency fixture guards this distinction.

Platform component tasks exclude backend trees they do not execute and manual/E2E evidence.
Their input guard follows runtime imports and re-exports and checks every visited module against
Turbo's actual hashed inputs, including workspace dependencies and source text read by tests.
An isolated fixture verifies that unrelated backend edits preserve these hashes while imported
policy edits invalidate them.

`setup-turbo` restores `.turbo/cache` through GitHub's native cache action. Keys
separate task scope, OS, architecture, Bun version and lockfile; the checked-out
source SHA and workflow/job/matrix writer make successful writes immutable. Restore prefixes
stay within that task scope. Separate writer keys let E2E save its platform bundle
without preventing Checks from saving the larger build archive.
Checks, E2E platform builds and static sites share the `build` scope. Static matrix jobs
set `cache-writer` per service, so their immutable writes stay distinct within E2E too.
Every Unit and UI platform shard has its own scope; other-workspace unit tests use
their own scope.
Turbo still compares task hashes before replaying any restored result.

Hosted jobs set Turbo's native `TURBO_CACHE_MAX_SIZE=512MB` (512 MiB). Turbo
attempts to evict the oldest archive entries in a background thread at startup.
This is a best-effort target: very short runs can finish before eviction, and
current-run outputs can grow the final archive beyond it. Cache hits do not refresh archive write times, so
an old matching task may be evicted and safely execute again. The setup action
sets this policy only on GitHub-hosted Actions runners and pins the cache to
that checkout. Local and persistent self-hosted caches retain their existing
policy. See [Turbo's cache size setting](https://turborepo.com/docs/reference/system-environment-variables#turbo_cache_max_size).

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
inputs. Uploads use attempt-specific names, and shards validate and download the
successful build's immutable artifact ID. Failed-only reruns reuse that original ID;
full reruns publish a new artifact.

Build and Release share [pull-ci-images.sh](scripts/pull-ci-images.sh), which validates
all receipts before Docker work, uses three bounded workers and checks source revision
labels before tagging. Candidate image gates fetch only that helper from the exact
trusted workflow commit into an isolated sparse checkout, preserving an older
candidate's source and image receipts.

Image vulnerability reporting and SBOM publication share one Trivy 0.70.0 image scan.
The JSON report retains all packages and finding severities; local conversion produces
SARIF with the same ignored findings and a complete CycloneDX inventory without
vulnerability records. The empty severity selection belongs only to SBOM conversion.
SARIF keeps all severities, matching the previous action's actual behavior. A failed
scan or conversion still fails the informational job; reports that exist are uploaded.

Scorecard remains informational and runs weekly, manually and when branch protections
change. Blocking source and dependency security gates retain their triggers.

CLI checks additionally depend on their own `transit`, whose inputs cover embedded
source trees and platform modules reached by relative imports. Module-closure and
generator-tree guards require those effective inputs.
Keep arbitrary outside reads explicit; workspace dependencies alone cannot hash them.
The CLI's Vitest policy guard also hashes the platform PostCSS config and the shared
YAML Vite plugin it loads, and disables Storybook discovery in that probe.

Source archive regressions verify the complete ZIP inventory and CRCs, full TAR extraction
and inventory, and Git symlink identity. The TAR probe dereferences the setup action and
every tracked symlink, comparing each target's complete file bytes, names and types.
It avoids copying unrelated assets a second time. The inspected source held 8,750 files
and about 569 MB; the symlink targets held 292 files and about 4 MB. A local TAR proof
finished in 19.76s within its unchanged 60s budget; the former whole-tree copy timed out
under shared-machine contention. These observations are not a hosted speedup guarantee.

Website builds cache `dist/`, `dist-ssr/`, `dist-seo/`, generated frontmatter and translated
search indexes together. The tracked web release snapshot remains an input, so a snapshot-only
commit rebuilds its bundle. A real cold/warm docs proof restored all 3,793 artifacts byte-for-byte
and passed 15 prerender/crawl tests; the preview served matching pages, JS and search bytes.
The observed local build times were 83.982s cold and 6.242s warm, not hosted CI guarantees.

Keep platform tests in build inputs: Tailwind's automatic source scanner read 639 files under
`tests/` in the inspected tree. Their class strings can alter CSS and service-worker revisions.
Narrowing those inputs requires explicit production-only Tailwind sources and an output-
equivalence check.

Only main pushes publish the shared platform-stack Docker layer cache; pull requests
and candidates read it. This removes costly PR-local exports and prevents old release
candidates from replacing main's cache. PR reruns may rebuild layers unique to that PR.
Ephemeral hosted builders skip teardown. Forks build on the runners that test their
images and retain builtin catalog validation, without a second unused image matrix.
SAST scans once: normal runs serialize SARIF from the same result while retaining the
engine's blocking exit status and text diagnostics. Candidates keep the complete blocking
scan without publishing a report against moving main. A real pinned-engine regression suite
runs in the same SAST job and checks findings, suppressions, exclusions and fatal errors.
Writing a requested SARIF report must also succeed; reporting failures fail the scan.

Release validation overlaps isolated stack probes and standalone sites, waits for every
verdict and preserves separate logs. Remote manifest inspections have three workers.
Image validation resolves Compose once and reads one validated metadata snapshot per
image, including the sandbox LLM gateway. Failed inspection, missing image references,
disabled health checks, root users with group suffixes and concealed secret values fail
the gate. Summaries report the actual verdict.

CLI publication downloads exactly five binary artifacts, validates the complete nonempty
set and refuses symlinks before checksumming. It rechecks the prepared release source
before upload and bounds readiness waits within the job budget. PR image cleanup deletes
only versions whose every tag belongs to the closed PR, rechecks tags before deletion and
joins every bounded worker. Shared main, release, candidate and other-PR tags survive.

Security retains each advisory retry and scanner result independently of SARIF publishing.
Blocking Trivy checks still run after informational reporting failures; reporting and
upload budgets leave time for the blocking scan. Read-only checkouts do not retain tokens.

The built-site crawler keeps its bounded worker pool active as links appear, schedules
addresses once, includes active requests in URL caps and reports interrupted response
bodies. Startup failures reject promptly, keep bounded diagnostics and terminate wedged
children. These changes apply to the E2E helper, not the product's ingestion crawler.

See [the repo contract](../.agents/repo.md#a-green-check-is-not-always-a-run) before
interpreting a green cached result. Backend integration always executes its strict lanes;
performance measurements and Playwright journeys are never replayed as tests.
Its shared database, session and process state requires serial lanes. The disposable
hosted integration runner skips only Buildx teardown; it still builds the database
from the checked-out source and requires every lane to run.

## Evidence and regression checks

The 2026-10-04 audit used [Checks run 37219931026](https://github.com/tale-project/tale/actions/runs/37219931026)
and [E2E run 37216457306](https://github.com/tale-project/tale/actions/runs/37216457306).
The UI job spent 10m48s executing; platform E2E slices spent roughly 22–37s testing after
70–100s of setup. Both runs also showed queue waits exceeding 100 minutes. Moving E2E
from sixteen to four runners removes twelve repeated stack setups; UI gets four slices
without increasing its worker pool. These are baseline observations and graph changes,
not a claim about the duration of a future hosted run. The audit at checkout `79dc863fd`
partitioned all 595 UI files once as 149/149/149/148; the E2E audit partition proof covered
all 67 tests once as 17/17/17/16. Later source changes require a fresh inventory.

A follow-up [Checks run 37253041672](https://github.com/tale-project/tale/actions/runs/37253041672)
at `4f95bd54d` executed all four platform UI shards: each Turbo summary records a cache
miss, with task durations of 151.7, 98.1, 180.3 and 183.6 seconds. The stable UI aggregate
completed 4m02s after run creation, including queue and setup time. This follow-up and
the baseline used different revisions and queue conditions, so they do not establish a
controlled speedup.

[E2E run 37248634565](https://github.com/tale-project/tale/actions/runs/37248634565)
at `f04fe7c73` built web in 39.8 seconds and passed all 93 browser tests, then spent
about 38 seconds rebuilding web before the SEO assertions. Its build wrote a new
release snapshot timestamp, changing its own input hash; invoking Turbo again for
`test:prerender` therefore missed the build cache. The same duplicate build occurred
in [run 37245899655](https://github.com/tale-project/tale/actions/runs/37245899655)
even though its first build was restored. Ordinary E2E invokes the existing workspace SEO
suite directly after the successful build, preserving release-snapshot invalidation
while avoiding a second build and keeping both suites on identical output.
The first observed follow-up, [E2E run 37255219568](https://github.com/tale-project/tale/actions/runs/37255219568)
at `dc2ded7a3`, restored web in one second and passed its browser and SEO steps;
SEO took 15 seconds without rebuilding the site.

[Release run 37136987405](https://github.com/tale-project/tale/actions/runs/37136987405)
took 31m21s, with sandbox-runtime starting about eleven minutes after Prepare.
Starting it first removes that scheduling delay when capacity is available.
[Build candidate 37199185890](https://github.com/tale-project/tale/actions/runs/37199185890)
spent 70–113s reclaiming disk per standalone site, before doing any site work.

[Build run 37208030678](https://github.com/tale-project/tale/actions/runs/37208030678)
spent 148 seconds exporting the platform's PR-local cache and 47 seconds deleting its
ephemeral builder. [CLI run 37210592060](https://github.com/tale-project/tale/actions/runs/37210592060)
repeated source tests for 132 seconds on macOS and 115 seconds on Linux cross rows.

In [CLI run 37252195260](https://github.com/tale-project/tale/actions/runs/37252195260),
Windows smoke repeated 19 source command cases that had already passed before
compilation. Those repeats consumed 47.8 seconds, alongside 38.3 seconds of compiled
command cases. Selecting only the compiled target in the second lane removes that
duplicate work while retaining both source and binary coverage.

[Checks run 37256749343](https://github.com/tale-project/tale/actions/runs/37256749343)
at `8b6723935` spent 297 seconds executing all 230 backend integration lanes and
9 seconds tearing down its disposable builder. Its Unit step spent 146 seconds on
fresh CLI tests; the platform's 438.6-second result was a cache replay. In
[Build run 37253041674](https://github.com/tale-project/tale/actions/runs/37253041674),
image validation took 13 seconds and runtime conformance took 91 seconds, after
their shared image pulls. Overlapping these independent probes avoids extra runner
setup and another download of the roughly 6 GB runtime image. These baseline durations
identify the work being overlapped; they do not establish a controlled speedup.

A local inventory verified that the 67 platform Playwright tests partition exactly once across
the four shards (17, 17, 17 and 16 tests). An isolated Bun 1.4.2 checkout installed 265 packages
for cross compilation and built both Linux arm64 and macOS x64 CLI binaries successfully.

The 2026-10-05 follow-up used [Checks run 37253041672](https://github.com/tale-project/tale/actions/runs/37253041672),
whose platform unit task executed for 438.6s while the other fifteen unit tasks were
cache hits. The installed Vitest sequencer at checkout `4f95bd54` partitioned all
1,054 platform unit files once across two shards (527 each, including all nine PII
files). File counts do not promise balanced durations: the live YouTube and PII
corpus tests concentrate substantial work in one shard. Backend integration's 230
strict lanes retain their sequential execution because they share mutable process state.

[Build run 37253041674](https://github.com/tale-project/tale/actions/runs/37253041674)
spent 50–119s reclaiming disk on full-stack jobs. Those logs did not record initial
free space, so the new stop targets need hosted observation before claiming savings.

The build-scope archive in that Build run was 2,080.8 MB; sixty retained build
archives totaled 86.3 GB. A warm build spent 17.5s restoring and 10s saving the
archive versus 15.3s executing build tasks. The native size policy limits that
accumulated history when eviction completes, while preserving the existing GitHub
cache visibility boundary.

At `ab8d18ec`, [Checks run 37260796248](https://github.com/tale-project/tale/actions/runs/37260796248)
passed both platform Unit shards as fresh executions in 151.4s and 198.7s. All fifteen
other workspace test tasks also executed and passed. The largest platform task was
shorter than the earlier 438.6s full-platform task, but revisions, runner conditions
and queue times differed; this does not establish a controlled whole-pipeline speedup.
The current docs and UI-docs builds remained cache hits on their next Turbo invocation.

In [Build run 37260796293](https://github.com/tale-project/tale/actions/runs/37260796293),
all eight cleanup calls at the 20/28/40 GiB targets found about 85 GiB free and stopped
after one measurement, with zero-second rounded step durations. All image builds,
standalone tests, smoke and image/runtime gates passed. These observations prove the
ample-space path; low-space deletion paths remain covered by executable fixtures.

[CLI run 37260796143](https://github.com/tale-project/tale/actions/runs/37260796143)
passed Linux, macOS and both cross targets, but Windows source tests took 365.5s with
two workers and timed out two unchanged Git/ZIP fixtures at 30 seconds. The later
temporary-file errors followed timeout cleanup. Earlier serial Windows source runs
took 191–216s and passed. Windows therefore retains the serial command and all existing
assertions and timeout limits. In [CLI run 37262821778](https://github.com/tale-project/tale/actions/runs/37262821778),
Windows source and compiled smoke passed completely. macOS source and signed compiled
smoke also passed in both later runs with two workers.

Linux's [later two-worker source run](https://github.com/tale-project/tale/actions/runs/37262217358)
remained unfinished when cancelled after 418s,
with three unchanged PowerShell checksum case receipts missing and no failure or
timeout summary. The next run also remained unfinished beyond five minutes. These
logs localize an unfinished fixture but do not establish the subprocess or worker
cause. Full serial CLI tests in Checks passed freshly in 117.6s and 136.7s, so Linux
also retains the serial command while macOS retains two workers.

Run workflow and source-identity regressions with:

```bash
bun test --timeout 30000 tools/cli/scripts/ci-*.test.ts \
  tools/cli/scripts/build-ci.test.ts \
  tools/cli/scripts/cli-workflow.test.ts \
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
retain their blocking policies while omitting SARIF that cannot be published.


The final optimization round's focused gates passed: 105 Checks/cache regressions,
66 container/release regressions, 171 publication/cleanup/candidate regressions and
57 E2E/security regressions. A historical-checkout probe fixture added 158 assertions
across two tests. Exact Bun 1.4.2 lint/types, formatting and actionlint passed.
Local SAST exited zero with no findings. Cold local full checks encountered unchanged
five-second sandbox process-fixture timeouts on the shared machine; no budgets or
assertions were relaxed. Hosted results must be inspected separately before calling
all task verdicts fresh.
