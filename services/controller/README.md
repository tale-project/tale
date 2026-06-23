# @tale/controller

Tale controller — a privileged, internal-only control-plane sidecar that
performs the one privileged action the browser-facing platform must not:
restarting sibling containers so a deployment-config change takes effect.

It mounts `/var/run/docker.sock` (host root — the same accepted threat boundary
as the sandbox spawner) but is far more constrained:

- **HMAC-signed requests only** (timestamp + nonce replay guard).
- **Hard service allowlist** — `{convex, sandbox}`.
- **list + restart only** — never `run`/`exec`.
- Reachable only on the internal network.

Opt-in: the container starts only under the `controller` compose profile
(`docker compose --profile controller up -d`).

## Scripts

```bash
bun run --filter @tale/controller dev     # bun --hot src/server.ts (needs CONTROLLER_TOKEN)
bun run --filter @tale/controller start   # bun src/server.ts
bun run --filter @tale/controller test    # bun test
```

## Build

```bash
# from repo root — context is `.` so COPY paths are repo-root relative
docker compose --profile controller build controller
docker build -f services/controller/Dockerfile .
```

Zero runtime dependencies → no `bun install`; Bun runs the TypeScript directly.
