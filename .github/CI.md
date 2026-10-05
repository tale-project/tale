# CI scheduling, caches and readiness

Optimize both time to feedback and total runner work. Inspect job queue time separately
from step duration before adding shards: a short test behind a large setup cost usually
needs fewer runners, while a long CPU-bound suite can benefit from more slices.

The cumulative audit records [135 retained implemented improvements](CI-improvements.json)
since `c8f31b2b9`: 85 authored here, 45 integrated from concurrent upstream work and five
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
  Published-image smoke and validation jobs also log disk usage after their probes,
  including failures. Compare that remaining headroom with preparation's measurement;
  the completion measurement does not establish peak disk usage during the probes.
- **Release** starts sandbox-runtime and platform builds first within its existing
  six-job limit. Separate service/architecture registry cache images survive tag boundaries;
  main's amd64 service caches can warm a first release. Only trusted Release writes registry
  caches; a failed optional export does not block publication.
- **CLI** runs source tests on native Linux, macOS and Windows rows. Cross-compilation rows
  still generate and build their binaries; repeating the same source suite on the same
  host OS adds no platform coverage. Cross legs use a proven CLI-only frozen install
  and keep its download cache in a separate namespace. Native source tests retain
  the full workspace install because they import platform auth modules. Windows
  keeps its normalized download store beside the checkout, outside the source tree,
  so Bun can hardlink on the same volume. Its native row skips archive restore/save
  and runs that complete frozen install directly. Matched dependency inputs took
  70 seconds cold, versus 25 seconds restoring plus 55 seconds installing from a
  warm archive; compare final hosted results before treating that difference as a
  fixed saving. Linux/macOS native and cross rows retain their download archives.
  Source tests
  and compiled smoke discovery run serially on all three hosts. Two workers made
  Windows fixtures exceed their unchanged 30-second limits; Linux two-worker runs
  failed to finish promptly, and a macOS candidate reached the unchanged 15-minute
  job cap without a source summary. Serial suites retain all assertions and the same
  limits. The native command fixture checks complete discovery, serial case order,
  real synchronous/asynchronous subprocess completion, two-file Git indexing, and
  one process without worker IDs under every host's selected command.
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
  Native command fixtures write their workflow and metadata before the initial Git commit,
  rather than creating and replacing an unused minimal revision. Ordinary fixture defaults,
  executable-file tracking and every later release/catalogue commit remain covered.

## Cache boundaries

Turbo owns workspace task caching. Generic checks depend on `^transit`: scriptless
nodes hash dependency workspaces recursively and propagate shared-package changes
without forcing real tests or compilers to run sequentially. Each check's effective
inputs still hash its own selected source; component tasks can omit unrelated trees.
The UI, marketing-UI and E2E packages' transit omits only each package-root README:
an edit to that prose keeps consumer check hashes stable, while the package's own checks,
ordinary builds through `^build` and the CLI's publication tests retain their inputs.
Runtime source, exports, catalogs and the Tailwind preset continue to invalidate consumers.
The shared package's README still participates in Turbo's global internal-dependency hash
because the root depends on `@tale/shared`; a transit exclusion alone would save no work.
The isolated real-Turbo fixture includes that root dependency and guards both boundaries.
Explicit `inputs` cover files read outside a workspace dependency. Catalog input lists
omit nested task logs and TypeScript's incremental `*.tsbuildinfo` outputs, which
CLI embedding already skips. Creating or rewriting these artifacts preserves
consumer hashes; catalog source and toolchain edits still invalidate them. Root `tsconfig*.json`,
lint and formatter configurations, `bunfig.toml`, patches and the Bun setup action
participate in the global hash. Bun download caches separate OS and CPU architecture.

Shared checks install the exact Node version from the production platform image once.
Their actual Bun, Node, OS, architecture and Linux distribution fingerprint participates
in task hashes, preventing runtime changes from replaying source-identical verdicts.
Performance and backend integration also support older candidate composites without the
Node-version output: only those checkouts resolve and install their production Node at the
job level. Current composites skip that fallback. Integration evidence verifies and records
the actual selected version.

Shared checks and native CLI builds use the same Bun download key inputs: the root
manifest, every declared workspace manifest, lockfile, patches and `bunfig.toml`.
The independent document-node npm manifest is outside that workspace identity.
Native caches retain OS, architecture and Bun version separation; cross-compilation
keeps its separate namespace and every path retains its prefix fallback.
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

Runtime image stages declare release-version arguments after filesystem work. Docker
implicitly adds declared arguments to later `RUN` environments, so an early `VERSION`
declaration invalidated unchanged installation and permission layers on every release.
DB, proxy, static services, and platform runner/dev now retain those layers across version
changes while applying the current version to their final metadata and runtime environment.
The React and Docker service generator templates preserve the same boundary for new services.
The DB integration build can also reuse the producer's versioned filesystem cache with its
local `dev` version. Image assembly, provenance and runtime validation still run.

Hosted jobs normally set Turbo's native `TURBO_CACHE_MAX_SIZE=512MB` (512 MiB).
Browser's admission probe and final test command disable eviction as described above.
Turbo attempts to evict the oldest archive entries in a background thread at startup.
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

Image vulnerability reporting uses Trivy 0.70.0 JSON and local SARIF conversion,
retaining every finding severity and the existing suppressions. CycloneDX publication
uses a separate direct image analysis: this engine computes Node and Python package
hashes only when scanning for an SBOM format. JSON conversion loses those hashes.
The SBOM analysis uses an in-memory artifact cache so previous checksum-free analysis
cannot supply incomplete package metadata. It retains the complete package inventory
and the original policy of omitting vulnerability records.

A real pinned-engine check verifies Node and Python package hashes once per scan
matrix, including JSON-conversion negative controls. It uses offline temporary rootfs
fixtures and the already installed engine. The helper comes from the immutable workflow
commit, preserving historical candidate source checkouts. Failed analysis, conversion
or regression checks fail the informational job; reports that exist are uploaded.
The direct SBOM pass reuses the pinned scanner installation and skips a second cache transfer.

Release publication keeps full commit/tag history for contract comparisons, while its
working tree selects authored release notes and the two dependency-free renderers.
Historical API snapshots still come from `git show` and fetch on demand from this public
repository. An anonymous partial clone reproduced the full-checkout notes byte for byte
without retained checkout credentials or installed dependencies.

Scorecard remains informational and runs weekly, manually and when branch protections
change. Blocking source and dependency security gates retain their triggers.

Security's production Bun audit uses one registry response per attempt for both
reporting and its blocking HIGH/CRITICAL threshold. Native JSON output retains all
advisory severities; Bun decides the exit status. Each bounded attempt is retained,
including transport failures. Findings fail immediately, while a degraded registry
keeps the existing three-attempt retry policy and delay.

CLI checks additionally depend on their own `transit`, whose inputs cover embedded
source trees and platform modules reached by relative imports. Module-closure and
generator-tree guards require those effective inputs.
Keep arbitrary outside reads explicit; workspace dependencies alone cannot hash them.
The CLI's Vitest policy guard also hashes the platform PostCSS config and the shared
YAML Vite plugin it loads, and disables Storybook discovery in that probe.
The native document fixture executes the real helper while mocking only its process
boundary. Its workbook fixtures, Python requirements, Node manifest and lockfile are
explicit outside inputs, so changing those bytes invalidates the CLI verdict.

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

Only ordinary main pushes publish the shared platform-stack and four standalone
service Docker layer caches; pull requests and candidates read them. This removes
costly PR-local exports and prevents old release
candidates from replacing main's cache. PR reruns may rebuild layers unique to that PR.
The platform's production dependency stage shares the builder's minimal Bun/Debian
base but reads only workspace manifests, patches and the installed lockfile. Application
source edits therefore preserve that stage's cache. The runtime takes pruned dependencies
from this stage and application files from the builder; the production install and
swap still fail closed.
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
The independent filesystem gate reuses the engine and database provisioned by a
successful report scan, then executes its own blocking HIGH/CRITICAL vulnerability scan.
Failed, cancelled, skipped or missing report outcomes retain full installation and cache
restoration; candidates still use that fallback because their reporting step is skipped.

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

Turbo 2.10.11's [SCM summary code](https://github.com/vercel/turborepo/blob/v2.10.11/crates/turborepo-run-summary/src/scm.rs)
prefers the CI vendor's environment SHA over Git when it is present. Candidate
`b3e73c51d` ran under workflow `b04bbb5e6`, so its summaries report H even though
all fourteen substantive Checks checkout logs and actual cache source keys identify C.
Use that checkout evidence for source identity and the task summaries for HIT/MISS
and exit results; a cached verdict can legitimately come from another source with
the same declared inputs.

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
smoke also passed in both later runs with two workers; that mode was withdrawn after
the later candidate failures documented below.

Linux's [later two-worker source run](https://github.com/tale-project/tale/actions/runs/37262217358)
remained unfinished when cancelled after 418s,
with three unchanged PowerShell checksum case receipts missing and no failure or
timeout summary. The next run also remained unfinished beyond five minutes. These
logs localize an unfinished fixture but do not establish the subprocess or worker
cause. Full serial CLI tests in Checks passed freshly in 117.6s and 136.7s, so Linux
returned to the serial command. macOS initially retained two workers after its
successful hosted runs.

At `1dcc2e523`, [candidate CLI run 37271160243](https://github.com/tale-project/tale/actions/runs/37271160243)
reached the native macOS job's unchanged 15-minute cap without a source-test summary;
compilation and smoke were skipped. The [same-source push run](https://github.com/tale-project/tale/actions/runs/37271033868)
completed 2,290 source cases (2,270 passed, 20 skipped, zero failures) in 171.91
seconds and passed its signed compiled smoke suite.
The candidate's silence does not identify the specific worker or subprocess cause.
macOS therefore also uses the complete plain serial command, preserving every
assertion, the 30-second case budget and the 15-minute job deadline.

In [Build run 37265214548](https://github.com/tale-project/tale/actions/runs/37265214548),
new gateway size coverage compared a 100 MiB limit calibrated from packed layers with
Docker inspection's 255 MiB result. The exact gateway images from this run and
Build run 37260011687 contain the same seven layer descriptors, totaling 86.45 MiB
packed; the image did not grow. The gateway limit is now 300 MiB, about 18% above
its observed inspection size, using the existing metric. Other image budgets stay
unchanged. Executable fixtures accept 255 and 300 MiB and reject 301 MiB while
retaining gateway user, health, secret and required-image checks.

[Build run 37283199187](https://github.com/tale-project/tale/actions/runs/37283199187)
at `4653d3e3b` spent 434 seconds building and pushing the platform image, including
223 seconds exporting its complete layer cache. The production dependency stage
inherited the application builder, so source edits also repeated its install and
runtime dependency copy. The manifest-only stage removes that dependency without
changing the cache backend or its branch isolation.

In [Build run 37291275081](https://github.com/tale-project/tale/actions/runs/37291275081)
at `d934290d8`, the independent production install ran for 13.9 seconds while the
22.3-second frontend build was active. The complete platform build/push took 297
seconds, including 129 seconds exporting the unchanged GHA cache. Other source and
runner differences contributed to this comparison; it is not an isolated measure
of the Dockerfile change. Local real BuildKit warm and application-source mutation
builds kept the production install cached. All fifteen runtime COPY paths and the
production install/cleanup instructions stayed unchanged.

The later changed-lock [Build run 37293441007](https://github.com/tale-project/tale/actions/runs/37293441007)
at `b3e73c51d` took 530 seconds for that step, including 358.9 seconds of GHA cache
export. Its protected candidate took 177 seconds without exporting that cache.
Both amd64 production installs retained the same 1,543 packages; the native SBOM's
1,414 npm components and every metadata hash matched `d934290d8`, with the new
test-only glob library absent. Cache export remains a substantial, variable cost;
these changes do not establish an overall pipeline speedup.

In the [same-source CLI run](https://github.com/tale-project/tale/actions/runs/37283199170),
Windows downloaded its 254 MiB Bun cache in about one second, then spent about
128 seconds extracting it and 41 seconds installing dependencies. Its home-directory
cache and checkout were on different volumes. Moving the store beside the checkout
enables Bun's [documented Windows hardlinks](https://bun.sh/docs/pm/global-cache#fast-copying);
it does not establish a reduction in cache extraction time. That path change started
a new cache version, and the first hosted runs used a cold store.

The Windows sibling is resolved with Bun's `node:path.win32.resolve`. While its
archive was enabled, the cache glob consumer rejected `.` and `..` path segments
even when the install accepted them. At `d934290d8`, all five CLI targets passed, but the Windows
save warned and retained no archive; its 75.80-second install was cold. The regression
uses the cache action's pinned `@actions/glob` 0.5.1 to reject that original path and
accept a resolved, populated store. A passing install alone does not prove cache reuse.

The corrected [main publisher](https://github.com/tale-project/tale/actions/runs/37293503192)
at `b04bbb5e6` saved a 252,814,413-byte archive from the absolute sibling path.
The protected [CLI run](https://github.com/tale-project/tale/actions/runs/37293674424)
checked out corrected source `b3e73c51d` under that workflow, restored the exact
archive. All five targets compiled and uploaded; source and compiled smoke tests
passed on the three native hosts, and both macOS targets passed strict signatures.

| Windows step | Earlier `4653d3e3b` run | Corrected warm run |
| --- | --- | --- |
| Cache extraction | 128.2 seconds | 28.18 seconds |
| Frozen install | 40.73 seconds | 55.65 seconds |

The corrected frozen install retained the complete workspace and installed 1,909
packages. The earlier run installed 1,903; the archive contents and runners also
differ. These are observed samples, not a controlled percentage improvement.

Later main (`74935ed9b`) keeps the normalized same-volume store but skips native
Windows archive restore/save and runs the complete frozen install directly. The
measurements above describe the validated preceding archive strategy; current
Linux/macOS native and cross targets still use their archives.

The complete protected round for corrected source `b3e73c51d` passed all seven
workflows under workflow `b04bbb5e6`: [Checks](https://github.com/tale-project/tale/actions/runs/37293674390),
[Build](https://github.com/tale-project/tale/actions/runs/37293674333),
[CLI](https://github.com/tale-project/tale/actions/runs/37293674424),
[E2E](https://github.com/tale-project/tale/actions/runs/37293674312),
[SAST](https://github.com/tale-project/tale/actions/runs/37293674345),
[Security](https://github.com/tale-project/tale/actions/runs/37293674361) and
[Commitlint](https://github.com/tale-project/tale/actions/runs/37293674367).
Strict backend integration executed all 1,576 checks across 232 lanes. The task
summaries record 22 fresh executions and 49 valid cache hits. E2E passed 214 browser
tests and 822 SEO tests without retries, retaining one existing skip. Both ordinary
and protected Build passed all eight images, 45 image checks, 83 runtime probes and
29 smoke tests. Receipt identities, actual checkouts and scanner coverage limits are
recorded separately; cancelled ordinary checks and the red full local gate are not
represented as complete passes.

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
Local SAST exited zero with no findings. The first two cold local full checks encountered
unchanged five-second sandbox process-fixture timeouts on the shared machine. A complete
continuation then finished 47 of 49 tasks successfully, including the sandbox suite;
the remaining platform tasks identified a compiler-scope contract regression, a PII
throughput overrun under load, and old locale imports retained across a main update.
On a stable checkout all 34 RunDetail tests and all five PII throughput cases passed
with their original assertions and budgets; the 50 KB prose case took 183 ms against
its unchanged 1,500 ms limit. The scope filter uses literal compiler paths and guards
coverage of every root compiler configuration.

The full [E2E run 37265091303](https://github.com/tale-project/tale/actions/runs/37265091303)
at `4a77db784`, directly above the landed optimization round, passed all four platform
shards plus web and docs: 214 browser tests with zero retries and one preexisting
`test.fixme` skip. All six browser jobs confirmed first-attempt results. Web's 822 SEO
tests passed in 9.12 seconds against the same output. The immutable preview artifact
was built once. [Security run 37264873901](https://github.com/tale-project/tale/actions/runs/37264873901)
and [SAST run 37265214552](https://github.com/tale-project/tale/actions/runs/37265214552)
also passed. Hosted validation caught legacy Compose fixtures, GitHub's different
Turbo failure-output rendering and two narrow Knip findings; the follow-up tests
exercise the real release JavaScript and preserve provenance, concurrency, failure
propagation and container restrictions. Cancelled runs and cached tasks remain
separate from fresh execution evidence.

The frozen follow-up local gate finished in 30m50s with 47 of 49 tasks passing,
including fresh platform unit (82,098 tests) and CLI (2,247 tests, 29 existing skips)
executions and both affected workspaces' lint/type checks. Thirty-eight task verdicts
were cache replays. The monolithic gate remained red for unchanged sandbox process
fixtures and UI timeouts under heavy shared-machine load. All twelve failed UI files
then passed their 241 tests sequentially with one worker, unchanged assertions and
unchanged time limits; the unhandled rejection did not recur. This isolation evidence
does not turn the original full run green. A new full SAST scan exited zero with no
findings across 476 applicable rules and 4,541 files; 91 files were only partially
analyzed under the existing engine policy. Hosted follow-up verdicts are recorded for
their exact tested source.


After the production corrections, [Checks run 37271033992](https://github.com/tale-project/tale/actions/runs/37271033992)
passed at `1dcc2e523`, including backend integration and both stable test aggregates.
Some UI and Browser verdicts were cache replays, so this is not an all-fresh run.
[CLI run 37271033868](https://github.com/tale-project/tale/actions/runs/37271033868)
passed all five targets at the same source, including every native source and compiled
smoke lane; the two cross targets retain their intentional source-test skips.
[Security run 37271160205](https://github.com/tale-project/tale/actions/runs/37271160205)
validated that same exact candidate and passed both blocking scans.
[SAST run 37271033889](https://github.com/tale-project/tale/actions/runs/37271033889)
also passed its policy and nine real-engine regression tests; its fourteen raw findings
were accepted under the existing policy and 36 files were only partially analyzed.

The ordinary [Build run 37269909176](https://github.com/tale-project/tale/actions/runs/37269909176)
at `3184c0b2b` passed all eight stack builders, smoke, image/runtime checks and the
selected platform scan. Its real Trivy 0.70.0 check verified Node/Python SBOM hashes
and rejected the JSON-conversion negative controls. Standalone sites were not selected
in this push. The successful candidate-dispatch jobs headed at `3184c0b2b` selected
`ea02ea465` as source; they prove historical-candidate compatibility, rather than
current-source execution.


The final guard follow-up passed the six compiler scope cases and the combined real
Compose helper/input-closure suite (122 tests, 2,403 assertions). Both explicit
local/Actions cache-failure cases preserve the successful archive's bytes and inventory
and prove a changed hash, cache miss and failing execution. An integration batch passed
185 other release/metadata/Build/deployment/cache cases; its initial fixture-import
closure failure was corrected and the unchanged closure guard passed in the combined
suite. Five affected-workspace lint/type/generate tasks executed freshly and passed;
Knip, actionlint, formatting and commit hooks also passed. No original assertion or
time budget was relaxed, and these follow-up corrections do not increase the ledger.

The cache fixture emits its changed-source rejection diagnostic synchronously before
exiting with status 1. This keeps Bun's multiline error rendering from truncating the
marker collected by Turbo. The exact task-log assertion and every cache, hash, exit
status and archive-integrity assertion remain in place; this correction adds no ledger entry.

Protected candidate `91ac292ca` passed [Checks](https://github.com/tale-project/tale/actions/runs/37273313395),
[Build](https://github.com/tale-project/tale/actions/runs/37273313417),
[E2E](https://github.com/tale-project/tale/actions/runs/37273313365),
[Security](https://github.com/tale-project/tale/actions/runs/37273313414) and
[SAST](https://github.com/tale-project/tale/actions/runs/37273313397). The candidate
receipts bind that selected source separately from workflow commit `2c3fe20c`;
Turbo's SCM environment alone can name the latter. E2E passed 214 browser tests and
822 SEO tests with zero retries. All eight image builds, four standalone sites and
smoke/image/runtime gates passed.

Its [CLI run](https://github.com/tale-project/tale/actions/runs/37273313502) passed four
targets but macOS hit 25 existing runtime-fixture timeouts, followed by the 15-minute
job limit. The new document and cache guards had already passed. Runtime fixture
setup creates only `compose.yml` and `services/proxy/Caddyfile`; repeated `git add`
stalls therefore do not show excess copying or a larger source index. The same
relevant source, Git/Bun versions and runner image passed comparison macOS steps in
172 and 136 seconds; the worker/subprocess liveness cause remains unproven. macOS
returns to serial source execution with every assertion, 30-second test limit and
15-minute job budget retained. CI-114 is recorded as withdrawn rather than counted
as an improvement or replaced with another count for this correction.

The newer product source `2c3fe20c` passed ordinary
[Checks](https://github.com/tale-project/tale/actions/runs/37273116498),
[CLI](https://github.com/tale-project/tale/actions/runs/37273116351) and
[Build](https://github.com/tale-project/tale/actions/runs/37273116429). This confirms
its separate product changes without relabelling the failed `91ac292ca` CLI run.

After serial scheduling landed, latest `main` source `4653d3e3b` passed
[CLI run 37283199170](https://github.com/tale-project/tale/actions/runs/37283199170)
on all five targets. macOS executed 2,366 source cases (2,346 passed, 20 skipped,
zero failures) in 246.41 seconds and its compiled smoke suite passed 56 cases
with one existing skip in 47.29 seconds. This observes the restored production
scheduling; the additional two-file Git regression still needs its own final run.

The continued 2026-10-05 round retained incoming sparse/audit/cache work and added
conditional Trivy provisioning reuse, narrow release rendering and native-Node execution
inside the existing sparse Git guards. All affected CLI generation, lint, type and source
tests executed and passed: 2,345 tests, 29 existing skips and 37,614 assertions. The focused
combined guard suite passed 76 cases; the actual sparse action source also passed under
checksummed Node 24.9.0 without a package manifest or dependencies. An anonymous partial
clone retained every remote tag and reproduced the 8,685-byte release notes while historical
snapshots fetched on demand. The materialized release tree contained six files/23,100 bytes.
These are working-tree measurements, not a measured network or pipeline speedup.
After rebasing onto `6bd227fdc`, the integration guards passed 143 cases/2,169 assertions;
affected CLI lint, types and all-workflow actionlint also passed. The subsequent Windows-cache
integration passed all 128 CI guard cases plus lint/types/actionlint. Its combined
container batch had one unchanged five-second fixture timeout, which passed alone
within the original budget.

Ordinary [Security run 37293502987](https://github.com/tale-project/tale/actions/runs/37293502987)
passed at `b04bbb5e6`. Its blocking gate resolved `skip-setup-trivy=true` and `cache=false`,
skipped repeated binary/database restoration and executed its independent vulnerability
scan. Final-source validation is recorded separately from this ordinary reuse observation.

The broader local gate remains recorded as red. The bounded run passed 5,800 platform UI
cases but failed 27 cases in twelve files, with Unit cancelled afterward. A one-worker
recheck passed 426 cases and failed seven. A subsequent four-file recheck passed 122
cases and failed one; that remaining skills file then passed all six cases in isolation.
These overlapping retries do not make the full gate green. No assertions or time limits
were relaxed; hosted validation must judge the final revision separately. A filtered native
CLI install was rejected because modest size savings did not establish a reliable benefit.

## Pull-request CI readiness

Each validation workflow emits one direct terminal context on every PR and merge group:
`CI ready (Checks)`, `CI ready (Commitlint)`, `CI ready (SAST)`, `CI ready (Security)`,
`CI ready (CLI)`, `CI ready (E2E)`, and `CI ready (Build)`. The terminal job always runs
after its native dependencies, including failed or skipped dependencies. It reads only that
workflow's `needs` results, not another workflow's API or a previously stored green verdict.
Its summary records source, run and attempt. The source graph guard requires every actual
job to be classified and preserves all current matrix legs.

An applicable blocking job must succeed. Missing, cancelled, failed, unknown and unexpected
skipped results hold readiness. Drafts are held; `ready_for_review` runs the applicable
checks again at the same head. Candidate source/receipt jobs and CLI manual publication are
explicitly inapplicable on ordinary PRs. Release-candidate receipts keep their separate
required graph: the new ordinary-only contexts are permitted there only as completed skips.

`.github/ci-scope.yml` owns the PR path policy for Build, E2E, CLI and Security,
plus Checks' existing backend integration scope. Scope jobs validate exact boolean outputs
and compare the frozen event's base/head/file count with PR metadata before and after
discovery. Source movement, a changed count, or 3000 or more changed files requires complete
coverage. API failure, malformed metadata, missing output, duplicate paths or incomplete
discovery fails. The pinned filter expands renames into added/deleted paths: any mixed
added/deleted set conservatively requires full coverage, so expanded path counts never
certify API-row completeness. Unambiguous discovery requires an exact unique path count.
Shared gate/scope changes also require complete coverage.
Push, schedule, manual and candidate admission remains separate; merge groups run full
validation, and Commitlint checks the actual group base-to-head range.

Build's detailed service outputs still decide which containers and Storybook are owed;
outer workflow applicability alone is not a service matrix. PR service decisions come from
the same validated discovery; queued Build jobs never query the mutable PR files again.
Root image inputs expand that decision to every image consumer and test. A standalone site
requires its own container test; compose-service selection or `ci_tests` requires the platform
stack. Readiness validates the explicit stack output against both causes. Forks skip the
publishing matrix and require both native local alternatives.
E2E platform, web and docs decisions use the same frozen discovery. The existing E2E scope
job validates the service outputs before scheduling its four platform shards or selected
static-site matrix; failed scope discovery and incomplete full coverage hold readiness.
Existing fork PRs use local
smoke/image validation without new write privileges. Image vulnerability scans retain their
existing **advisory** policy: their native aggregate is recorded as advisory, never proof
that every scanner passed or found no vulnerabilities. Security's Bun audit/Trivy gates and
SAST's Opengrep remain blocking. Recovered Playwright retries still need their diagnostic
artifact review as described in the repo contract.

Scope and verdict actions use the repository-pinned `actions/github-script` Node 24 runtime
and a dependency-free evaluator; they do not install the monorepo or start another CI graph.
Their pinned checkouts use non-cone sparse paths: scope materializes only its action,
the central policy and evaluator, while readiness needs only its action and evaluator.
Checks' integration scope retains its exact candidate-source ref and PR condition.
Native Git fixtures execute both actions from those minimal trees and retain scope
pre/postflight API checks and failed or incomplete readiness verdicts.
An official checksummed Node 24 runtime also imports the sparse TypeScript and executes
the actual action scripts with both `package.json` and `node_modules` absent.
The tracked Git fixtures also execute those scripts with native Node, including every
scope policy and passed, failed and incomplete readiness evidence.

### Activation and observation

Source alone does not activate branch protection. Before requiring these contexts, observe
their exact live names and GitHub Actions application identity (15368), positive and negative
PR cases, and failed/latest rerun behavior. If a merge queue is configured, also observe
positive and negative `merge_group` runs. Otherwise record live queue proof as not applicable,
retain the source guards for that event and its full scope, and require live queue proof before
enabling a queue. Bind the seven contexts to that app; generic candidate or skipped execution
jobs cannot substitute for them. Keep the coordinator's
exact-head checks and independent review until enforcement is active and observed. Independent
review remains a separate obligation; a CI readiness result does not certify it.

The complete [release-candidate gate](RELEASING.md) remains required before tagging a release.
