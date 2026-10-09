# @tale/sandbox-runtime

Tale sandbox runtime image — the Python/Node/coding-agent environment that
`@tale/sandbox` launches as a persistent session. Two dispatch modes:

1. **Persistent session** (`daemon` dispatch) — a long-lived container running
   `runnerd` that keeps state across calls, optionally with an inner Docker
   daemon (DinD, agent profile only) and transparent egress redirection through
   `@tale/sandbox-egress`.
2. **`egress-sidecar`** — the Kubernetes native sidecar that installs the
   transparent-egress redirect and runs redsocks beside the session container.

`internal-dockerd` is reserved for the root supervisor's engine child. Any
other argument exits 65 (there is no per-call language lane).

A session's HOME is `/agent/.runtime/home` on the persistent workspace, and
`NODE_COMPILE_CACHE` names `.cache/node-compile-cache` under it, created at the
session's user. Node programs a session starts again (a harness CLI, the
per-turn helpers, runnerd itself) reuse V8's compiled code across turns and
resumes instead of compiling their bundles again; the cache is never under the
exec temp that every container start wipes. The root Docker supervisor starts
without it, because the agent user can write that directory; runnerd and its
execs get it back.

## Repository SSH access

The maintained runtime installs OpenSSH (`ssh`, `ssh-agent`, `ssh-add`) and
`netcat-openbsd`. Repository-scoped keys are explicitly granted project secrets;
load them from the turn environment into `ssh-agent` through stdin, never a key
file. Member-started turns keep the existing secret-withholding policy.
Credentialed turns receive the real workspace owner's Git author name and email
even when no GitHub connector is equipped; SSH authentication grants no connector
permission.

Internal sandbox sessions already carry `HTTP_PROXY`. Route SSH with
`nc -X connect -x <proxy-host>:<proxy-port> %h %p` as OpenSSH's `ProxyCommand`,
using a proxy-authorized repository endpoint (GitHub's SSH endpoint is
`ssh.github.com:443`). Parse the existing proxy URL, require an unauthenticated
`http` proxy, and quote every argument with `shlex.join`; keep strict host-key
verification against the provider's independently verified public pin. This
passes the repository hostname to the existing egress service instead of
requiring external DNS in the isolated session. The runnable configuration is in
[SSH repository access](https://docs.tale.dev/self-hosted/configuration/environment-reference#ssh-repository-access).
The container image conformance suite tests stdin key loading and an offline
CONNECT tunnel as both supported non-root runtime users.

When DinD is enabled, the session starts with the standard Docker socket and
no inner engine. Its first Docker client starts the engine automatically;
concurrent clients share that startup. After five minutes without clients,
the supervisor stops the engine only if no container is running, restarting
or paused and every container has its restart policy disabled. Unknown
inventory keeps it running. The next Docker command starts
it again with the same image store, volumes and workspace. Before that stop,
an engine whose images and build cache exceed 10 GiB removes its dangling
images and prunes its build cache to 5 GiB through the engine API (bounded,
logged, never blocking the stop); a Kubernetes store limited below 10 GiB is
bounded by its volume's size limit instead. Existing container state at
session-container boot starts the engine immediately so restart policies still
work. This needs no agent setting and does not change the
deployment's runtime isolation or resource limits.

runnerd keeps the exec protocol in checkpointed disk segments for reconnection
within the runtime's lifetime. Each exec may retain up to 64 MiB of unacknowledged
encoded NDJSON; stdout/stderr base64 counts toward that bound. All live and
retained execs share a 256 MiB physical storage budget, including checkpoints and
unlinked segments still held by readers. Completed spools are evicted first.
Disk replay is the sole retained output history. A committed parser checkpoint
acknowledges its prefix before segments are pruned, allowing long runs to exceed
the per-exec bound over time. Unacknowledged overflow ends the writer with
`OUTPUT_LIMIT`; evicted or unreadable replay reports `REPLAY_UNAVAILABLE`.
A journal or checkpoint write the disk refuses for want of space (`ENOSPC`, or
`EDQUOT` for a spent quota) ends the exec with `REPLAY_DISK_FULL` instead, so the failure names
the host's full disk rather than a lost transcript.
An acknowledged prefix missing from an older reader's cursor produces an exact
gap range, which the platform can recover from a covering checkpoint.
Spools live under `/agent/.runtime/tmp` on the workspace disk, independently
of `TMPDIR`; descriptor-anchored creation rejects a symlinked runtime directory.
Replay disk operations and queued control calls have a five-second deadline.
Failure does not release the physical storage charge before the outstanding
operation and descriptor close.

Output framing retains at most three trailing bytes until a split UTF-8
character is complete, without changing raw bytes. Each stdout/stderr record
contains at most 64 KiB of base64, split before encoding at a complete character.
Writes batch up to 64 records
or 128 KiB (a larger single record stays intact), and backpressure child output
at 128 KiB queued, plus the chunk already delivered by the pipe. Sparse record
indexes every 64 KiB let reconnects seek near their cursor within a segment.
An exec reader is disconnected before pending writes exceed 8 MiB. Eight
exec/attach consumers share a session-wide admission limit, including exec
requests receiving their body; excess consumers receive a retryable `503 busy`
without changing the exec. Invalid or future replay cursors fail explicitly.
Attach replay waits for socket drain and disconnects a reader stalled for two
seconds. The command continues under its existing deadline. Reconnect using
the last sequence number. `replay-start` precedes history; `replay-complete`
names the attachment's initial sequence watermark. Checkpoints are atomically
committed (a temporary file renamed into place) before acknowledged segments are
removed; they are not synced to disk, since nothing reads one after a restart.
Normal disposal removes runtime-owned spool files; the entrypoint cleans their
temporary directory at restart. Replay does not survive runtime restart, while
the workspace does.

Session idle and TTL cleanup atomically checks the current work generation and activity clock
before freezing compute; see the [session contract](../sandbox/docs/sessions.md).

Process cleanup indexes each process-table snapshot once by execution, parent,
group and PID. A session retaining many executions' background processes reuses
those indexes throughout the cleanup pass instead of rescanning the complete
table for every execution. The indexes expire with the pass; later passes
still check process identity and ownership from a fresh snapshot.

Completed commands release their request and consumer data even while another
command keeps the session active. Process cleanup retains only the ownership
and liveness data it still needs. Held-open stdin has an 8 MiB pending-write
ceiling: a nonreading command refuses further lines with `WRITE_FAILED` until
its pipe drains, without partially accepting the refused line.

File staging streams each URL into a temporary file beside its destination
and replaces the destination only after a complete, bounded download. Cancelling
or failing a download preserves the previous file. Atomic replacement preserves
the destination's permission bits, including executable files. At most two stage requests
are admitted at once, including their JSON intake; excess requests report
`busy`. Two transfers run concurrently across all admitted batches. A 25-second
deadline covers the whole batch, including cache verification and final
reconciliation. Queued items share the same deadline. Cancellation propagates
through the platform and spawner to the active transfer. URL inputs retain their
100 MiB limit and inline inputs their 1 MiB limit. Output reads also stream, within their
20 MiB file limit. Immutable source identities can skip a transfer once the
current destination is verified: by a rehash that checks its pathname still
names the same unchanged file, or, after one such rehash, by an unchanged stat
(device, inode, size, nanosecond mtime and ctime, read through the path twice)
without reading the bytes again; a changed file is repaired. The source
manifest survives runnerd restarts in `/agent/.runtime/staged-sources.json`,
signed with runnerd's token, so a session resumed after an idle stop reuses
its staged inputs instead of fetching them again; a manifest that does not
verify is ignored. Reads and cache probes
reject symlinks and named pipes without blocking filesystem workers. Explicit final
manifests remove stale files only within the named managed roots after all
transfer batches succeeded. The
[session contract](../sandbox/docs/sessions.md) describes that internal API.

Headless Chromium and Playwright are available on demand for automation,
rendering and screenshots. The runtime starts no display server, managed
browser or viewing tunnel. Configured transparent egress redirects external
network access through `@tale/sandbox-egress`; Playwright MCP also receives
the proxy settings through its launcher (`tale-playwright-mcp`). Every managed
agent turn lists the Playwright MCP server, but most never open a browser, and
the server — a Node process that loads Playwright — holds about 100 MB while it
runs. So the launcher answers the start of a turn itself (`initialize`,
`tools/list`, `ping`, and the prompt and resource lists Qwen Code asks every
server for, with the server's own `Method not found` while it advertises
neither) from manifests of the real server's answers, recorded at image build
for the argument sets the platform passes
([`playwright-mcp-args.json`](playwright-mcp-args.json)), and starts the server
only on the turn's first tool call, replaying the start to it (a server that
does not answer it within two minutes is ended, and the launcher with it, so
the tool call fails instead of waiting). Unknown
arguments or protocol versions, a server on `PATH` other than the image's (one
the session installed), `PLAYWRIGHT_MCP_*` settings in the environment, and
`TALE_PLAYWRIGHT_MCP_EAGER=1`, start the server at once.

Python document libraries are baked into the shared Python 3.12 environment:
openpyxl and xlrd for spreadsheets, pypdf for PDFs, PyYAML for safe YAML
parsing, and xmlschema for XSD validation. defusedxml enables openpyxl's XML
entity protection. The libraries the builtin document skills
(`configs/platform/custom/skills/{docx,pdf,pptx,xlsx}`) import sit beside them:
`markitdown[pptx]`, pandas, pdfplumber, pdf2image, Pillow, reportlab and lxml.
The complete version and wheel-hash lock is
[`document-python-requirements.txt`](document-python-requirements.txt), including
the transitive libraries and Linux amd64/arm64 wheels. Image builds require
those hashes and refuse source distributions. Hermes installs into the same
environment afterwards and pins some of these libraries itself (PyYAML, Pillow,
requests, certifi, cryptography, packaging), so resolve the lock against its
pins; the vision tool's isolated Pillow environment is separate. To update it,
compile `hermes-agent==<HERMES_AGENT_VERSION>` for Python 3.12 into a constraints
file, compile the direct libraries against it with
`uv pip compile --python-version 3.12 --python-platform x86_64-manylinux_2_36 --only-binary :all: --exclude-newer <date> -c <constraints>`
(the aarch64 resolution must match), and hash every cp312 manylinux wheel of
each pinned version for both architectures, one line per package. Versions
added to either lock follow the repository's Renovate release-age policy:
`<date>` lies 90 days back, and only a release that fixes a known advisory may
be younger.

The Node libraries the skills `require()` — docx, pptxgenjs, and react,
react-dom, react-icons and sharp for the icon recipe in `pptxgenjs.md` — are
locked with integrity hashes in [`document-node/`](document-node/) and installed
with `npm ci --ignore-scripts` into `/opt/tale/document-node`. The image's
`NODE_PATH` names that directory, and a session puts its own npm prefix
(`/agent/.runtime/deps/node`) in front of it, so a package an exec installs
wins over the baked copy. Refresh the lock with npm 11, the major the image's
Node 24 ships, which records each platform package's `libc` so the image skips
the musl builds. After changing an exact version in its `package.json`, run
`npx npm@11 install --package-lock-only --ignore-scripts --before <date>` in
that directory; to take a younger security release, set it and run the same
command without `--before`, which keeps the other locked versions. Check the
result with `npm audit --package-lock-only`. The repository's Trivy gate
scans this lock, and a change to it alone triggers the security workflow.
The `overrides` entry lifts image-size, which pptxgenjs declares but never
loads, to a release without its denial-of-service advisories. The skills' own
`npm install -g` and `pip install` lines stay as they are: with registry access
they refresh the session copy, without it they fail while the baked library
keeps working. OCR is not baked: the pdf skill's pytesseract route needs a
tesseract binary the image does not carry.

Both default and agent sessions can import these libraries without installing
packages during a run. Existing per-session dependencies remain on the Python
path, and application-specific bootstrap checks can stay as a fallback.
`container-image-test.ts` verifies the baked lock bytes, exact versions and
installed file hashes of both locks, then exercises synthetic
PDF/XLSX/XLS/YAML/XML documents and the skills' paths — pandas over the XLSX,
reportlab to pdfplumber, pypdfium2 and pdf2image, docx and pptxgenjs with a
sharp-rasterized icon read back through pandoc and markitdown — as both session
users with networking disabled and a read-only root. The release's
shared container gate runs on amd64. Each native amd64/arm64 runtime build also
runs this document check for both users against its pushed image digest, after
verifying the source, revision and version labels. Both builds must pass before
the release manifests are published.

Inner Docker startup has a 30-second readiness budget, with each Docker client
probe bounded to one second; timed-out probe process groups are killed.
Runnerd checks the supervisor's fixed control socket within 750 ms and shares
results for one second. The supervisor probes an active engine within 500 ms;
it leaves an intentionally sleeping engine asleep. A failed probe makes
`/readyz` and new acquire/exec requests return 503;
authenticated `/healthz` keeps reporting process activity with
`dockerReady: false`. `/healthz` also carries the supervisor's engine state as
`docker: { engine, used }`: `cold` until the first Docker command starts the
engine, `running` while it starts or runs, `stopped` after it slept or failed;
`used` is whether an engine has run in this container. The spawner keeps a
released session's full idle window only when `used` is true.

One slow probe does not authorize session recycling. At least three completed
failed probes spanning five seconds are needed for `dockerRecoveryRequired`;
cached reads do not add evidence. A healthy result or a new engine clears the
engine's failure history. An observed failed startup or unexpected engine exit
is direct failure evidence and can request recovery immediately. The spawner
still recycles only an atomically claimed idle, unpinned session. Its workspace
survives, but the Docker backend removes the session's ephemeral inner Docker
store when stopping the session. Running work and pinned sessions remain
protected; engine recovery makes them ready again.

During a rolling upgrade, keep old spawners pinned to their existing runtime
image until they are replaced. Do not move a runtime tag still used by an old
spawner: it does not understand the recovery-confidence field. A new spawner with
an older runtime refuses unhealthy new work but retains ordinary idle and
lifetime cleanup instead of accelerating cleanup from a boolean health result.

Before starting inner Docker on either backend, the runtime checks IPv4 routes
and gateways from all tables, interface addresses and prefixes, DNS servers,
proxy/gateway addresses configured at container startup, and any planned Docker
organization bridge. Hosts supplied later during a turn are not observed at boot.
Automatic selection prefers a free `172.31.0.0/16`, then other private ranges;
`docker0` and inner Compose networks use `/24` blocks within the chosen pool.
The same pool drives transparent outbound routing. Failed observations or
exhausted private space stop automatic startup with a specific log message.

Operators can set `SANDBOX_DIND_INNER_POOL` on the spawner to pass a canonical
private `/16` through the internal `TALE_DIND_INNER_POOL_OVERRIDE`. This rejects
known overlaps; unavailable observations produce named warnings and may allow
the explicit pool. A Kubernetes Pod cannot discover the full cluster Pod,
Service or VPC CIDRs, so choose an override outside those ranges. Restart the
spawner and recreate existing sessions after changing the pool; a same-Pod
runner restart retains its environment and inner Docker store. See the
[operator environment reference](../../docs/en/self-hosted/configuration/environment-reference.md#sandbox-infrastructure).

Docker organization build networks attach only after runnerd is ready and the spawner
has verified forwarding protection inside the session. Keep the runtime image on
the same release as the spawner and egress image. Generated Docker session
containers disable IPv6 with `net.ipv6.conf.all.disable_ipv6=1` and
`net.ipv6.conf.default.disable_ipv6=1`; preserve these sysctls in custom
Docker definitions. Kubernetes runners and transparent-egress sidecars do not
automatically disable IPv6 or receive unsafe Pod sysctls. Their standalone
egress proxy must satisfy the [Kubernetes IPv6 prerequisite](../sandbox/docs/kubernetes.md#egress-ipv6-prerequisite).

```bash
bun run --filter @tale/sandbox-runtime docker:build
```

## Container

`docker-entrypoint.sh` (PID 1, container-level envelope) `exec`s `entrypoint.sh`
with args preserved, which dispatches on mode. The `daemon` (session) dispatch
`exec`s `tini -g`, so PID 1 reaps the orphans a long-lived session accumulates.
Without DinD its child is runnerd; with DinD its child is the root Docker
supervisor, which forwards shutdown and starts runnerd as uid 10001. The
supervisor uses a private engine socket and proxies the ordinary
`/var/run/docker.sock` with bounded, backpressured connections. runnerd starts every exec under
`/usr/local/bin/tale-exec-shim`, built in its own stage from
`daemon/exec-shim/tale-exec-shim.c`: a child subreaper that keeps whatever the
exec starts its descendant, so runnerd can end what the exec left
([sessions](../sandbox/docs/sessions.md)). `install-playwright-browsers.sh`
bakes the browser bundles at build time. See the script headers for the split
rationale.

Inner Docker defaults to `json-file` logs rotating at 10 MB per nested container,
with one file and compression disabled, matching the outer session's log cap.
`docker logs` and Compose logs keep working. These daemon defaults apply to
new nested containers; existing ones keep their original logging configuration
until recreated, and an explicit per-container logging configuration takes
precedence. Images, volumes and workspace files are not part of this log budget.

Inner Docker and redsocks diagnostics go to container stderr, where the outer
Docker logger or Kubernetes node owns rotation. They no longer accumulate in
unbounded `/var/log/dockerd.log`, `/var/log/redsocks.log` or `/tmp/redsocks.log`
files. Existing files are left intact; this change does not reclaim old logs.

A session keeps its transparent egress up on its own. At boot the egress
proxy's name is asked again for up to about five seconds before the session
gives up on transparent egress (the first answer is used at once), and the
session's redsocks runs under a restart loop as its own uid: one that exits is
started again after 1 s, the delay doubling to 30 s and back to 1 s after a
minute's good run. In a fresh network namespace the session's nat rules (the
`REDSOCKS` chain, the `OUTPUT` hooks and the DNS DNAT) go in as one
`iptables-restore --noflush` transaction, two processes instead of about
twenty `iptables` calls; a restore the kernel refuses, or a chain that is
already there (a restart that kept its Pod's namespace), takes the per-rule
path, which checks each rule and adds only what is missing.

```bash
# from repo root
docker build -f services/sandbox-runtime/Dockerfile .
```

### Harness upgrades

The Dockerfile pins every bundled harness and the Node patch version. Refresh
the complete set together after checking each upstream's supported release
channel and runtime requirements. Claude uses its `stable` channel; Hermes uses
the PyPI distribution, whose version can differ from the GitHub release. Keep
installs at image build time so a new agent never downloads or updates its CLI
during startup. An image update does not add models to the platform catalog;
deploy the matching platform release before selecting newly supported models.

BuildKit keeps native-addon headers and the built-in skill's Bun package cache
outside runtime layers. Every host downloads and stores each layer whose bytes
change, so the layout keeps a release's change to the layers it touched:

- The OS chain (`tooling-base`: fonts and browser libraries, Office, TeX, the
  Docker engine, then the everyday tools) carries no harness version argument
  and no environment variable, and runs from the largest, stablest apt set to
  the most often extended. Adding a tool rebuilds one small layer.
- Each harness, the browser, and the document Python and Node libraries
  install in stages that never build on the OS chain (`harness-base` holds just
  Node and the download tools) and arrive as `COPY --link` layers of their own.
  An OS change reinstalls none of them, and refreshing one re-ships only its
  own layer. The guard in
  `services/platform/tests/guards/dockerfile-fail-closed.guard.test.ts` holds
  this layout.
- A release build reads only its own registry cache, so an unchanged layer
  keeps the previous release's bytes. Pull request and `main` builds read that
  cache too, after their own.
- Every published Tale image, this one included, is pushed with
  zstd-compressed layers under OCI media types (`compression=zstd`, level 3,
  `force-compression`), and the release cache stores those zstd blobs, so an
  unchanged layer is never re-encoded and keeps its digest from one release to
  the next. Pulling needs Docker Engine 23.0 or later (Tale requires 24.0, and
  the CLI checks it) or, on Kubernetes, containerd 1.5 or later. The gain is
  mostly in unpacking: in [zstd's own benchmark](https://github.com/facebook/zstd#benchmarks)
  (Silesia corpus, both at level 1) zstd decompresses at 1550 MB/s against
  zlib's 390 MB/s, and compresses to a 2.896 ratio against 2.743, about 5 %
  fewer bytes. [AWS measured](https://aws.amazon.com/blogs/containers/reducing-aws-fargate-startup-times-with-zstd-compressed-container-images)
  up to 27 % shorter Fargate task and pod starts with level-3 zstd images, the
  largest images gaining most. Neither figure has been measured on this image.
  Pull request and `main` builds compress new layers with zstd too, and keep
  the layers their GHA cache holds as gzip rather than re-encode them.
- Every base image and `COPY --from` image is pinned by digest; Renovate bumps
  them, so a base refresh is a reviewed change rather than whatever a tag
  pointed at when a cache missed.

Payloads a headless Linux session never runs are removed in their stages:
Cursor's two macOS-only single-executable builds, Codex's realtime voice host
and Qwen's ripgrep builds for other platforms. The Python stdlib is compiled to
hash-based bytecode at build time, because the read-only root cannot cache it
at run time.

The image remains shared by concurrent sessions.

Headless Chromium is the only baked browser. Playwright scripts use their usual
`chromium.launch({ headless: true })`; the MCP launcher selects that same pinned
executable and answers `browser_install` without downloading another browser
when the baked browser is present. Explicit browser, executable and configuration
overrides keep the real server's installation behavior. Office, PDF, CJK fonts,
XeTeX, all managed harnesses and Docker tooling remain available offline.

The runtime's image-validation budget measures the sum of unpacked image layers,
including files superseded in later layers. It does not use packed OCI content
size, which Docker's containerd store can report through `image inspect .Size`.
Inspect that disk requirement directly:

```bash
docker image history --no-trunc --human=false --format '{{.Size}}' tale-sandbox-runtime \
  | awk '{ bytes += $1 } END { printf "%.0f bytes (%.1f MiB)\n", bytes, bytes / 1048576 }'
```

Run the wrapper regression tests and the real image conformance suite before
shipping a refresh:

```bash
bun run --filter @tale/sandbox-runtime-daemon test
bun run docker:test:sandbox-runtime
```

To test a previously built image, set `IMAGE=<ref>` and `SKIP_BUILD=true` on
the second command. The image suite checks every registry harness against its
exact Dockerfile pin, from separate empty homes with networking disabled, a
read-only root and all capabilities dropped. Each version probe has a
60-second cold-start deadline and reports its elapsed time. It also exercises
the real wrapper flags and SDK signatures, managed executions against a stub
model, baked skills, process cleanup, and lazy browser startup. These checks
need no provider credentials; live subscription authentication still requires
verification after rollout. CI runs the image conformance gate on amd64.

Claude Code runs under the image's managed settings (`managed-settings.json`,
installed as `/etc/claude-code/managed-settings.json`, which no repository or
user setting overrides). They keep transcripts for 60 days (`cleanupPeriodDays`;
the CLI's own default is 30): Claude Code deletes older ones when it starts, so
the store on the organization's `/agent` volume holds two months of
conversations rather than a year. A task resumed after its transcript is gone
restarts fresh on its preserved files. `daemon/src/managed-settings.test.ts`
holds the period.

Hermes keeps SDK diagnostics on stderr so stdout remains NDJSON and disables
the SDK's artificial delay between tool calls. Provider retry and backoff stay
enabled. OpenClaw's wrapper treats a structured error as a failed execution
even when the CLI itself exits successfully.

Gemini requires its system settings and every ancestor directory to be owned
by root and not writable by group or others. The image generates immutable
policy files from the platform's existing harness interpreter; the wrapper
selects the file matching the incoming settings and supplies only the bridge
URL and a unique context filename through environment substitution. Repository
settings cannot override that system policy. A platform/image policy mismatch
fails before the CLI starts and asks for a runtime update. Agent execution
remains non-root. Keep the harness catalog and runtime image aligned when
changing Gemini settings.

The Gemini and Pi wrappers stage their per-execution files, then replace
themselves with the CLI (`exec`, same pid): no Python process stays resident
for the turn, and the CLI's exit status and signals are the execution's own.
The prompt reaches the CLI on stdin from an anonymous temporary file. Nothing
is left to remove the staged files when the CLI exits, so their names carry the
execution's pid: Gemini's private context file under `~/.gemini/` (the only
place Gemini reads a global context file from), and Pi's config directory
under `$TMPDIR`. The next wrapper to start removes every one whose pid no
longer runs, and the entrypoint empties `$TMPDIR` at every container start. A
wrapper cancelled before its CLI starts removes what it staged itself. The
Qwen, Hermes and OpenClaw wrappers run their CLI as a child and wait for it.

### Built-in skills

The image bakes Tale's built-in skills under `/opt/agents/skills/<name>` — today
the `visual-aspect-analyzer`, with its dependencies and the Playwright MCP's
Chromium. runnerd links each one into every harness's native user-level skill
directory under the session HOME, so whichever harness runs a turn lists the
skill among its own and runs it in place. No agent needs to equip it and no
turn stages it. Each directory is verified against the CLI version the
Dockerfile pins:

| Directory under HOME | Harnesses |
| -------------------- | --------- |
| `.claude/skills` | Claude Code (`CLAUDE_CONFIG_DIR`); OpenCode reads it too |
| `.agents/skills` | Codex, Gemini CLI, Qwen Code, Pi, OpenClaw, OpenCode, Cursor |
| `.hermes/skills` | Hermes (`HERMES_HOME`) |

A skill the workspace repository ships wins over the baked one of the same
name. The harnesses cannot settle that on their own — Claude Code ranks user
skills above project skills, Codex lists both copies and OpenCode keeps
whichever finishes loading last — so while
`/agent/workspace/.claude/skills/<name>/SKILL.md` exists runnerd withdraws the
`<name>` link from `.claude/skills` under HOME, and likewise for
`.agents/skills`. It reconciles at boot and again before every exec, so a
repository cloned during one turn decides the next, and a withdrawn link comes
back once the repository no longer ships the skill. With the repository copy in
both directories:

| Harness | Lists |
| ------- | ----- |
| Claude Code, Codex, Gemini CLI, Qwen Code, Pi, OpenClaw, OpenCode | the repository's copy |
| Hermes | the baked copy: it reads no project-level skills |

With the copy in one directory only, a harness that does not read that
directory keeps the baked copy (Claude Code does not read `.agents/skills`),
and OpenCode, which reads both, may list either.

runnerd touches only its own links: a directory or a live link someone put
where a link would go is kept, so a user-level skill of the same name is never
overwritten. Skills equipped on an agent are separate: a run stages them under
`/agent/workspace/.tale/skills/` and names them in its instructions.

`daemon/src/baked-skills.test.ts` holds the reconcile.
`tests/integration/container-sandbox-runtime-test.ts` holds both tables against
a booted session: it checks every link, then runs each managed harness's golden
exec through runnerd against a stub model endpoint and asserts the skill in the
first model request, the copy listed beside a repository skill of the same
name, and the links withdrawn and restored. A harness added to the registry
without a row fails it. Cursor runs only on its own credentials, so its
directory is checked against its source rather than run there.

### Vision lane environment

Every managed gateway turn that resolved a vision model runs with
`TALE_GATEWAY_URL`, `TALE_GATEWAY_TOKEN` and `TALE_VISION_MODEL` in the agent's
environment, so the in-image tools — the `tale-vision` batch CLI and
`tale-vision-transcribe` — can call that model through the gateway with the
session key, whether or not the serving model reads images itself. The Read
polyfill (`tale-vision-read-hook`: transcribing the agent's own image reads and
denying native PDF reads) is a separate decision: it acts only when the platform
also sets `TALE_VISION_READ_POLYFILL=1`, which it does for a text-only serving
model alone. A vision-capable agent keeps its native image reads and inline
browser screenshots and still has the batch lane for its scripts.

### Per-request vision thinking

`tale-vision --thinking disabled` requests the standard Anthropic disabled-thinking mode for that batch only. The default (`--thinking provider`, or omission) leaves provider behavior unchanged. Choose the override only for a compatible vision model; it does not change provider defaults, output-token limits, image processing, per-image deadlines or the ordinary Read-hook fallback. The batch cache distinguishes the override from the provider default, while the default retains historical cache entries. Runtime tests cover both request forms, cache isolation, exact original image bytes and invalid-value refusal.

File staging streams downloads to temporary files and atomically renames them on
success. At most two files stage concurrently under one 25-second batch deadline;
cancellation removes temporary files. Verified SHA-256 manifests skip unchanged
managed inputs, while changed or deleted workspace files are repaired. `/livez`
checks daemon liveness; `/readyz` also checks requested Docker capability.
`/healthz` reuses that Docker snapshot and adds bounded, coalesced egress
diagnostics when configured. Docker-disabled sessions remain ready; health
failures do not hide activity or prevent file access and exec cancellation.
A container launched with `TALE_RUNNERD_INCARNATION` (the spawner's creation
stamp) names it as `incarnation` in `/healthz` and in every activity answer,
and refuses with `409 incarnation_mismatch` an activity request whose
`x-tale-runnerd-incarnation` header names another stamp, before anything
changes. A malformed stamp is never named; without one, answers name none and
requests are not checked.

An exec starts from runnerd's own environment without what is runnerd's alone:
its auth token and incarnation (`TALE_RUNNERD_*`, which no env patch may set
either) and the raw `TALE_SESSION_ENV` seed, whose entries reach the exec
through the env store. A harness that prints its environment no longer puts
the token into the agent's transcript.

runnerd ends an exec that has stalled: no output for `TALE_EXEC_STALL_MS`
(45 minutes unless the spawner sets it, `0` turns the watch off) and, over that
same window, under 1% of one CPU used by the exec's processes — its subreaper
shim and the shim's descendants, read from `/proc/<pid>/stat`, plus the CPU of
the inner Docker engine's containers, which work for whichever exec started
them. The exec ends through the cancel path (SIGTERM, then SIGKILL after the
grace), and its `exit` event carries `failure: "EXEC_STALLED"`; the spawner
reports it as the `EXEC_STALLED` error code and sets the window from
`SANDBOX_EXEC_STALL_MINUTES`. The process table is read once a minute at most,
and a table that cannot be read judges nothing.

runnerd refuses to start an exec in a session about to run out of memory: when
the session cgroup's working set (`memory.current` minus the `inactive_file`
cache it can drop at once) has reached `TALE_EXEC_ADMISSION_MEMORY_PERCENT` of
`memory.max` (90 unless set, `0` admits every exec), `POST /execs` answers
`429` `{ error: "session_memory_busy", code: "SESSION_MEMORY_BUSY" }` with
`retry-after: 5`. Nothing starts and the running execs are left alone; a
session without a limit, or whose cgroup cannot be read, is never refused.

runnerd says when the session's memory limit ended an exec. It reads the
session cgroup's `oom_kill` count (`memory.events`, the whole subtree) as the
exec starts and again as it ends: an exec that died of SIGKILL (exit 137) that
neither a cancel, its deadline nor the stall watch sent, while that count
rose, carries `oomKilled: true` on its `exit` event, which the spawner reports
as the `OOM_KILLED` error code. Another exec's OOM kill does not make an
ordinary failure an OOM. The exit also carries the session's memory peak
(`memory.peak`, since the container started) where the kernel reports one,
and `/healthz` reports the session's `memory`: in use, the limit, the peak
and the OOM kills so far.
