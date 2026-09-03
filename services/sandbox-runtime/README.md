# @tale/sandbox-runtime

Tale sandbox runtime image — the ephemeral Python/Node executor that
`@tale/sandbox` launches per `/v1/execute` call. Two dispatch modes:

1. **One-shot** — a single execute call runs and the container exits.
2. **Persistent session** (`daemon` dispatch) — a long-lived container that
   keeps state across calls, optionally with an inner Docker daemon (DinD) and
   transparent egress redirection through `@tale/sandbox-egress`.

All network egress is REDIRECTed through the egress proxy; the VNC/debug
endpoints the entrypoint binds are loopback-only.

```bash
bun run --filter @tale/sandbox-runtime docker:build
```

## Container

`docker-entrypoint.sh` (PID 1, container-level envelope) `exec`s `entrypoint.sh`
with args preserved, which dispatches on mode and `exec`s the executor so
signals (SIGTERM) reach it directly. The `daemon` (session) dispatch `exec`s
`tini -g` with runnerd as its child on every path, so PID 1 reaps the orphans a
long-lived session accumulates. `install-playwright-browsers.sh` bakes the
browser bundles at build time. See the script headers for the split rationale.

```bash
# from repo root
docker build -f services/sandbox-runtime/Dockerfile .
```
