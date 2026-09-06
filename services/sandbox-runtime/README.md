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

All network egress is REDIRECTed through the egress proxy; the VNC/debug
endpoints the entrypoint binds are loopback-only.

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
