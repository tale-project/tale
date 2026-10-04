# Performance measurements

Run representative hot paths in fresh, serial workers, with JSON latency,
throughput, CPU and memory measurements and an inventory of **every workspace**:

```sh
bun install --frozen-lockfile
bun run --filter @tale/cli generate
bun run test:performance --output /tmp/tale-performance.json
```

This command is deliberately outside Turbo and `bun run check`: hardware-dependent
latencies are measurements, not pass/fail budgets, and must never replay a cached
result. It fails if a workload fails its correctness checks, times out, or a new
workspace has no inventory entry. An infrastructure lane without prerequisites is
explicitly `not-measured`; a successful command does **not** mean the whole product
has been load-tested.

## Diagnose task-board rendering on Linux

Add the `benchmark:task-board` label to a mergeable, non-draft pull request from
this repository. The opt-in **Browser performance** workflow runs on the label
event and later pushes; ordinary checks and deployment workflows are unchanged.
The new workflow can run from the PR's merge branch before it is on `main`.
After it is registered, its manual input fields also accept full baseline and
candidate commit SHAs and a `diagnostic` or `protocol` mode. Do not supply branch names or abbreviated hashes. Exactly one opt-in mode label is allowed; ambiguous admission fails with a receipt.

The candidate must contain the event's baseline commit. Both sources must have
identical server (including the production web shim and proxy contract), platform messages,
shared-library (including `@tale/ui`), database, configuration, dependency and runtime inputs: this first diagnostic mode shares one API and database while comparing
the frontend builds. A refusal after `main` advances needs an explicitly reviewed
integration and new source pair, not a weaker comparison check. Each production
bundle is built directly with the same pinned Bun, Node and options.

The serial diagnostic uses synthetic boards of 50 and 2,000 tasks, Chromium
141.0.7390.37, and one shared 2 CPU / 4 GiB cgroup for the database, API, production web handlers and
browser. It records a cold board load and one dialog open/close per arm and size,
including forward and backward keyboard wrapping and return to the opener. Cold frame stamps use
the navigation time origin; dialog latency uses its recorded input timestamp. There are no automatic
measurement retries. Setup and measurement share a 32-minute deadline; the
45-minute job reserves time for bounded cleanup and artifact upload. All services share an isolated loopback namespace with no
host ports, live accounts, provider calls or production access. The browser image
is pinned by digest; the receipt checks its actual version and executable hash.
Each arm imports its own unchanged production `server.ts` under the root-pinned
Bun binary, mounted read-only and checked by version and hash. Private
`https://127.0.0.2` web origins preserve production runtime injection without activating
the product's localhost-only development capture script. The narrow proxy keeps
`/api/health` and `/events/file` web-owned; it forwards the API, exact `/events`
and OAuth discovery routes to the shared API, preserving cookies, request
cancellation, streaming and redirects. Minimal health readiness and synthetic
API setup precede the cold page; its already-loaded entry-script responses are
hashed against that arm's build receipt without another asset request. The real
auth constructor must accept both origins; synthetic sign-in and cookie-backed
session checks verify both before browser work. The private TLS certificate has an ephemeral synthetic CA and IP SAN; unchanged product auth and CSP stay in force. Both arms use the same transport. Private signing and serving keys stay in memory/environment and are never artifacts. Public certificate fingerprints, SAN/validity, tooling and trust-database receipts are retained. The existing container UID and fixed child `HOME=/tmp` are preserved; its standard `/tmp/.pki/nssdb` starts without trust. An untrusted browser must reject the health endpoint and fully close before the public CA database is installed; any NSS state created by that closed browser is ownership-checked and preserved inside the disposable container before verified public trust is installed into a fresh standard directory. A fresh trusted browser must succeed on both health origins with default verification. Separate Node/Bun children prove certificate rejection and launch-time CA trust. These health-only checks load no application script or asset. Same-origin branding uses the unchanged CSP `self`; cross-port IP branding is not claimed by this fixture. Docker 26 or newer enables IPv6
only in the owned database container's private namespace; raw readbacks must show
only loopback interfaces/addresses, no usable external/default route and the same
namespace for both containers before measurement is released. No host networking
or browser capability is changed.

Two tiny app-free trace controls exercise DOM mutation and data-URL navigation
before the measured pairs, using the same browser, profiler, categories and
15-second trace-completion deadline. They warm no Tale page or asset. A control
failure stops the diagnostic with evidence; there is no retry. Measurement then
starts in a fresh browser.

For a bounded protocol investigation, replace the diagnostic label with
`benchmark:browser-protocol`. This mode retains the ordinary exact production
builds because the real production web handler and health proof use that setup;
it skips bulk task seeding and all app cold/dialog measurements. After the same
TLS/auth/resource proof and tiny controls, one fresh browser generates unique
user-timing marks (1,024 names of 8 KiB per batch), clearing page mark entries
between batches. It stops at the first 90–98% trace-buffer occupancy or fails
within 45 seconds; overshoot and missing telemetry are retained without retry.
Similar occupancy does not reproduce the app event mix or prove its timeout cause.

The protocol control preserves the diagnostic categories, default buffer and
15-second completion verdict. A separate, capped 45-second post-failure window
can retain a late stream, but the original verdict stays failed. Its process is
bounded to 180 seconds within the shared deadline, and raw evidence remains
capped at 512 MiB. Completion subscription starts before tracing; an early
completion cannot certify full action coverage. Owned streams and listeners are
released on start, action, End or exclusive-file failure. No certificate bypass,
trace-category change, longer success deadline or acceptance verdict is implied.

Download `browser-performance-<run>-<attempt>` even when the job fails. It contains
the exact source trees, build and runtime receipts, raw CDP traces and CPU profiles,
source maps, frame stamps, DOM counts, heap metrics, long-task/event observations,
screenshots, literal verified cgroup limits, resource counters and cleanup readback.
Action and observation checkpoints remain explicitly incomplete until profile and
trace retention finish. Trace sidecars retain completion metadata, buffer usage,
stage timestamps and partial-byte hashes; data loss or malformed completion fails
the capture. Browser process stderr is retained alongside the raw evidence. Query-observer counts are
explicitly unavailable: the production app exposes no supported inspection API.
`browser-failure.json`, `inside-failure.json` or `runner-failure.json` explains an
incomplete phase. A resource, source, readiness or cleanup refusal fails the job;
an incomplete artifact is never a passing measurement. Cleanup targets only the
containers and runtime slice whose ownership receipts this job created.

This is a diagnostic comparison, not an acceptance verdict. A content-ready
rendering opportunity is not proof of the first visible pixel. The baseline runs
first; both task-detail reads are prewarmed and receive one explicit garbage
collection before the open trace. Natural GC within the trace is retained.
Shared-backend warming remains a
limitation. Timeline stack instrumentation can force CPU-profiler samples alongside
periodic samples; profile self times alone do not establish application CPU cost.
This instrumented diagnostic must not be compared with an uninstrumented arm or
substituted for the agreed uninstrumented acceptance timing campaign. GitHub's CPU model and current database/runtime may differ from an
earlier measurement host. Keep the original latency, keyboard and modal behavior
requirements; use the traces to choose a repair, then run the agreed acceptance
campaign. The default performance inventory continues to mark authenticated UI
as requiring separate evidence.

The uncached **Performance** CI job runs the default workloads with 20 measured
samples on each check workflow and uploads `tale-performance-<run>-<attempt>`
JSON for 14 days, including a partial report when a workload fails. It uses the
repository's Bun pin and the platform image's Node pin. Compare those reports
within the same runner/runtime generation; CI latency differences are evidence
to investigate, not automatic regression verdicts.

Use an otherwise idle machine and the Bun version pinned in the root manifest plus
the platform's supported Node version. The report records actual versions, CPU,
RAM, OS, revision, dirty-tree status and host load. The backend schema and runnerd
lanes execute under Node; Bun lanes use the same Bun executable as the runner.
Only synthetic temporary state is written. The runner removes its own temporary
files; reports belong outside the clone.

```sh
# Inspect the complete coverage inventory without running workloads.
bun run test:performance --list

# Repeat a suspected hot path. At least 100 samples help inspect tails.
bun run test:performance --workload shared.long-line --samples 100 \
  --output /tmp/tale-long-lines.json

# Measure output journal writes and repeated late reconnects separately.
bun run test:performance --workload daemon.journal-write \
  --workload daemon.journal-reconnect --samples 100 \
  --output /tmp/tale-journals.json

# Optional local SAST workload: requires the pinned binary already cached by lint:sast.
bun run test:performance --workload tools.opengrep --samples 3 \
  --output /tmp/tale-opengrep.json

# Also measure a real, already-built local service route (HTTP 200 required).
bun run test:performance --samples 100 \
  --http @tale/web=http://127.0.0.1:3001/ \
  --http @tale/docs=http://127.0.0.1:3002/ \
  --output /tmp/tale-with-http.json
```

HTTP targets accept loopback origins only, perform GETs with up to ten concurrent
requests, consume full bodies, refuse redirects/errors, and time out after 30
seconds. Supply a route that does not redirect for locale negotiation. They do not
send authorization headers, measure browser rendering, or inspect server RSS.

## What is measured

| Part | Workload | Still requires a separate run |
| --- | --- | --- |
| Shared process utilities | 100,000 lines into a bounded ring; 16 MiB unterminated line in 4 KiB chunks | Other utilities and Postgres transaction/retry contention |
| Platform engine/telemetry | Cold/cached validation of 100-item automation inputs; 1000 bounded metric updates and worker spans with tracing disabled/enabled, on Node | API/worker/knowledge/chat with real Postgres, storage and controlled model responses; authenticated UI |
| Sandbox spawner | 1000 exec boundary validations with 128 environment values; 1000-event SSE burst | Docker/Kubernetes provisioning, concurrent session admission, image warmup |
| Sandbox daemon/runtime | Real Node process output and 1 MiB replay; 16,000-record journal writes; 20 late reconnects per sample requesting the last ten records | Linux subreaper, sustained concurrent reconnects, container resource ceilings and image-only document dependencies |
| AI gateway | Read/validate/decrypt 100 file-backed accounts and atomic update | OAuth, provider refresh, controlled credential-pool traffic |
| UI and marketing UI | 100-button SSR, including marketing wrappers | Browser layout/hydration, all other components and animation |
| Web/docs/UI docs | Shared server: 100 HTTP requests in batches of ten; cold/cached 250-page SEO artifact bursts | Service content/search/build/prerender and browser navigation; shared code is labelled `shared-library-only` |
| CLI | Fresh process `--help` startup | Deployment/backup/archive/object-store workflows |
| E2E package | Shared Playwright configuration construction | Actual browser execution |
| Link/manual tools | 1000-link extraction with positions; parsing the real performance suite | Full-repository scans |
| Visual analyzer | 1080p RGBA frame comparison and cropping | Browser capture and model analysis |
| Database, Caddy, Tinyproxy, Bifrost, BuildKit | Explicit environment requirements in the inventory | Disposable infrastructure and representative datasets/traffic |
| Plop | Fresh CLI scaffolds and verifies one TypeScript package in a disposable destination | Other generators and dependency installation |
| Opengrep (explicit selection only) | Cached pinned scanner, local rules, ten synthetic TypeScript files with one verified finding | Full repository/registry scan; binary setup via `bun run lint:sast` |

## Reading a report

Workers time out after three minutes, first requesting cleanup and then terminating after ten more seconds if necessary. Fixture directories belong to the parent runner, which removes them even after a failed worker. A wedged worker that needs SIGKILL cannot guarantee descendant cleanup; inspect its processes before another measurement.

Each worker performs two warmup samples, then 20 measured samples by default. A
sample is the complete workload batch described in its `description`;
`operationsPerSample` and `unit` specify throughput's denominator. **The p50/p95/p99
are batch latencies**, not individual line/request latencies. Percentiles use the
nearest-rank definition and raw `samplesMs` are retained. With 20 samples p99 is
just the maximum; use larger runs for tail analysis. Correctness checks are part
of the measured workload.

The optional HTTP lane records individual request latencies, with throughput
computed from the concurrent run's wall time. Cold SEO invalidates before every
sample; cached SEO and schemas remain warm. Telemetry measures the real privacy scrub hook and verifies each sampled transaction reaches an in-memory transport; network transport and automatic HTTP integrations are excluded. CLI startup always spawns a fresh
process, even during warmup.

Plop also starts a fresh CLI process per sample. The optional `tools.opengrep`
lane never downloads a binary or rules; it reuses the SAST gate's version pin and
cache location. Its scan uses only local files and disables version checks. The intentional
synthetic finding is asserted rather than treated as a clean security gate.
On POSIX systems, tooling subprocesses use dedicated process groups so worker
cancellation reaches scanner descendants, with forced termination after one second.

`processPeakRssBytes` comes from the parent process's
[Bun subprocess resource usage](https://bun.com/reference/bun/Subprocess/resourceUsage),
which reports bytes for both Node and Bun children. It includes imports,
fixtures, warmup and cleanup. The host OS can include reaped descendants in this
figure (observed on macOS); it is **not aggregate concurrent process-tree RSS**.
CLI/tooling `details.childPeakRssBytes` records the tool child's resource usage
separately, with the same caveat. Worker
`memory.observedRssBytes` and `observedHeapBytes` sample every 5 ms and after each
batch; synchronous peaks can fall between observations. The post-GC heap delta
is useful context, **not proof of a leak or a leak-free service**. The shared HTTP
worker includes both server and client allocations. Compare like-for-like
reports; do not claim a speedup from a contended run against an idle run.

The journal workloads use actual temporary, unlinked files. Write samples include
record encoding, backpressure, drain, a verified ten-record suffix replay and
descriptor closure. Reconnect samples reuse a completed 16,000-record journal
prepared before timing; each sample makes 20 sequential attachments and checks
every returned sequence, payload and replay marker. Setup still contributes to
process memory measurements. These workloads exercise Node and the host
filesystem, without a container network or model provider; their batch timings
do not predict complete agent-run latency.

## Completing a deployment profile

Build every shipping frontend with its workspace `build` command without Turbo
cache, time the whole command, record maximum RSS, then test each built server
with `--http` and profile real browser navigation. A build measures the toolchain,
not runtime request performance.

Use a disposable, seeded deployment for the remaining inventory lanes. Run the
platform's `backend:integration` for correctness, then separately measure API and
worker throughput, database query/lock/pool waits, stream cancellation, queue
latency, and RSS over repeated work and an idle recovery period. Integration/unit
test duration is never substituted for load-test coverage. Exercise proxy,
egress, gateway and BuildKit through their real container boundaries, including
slow upstreams and disconnects. Use controlled model responses to avoid spending
live model credits and to make comparisons repeatable.
