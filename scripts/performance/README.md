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

# Compare tiny streaming deltas with larger display updates.
bun run test:performance --workload platform.projection-fragmented \
  --workload platform.projection-bursts --samples 100 \
  --output /tmp/tale-projections.json

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
| Platform engine/telemetry | Cold/cached validation of 100-item automation inputs; 1000 bounded metric updates and worker spans with tracing disabled/enabled; bounded display projection of 262,144 text units in tiny/large fragments, on Node | API/worker/knowledge/chat with real Postgres, storage and controlled model responses; authenticated UI |
| Agent progress (`platform.agent-progress`) | 4,000 events across 1,000 tool cycles with 100 KB payloads; bounded resumable projection | Live model throughput, database write contention and end-to-end task latency |
| Sandbox spawner | 1000 exec boundary validations with 128 environment values; 1000-event SSE burst | Docker/Kubernetes provisioning, concurrent session admission, image warmup |
| Sandbox daemon/runtime | Real Node process output and complete 1 MiB disk replay; 16,000-record journal writes; 20 late reconnects per sample requesting the last ten records | Linux subreaper, sustained concurrent reconnects, container resource ceilings and image-only document dependencies |
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

The journal workloads use the segmented replay spool and actual temporary files.
Write samples include record encoding, bounded 128 KiB admission windows, committed
writes, a verified ten-record suffix replay and descriptor closure. Reconnect
samples reuse a completed 16,000-record spool prepared before timing; each sample
makes 20 sequential suffix replays and checks every returned sequence and payload.
The exec-manager tests own replay-marker validation. Setup still contributes to
process memory measurements. These workloads exercise Node and the host
filesystem, without a container network or model provider; their batch timings
do not predict complete agent-run latency.

The projection workloads feed the same 262,144 UTF-16 code units in one-unit or
4096-unit deltas. The text includes JSON escapes, multibyte characters and paired
and lone surrogates. Every 4096 units, each sample verifies the exact retained
text and timeline; it also checks that earlier snapshots survive subsequent text
and tool-result updates unchanged. The complete terminal answer is checked once
at the end. Timing includes these checks and the shared answer accumulation.
This measures display accumulation and snapshots, excluding protocol parsing, database writes,
model calls and rendering. Snapshots follow a fixed input cadence, not a simulated
network rate or a production latency target.

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
