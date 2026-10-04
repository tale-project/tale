# @tale/sandbox-runtime

Tale sandbox runtime image — the Python/Node/coding-agent environment that
`@tale/sandbox` launches as a persistent session. Two dispatch modes:

1. **Persistent session** (`daemon` dispatch) — a long-lived container running
   `runnerd` that keeps state across calls, optionally with an inner Docker
   daemon (DinD, agent profile only) and transparent egress redirection through
   `@tale/sandbox-egress`.
2. **`egress-sidecar`** — the Kubernetes native sidecar that installs the
   transparent-egress redirect and runs redsocks beside the session container.

Any other argument exits 65 (there is no per-call language lane).

runnerd keeps the complete exec protocol in a disk-backed journal for
reconnection during the runtime's lifetime. Each journal is limited to 64 MiB
of encoded NDJSON, with a 256 MiB session budget; stdout/stderr's base64
encoding counts toward those limits. Completed journals are evicted oldest
first when space is needed. The 256 KiB in-memory ring is diagnostic only.
Exceeding the remaining storage budget ends the writer with `OUTPUT_LIMIT`;
an evicted or unreadable transcript reports `REPLAY_UNAVAILABLE`, never a
partial replay presented as complete. Journals are unlinked after opening and
held through file descriptors: stopping or restarting the runtime loses them,
while the workspace remains persistent.

An exec output reader is disconnected before its pending writes exceed 8 MiB.
Eight exec/attach consumers share a session-wide admission limit, including
exec requests receiving their body; additional readers receive `503 busy`.
Attach replay waits for socket drain, disconnecting a reader stalled for two
seconds, so historical output cannot fill memory faster than the client reads.
The command continues under its existing deadline. Reconnect through attach
with the last sequence number. `replay-start` precedes journal history;
`replay-complete` names the sequence through
which the history present at attachment has been delivered. Session idle and
TTL cleanup atomically checks the current work generation and activity clock
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
`busy`. URL inputs retain their 100 MiB limit; one 25-second deadline covers the
whole batch, including cache verification and final reconciliation. Queued items
cannot extend the deadline by taking turns.
Inline inputs retain their 1 MiB limit. Output reads also stream, within their
20 MiB file limit. Immutable source identities can skip a transfer only after
rehashing the current destination and checking that its pathname still names
the same unchanged file; a changed file is repaired. Reads and cache probes
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
probe bounded to two seconds. After startup, runnerd checks the fixed local
socket directly with a 750 ms deadline and shares results for one second.
A failed engine makes `/readyz` and new acquire/exec requests return 503;
authenticated `/healthz` keeps reporting process activity with
`dockerReady: false`. The spawner recycles only an atomically claimed idle,
unpinned session, preserving its workspace. Running work and pinned sessions
remain protected; engine recovery makes them ready again.

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
with args preserved, which dispatches on mode and `exec`s the daemon so
signals (SIGTERM) reach it directly. The `daemon` (session) dispatch `exec`s
`tini -g` with runnerd as its child on every path, so PID 1 reaps the orphans a
long-lived session accumulates. runnerd starts every exec under
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
outside runtime layers. The October harness refresh grows the amd64 image to
about 6.0 GB; its image-validation budget is 6,600 MB (roughly 10% headroom).
The complete upstream runtimes and diagnostics ship in the image, which is
shared by concurrent sessions. This increases image pull and base-image disk
cost; it does not duplicate the base image for every worker.

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
remains non-root, and cancellation removes the private per-execution context
file. Keep the harness catalog and runtime image aligned when changing Gemini
settings.

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
