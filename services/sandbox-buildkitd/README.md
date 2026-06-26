# Tale Sandbox Shared buildkitd

A single, persistent BuildKit daemon shared by every DinD sandbox session on a
host. Its content-addressed cache (`/var/lib/buildkit`, a persistent volume) is
reused across sessions **automatically** — so `docker compose up --build` in one
session reuses the layers another already built, instead of every session
rebuilding from zero.

## How it fits together

- The spawner launches this lazily, once per deployment, on `tale-sandbox-net`
  (see `services/sandbox/src/buildkitd.ts`). Opt-in:
  `SANDBOX_DOCKER_BUILD_CACHE=true` (only meaningful with DinD enabled).
- Each session's entrypoint creates a **remote buildx builder** pointing at this
  daemon (`TALE_BUILDKITD_ENDPOINT`) and sets `BUILDX_BUILDER`, so plain
  `docker build` / `docker compose up --build` route here transparently — no
  `--cache-to/--cache-from` flags. The daemon's own internal cache is the shared
  cache.
- **Egress.** `tale-sandbox-net` is `--internal`, so build RUN steps have no
  direct internet. `--oci-worker-net=host` runs them in this container's netns,
  and `docker-entrypoint.sh` installs the same transparent egress as a session
  (`OUTPUT -> redsocks -> sandbox-egress`, with the IMDS/RFC1918 fence and DNS
  via the egress dnsmasq). So build egress is fenced like the rest of the
  sandbox.

## Runtime requirements

- `--privileged` (buildkitd needs mount/namespace ops to run builds).
- Attached to `tale-sandbox-net`, with `HTTPS_PROXY` pointed at the egress proxy
  so the entrypoint can resolve it for redsocks + DNS.
- A persistent volume at `/var/lib/buildkit` (the cache; bounded by the GC
  policy in `buildkitd.toml`).

## Scope / follow-ups

- **One global daemon** in v1 (cross-org cache shared — acceptable for
  single-enterprise self-host). The spawner helpers are keyed by org id, so
  per-org isolation later is a name change + a per-org network or mTLS.
- Bare `docker build` to the remote builder leaves the image in the build cache
  (needs `--load` to run); `docker compose up --build` auto-loads — that's the
  supported transparent path.
