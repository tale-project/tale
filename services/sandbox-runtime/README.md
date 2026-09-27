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

Headless Chromium and Playwright are available on demand for automation,
rendering and screenshots. The runtime starts no display server, managed
browser or viewing tunnel. Configured transparent egress redirects external
network access through `@tale/sandbox-egress`; Playwright MCP also receives
the proxy settings through its launcher.

Python document libraries are baked into the shared Python 3.12 environment:
openpyxl and xlrd for spreadsheets, pypdf for PDFs, PyYAML for safe YAML
parsing, and xmlschema for XSD validation. defusedxml enables openpyxl's XML
entity protection. The complete version and wheel-hash lock is
[`document-python-requirements.txt`](document-python-requirements.txt), including
the transitive libraries and Linux amd64/arm64 wheels. Image builds require
those hashes and refuse source distributions. Keep PyYAML compatible with the
Hermes pin when updating the lock; the vision tool's isolated Pillow environment
is separate.

Both default and agent sessions can import these libraries without installing
packages during a run. Existing per-session dependencies remain on the Python
path, and application-specific bootstrap checks can stay as a fallback.
`container-image-test.ts` verifies the baked lock bytes, exact versions and
installed file hashes, then exercises synthetic PDF/XLSX/XLS/YAML/XML documents
as both session users with networking disabled and a read-only root. The release's
shared container gate runs on amd64. Each native amd64/arm64 runtime build also
runs this document check for both users against its pushed image digest, after
verifying the source, revision and version labels. Both builds must pass before
the release manifests are published.

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
long-lived session accumulates. `install-playwright-browsers.sh` bakes the
browser bundles at build time. See the script headers for the split rationale.

```bash
# from repo root
docker build -f services/sandbox-runtime/Dockerfile .
```

### Built-in skills

The image bakes Tale's built-in skills under `/opt/agents/skills/<name>` — today
the `visual-aspect-analyzer`, with its dependencies and the Playwright MCP's
Chromium. At every session start the `daemon` dispatch links each one into
every harness's native user-level skill directory under the session HOME, so
whichever harness runs a turn lists the skill among its own and runs it in
place. No agent needs to equip it and no turn stages it. Each directory is
verified against the CLI version the Dockerfile pins:

| Directory under HOME | Harnesses |
| -------------------- | --------- |
| `.claude/skills` | Claude Code (`CLAUDE_CONFIG_DIR`); OpenCode reads it too |
| `.agents/skills` | Codex, Gemini CLI, Qwen Code, Pi, OpenClaw, OpenCode, Cursor |
| `.hermes/skills` | Hermes (`HERMES_HOME`) |

A directory or a live link someone put where a link would go is kept, so a
user-level skill of the same name is never overwritten. Skills equipped on an
agent are separate: a run stages them under `/agent/workspace/.tale/skills/`
and names them in its instructions.

When the workspace repository ships a skill of the same name at its root
(`.agents/skills/<name>` or `.claude/skills/<name>`), each harness's own
loader decides which copy the model sees:

| Harness | Lists |
| ------- | ----- |
| Gemini CLI, Qwen Code, Pi, OpenClaw | the repository's copy |
| Claude Code | the baked copy: it ranks user skills above project skills |
| Codex | both copies, each with its path |
| OpenCode | either copy: it keeps whichever finishes loading last |
| Hermes | the baked copy: it has no project-level skills |

`tests/integration/container-sandbox-runtime-test.ts` holds both tables. It
checks every link, then runs each managed harness's golden exec against a stub
model endpoint and asserts the skill in the first model request and the copy
listed beside a repository skill of the same name. A harness added to the
registry without a row fails it. Cursor runs only on its own credentials, so
its directory is checked against its source rather than run there.

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
