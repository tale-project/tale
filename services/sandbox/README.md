# @tale/sandbox

Tale sandbox spawner — a thin, stateless `docker run` service that launches
ephemeral `@tale/sandbox-runtime` containers for `artifact_run` (one container
per execute call, plus optional long-lived persistent sessions).

It mounts `/var/run/docker.sock` (host root — an accepted threat boundary) and
writes session state under the host session root mounted at
`/var/lib/tale-sandbox/sessions`.

```bash
bun run --filter @tale/sandbox dev    # bun --hot src/server.ts (local session root in /tmp)
bun run --filter @tale/sandbox test   # bun test
```

## Container

`docker-entrypoint.sh` (PID 1, container-level bootstrap — ensures the host
session root exists) `exec`s `entrypoint.sh` (the bun server launch) so signals
reach the server directly. See the script headers for the split rationale.

```bash
# from repo root
docker build -f services/sandbox/Dockerfile .
```
