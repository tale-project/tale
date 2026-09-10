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

Before starting inner Docker, the runtime chooses a private `/16` against
its actual IPv4 routes and the planned organization build bridge. It prefers
`172.31.0.0/16`, then other private ranges; `docker0` and inner Compose networks
use `/24` blocks within the chosen pool. The same pool drives transparent
outbound routing. Missing or malformed route observations and pool exhaustion
fail session startup with a specific log message.

Organization build networks attach only after runnerd is ready and the spawner
has verified forwarding protection inside the session. Keep the runtime image on
the same release as the spawner and egress image. Generated Docker session
containers disable IPv6 with `net.ipv6.conf.all.disable_ipv6=1` and
`net.ipv6.conf.default.disable_ipv6=1`; preserve these sysctls in custom
deployment definitions. An IPv4-only host then needs no IPv6 firewall module.

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
