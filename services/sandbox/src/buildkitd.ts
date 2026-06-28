// Shared cross-session docker build cache: a single, persistent buildkitd that
// every DinD session's remote buildx builder points at. The daemon's own
// content-addressed cache (/var/lib/buildkit, a persistent volume) is reused
// across sessions automatically — no `--cache-to/--cache-from`. See
// services/sandbox-buildkitd/ for the image + services/sandbox/docs/
// docker-in-container.md for the model.
//
// SCOPE: v1 runs ONE global daemon (cross-org cache shared — acceptable for
// single-enterprise self-host). Every helper here is KEYED BY organizationId so
// per-org isolation later is a name change here (append `-${org}`) + a per-org
// network / mTLS — with zero caller churn, since the session backend already
// passes organizationId. No data migration: the build cache is regenerable.

import { runDocker } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// gRPC port the buildkitd listens on (matches services/sandbox-buildkitd/
// buildkitd.toml). On the internal sandbox network only; never host-published.
const BUILDKITD_PORT = 1234;

// Marker the buildkitd entrypoint (services/sandbox-buildkitd/
// docker-entrypoint.sh) writes ONLY after its transparent-egress fence is fully
// installed (redsocks + default route + a [dns] block pinned to the CURRENT
// egress IP). We probe it before reusing a running daemon: one that restarted
// (--restart unless-stopped) while sandbox-egress was unreachable comes up with
// no fence and silently serves builds with no internet (RUN steps fail to
// resolve any external host). Keep this path in sync with EGRESS_READY in the
// entrypoint.
export const EGRESS_READY_MARKER = '/run/tale-buildkitd-egress-ready';

// Pull-through registry mirrors. buildkit's image-PULL DNS runs in the daemon
// process via Go's resolver against docker's embedded resolver (127.0.0.11),
// which SERVFAILs Go's queries for EXTERNAL names on a user-defined network
// ("server misbehaving") — and can't be fixed from inside the container
// (resolv.conf / [dns] / GODEBUG all ignored for pulls). The robust fix is to
// never resolve an upstream registry from buildkit at all: one `registry:2`
// pull-through cache PER upstream registry, each referenced by its docker NAME
// (a SIBLING name, which the embedded resolver answers locally without
// forwarding → no SERVFAIL). buildkit pulls base images by name from the mirror;
// the mirror reaches upstream via the egress proxy (HTTPS_PROXY) so it needs no
// external DNS itself, and caches base-image layers across sessions (a bonus).
// A `FROM` base from a registry NOT in this list can't be pulled (so the default
// covers the common base-image registries; extend via the config env).
const MIRROR_PORT = 5000;
const MIRROR_PREFIX = 'tale-buildkitd-mirror';
// The base-image registries we stand up a pull-through cache for, built in. A
// `FROM` base from a registry NOT mirrored here can't be pulled (buildkit can't
// resolve its external name), so this covers the common public registries
// directly — no operator config to get right. Add one here to support more.
export const MIRROR_REGISTRIES = ['docker.io', 'ghcr.io', 'quay.io'] as const;

function sanitize(registry: string): string {
  return registry.replace(/[^a-zA-Z0-9]+/g, '-');
}
/** Per-registry pull-through cache container name. */
export function buildkitdMirrorContainerName(registry: string): string {
  return `${MIRROR_PREFIX}-${sanitize(registry)}`;
}
function buildkitdMirrorVolumeName(registry: string): string {
  return `${MIRROR_PREFIX}-cache-${sanitize(registry)}`;
}
/** The mirror reference (`name:port`) buildkit points `registry` at. */
export function buildkitdMirrorRef(registry: string): string {
  return `${buildkitdMirrorContainerName(registry)}:${MIRROR_PORT}`;
}
// registry:2 proxies ONE upstream per instance; Docker Hub's registry API host
// differs from its canonical name.
function mirrorUpstream(registry: string): string {
  return registry === 'docker.io'
    ? 'https://registry-1.docker.io'
    : `https://${registry}`;
}

function assertOrg(organizationId: string): void {
  if (!ORG_RE.test(organizationId)) {
    throw new Error(
      `buildkitd: refusing unsafe organizationId: ${JSON.stringify(organizationId)}`,
    );
  }
}

/** Container name of the shared daemon. v1 = one global daemon. */
export function buildkitdContainerName(organizationId: string): string {
  assertOrg(organizationId);
  return 'tale-buildkitd';
}

/** Persistent cache volume backing /var/lib/buildkit. v1 = one global volume. */
export function buildkitdCacheVolumeName(organizationId: string): string {
  assertOrg(organizationId);
  return 'tale-buildkitd-cache';
}

/**
 * The remote-builder endpoint a session connects its buildx builder to.
 * Reachable by container name on the (internal) egress network — the session's
 * redsocks leaves RFC1918 direct, so this resolves + connects without
 * traversing the proxy.
 */
export function buildkitdEndpoint(organizationId: string): string {
  return `tcp://${buildkitdContainerName(organizationId)}:${BUILDKITD_PORT}`;
}

// Coalesce concurrent ensure* calls for the same container (two sessions from
// the same deployment starting at once would otherwise both race past the
// inspect gate and both `docker run --name`, the second erroring). Mirrors
// ensureCacheVolume in volume.ts.
const ensureInFlight = new Map<string, Promise<string>>();
const mirrorInFlight = new Map<string, Promise<void>>();

/**
 * Lazy, idempotent launch of every built-in pull-through mirror (one `registry:2`
 * per MIRROR_REGISTRIES entry). Returns the `registry=ref;...` mapping the
 * buildkitd entrypoint turns into `[registry."<x>"]` blocks. Best-effort per
 * mirror — a registry whose mirror fails to come up is dropped from the mapping
 * (its base images then aren't pullable, but the others still work).
 */
async function ensureBuildkitdMirrors(cfg: SpawnerConfig): Promise<string> {
  const pairs: string[] = [];
  for (const registry of MIRROR_REGISTRIES) {
    try {
      await ensureOneMirror(cfg, registry);
      pairs.push(`${registry}=${buildkitdMirrorRef(registry)}`);
    } catch (err) {
      console.warn(
        `[sandbox.buildkitd] mirror for ${registry} unavailable; ` +
          `${registry} base images won't be pullable in builds:`,
        err,
      );
    }
  }
  return pairs.join(';');
}

async function ensureOneMirror(
  cfg: SpawnerConfig,
  registry: string,
): Promise<void> {
  const name = buildkitdMirrorContainerName(registry);
  const existing = mirrorInFlight.get(name);
  if (existing) return existing;
  const work = ensureOneMirrorUnlocked(cfg, registry, name).finally(() => {
    mirrorInFlight.delete(name);
  });
  mirrorInFlight.set(name, work);
  return work;
}

async function ensureOneMirrorUnlocked(
  cfg: SpawnerConfig,
  registry: string,
  name: string,
): Promise<void> {
  const inspect = await runDocker([
    'inspect',
    '-f',
    '{{.State.Running}}',
    name,
  ]);
  if (inspect.exitCode === 0) {
    if (inspect.stdout.trim() === 'true') return;
    const rm = await runDocker(['rm', '-f', name]);
    if (rm.exitCode !== 0) {
      console.warn(
        `[sandbox.buildkitd] could not reap dead mirror ${name}: ${rm.stderr.trim()}`,
      );
    }
  }

  const volume = buildkitdMirrorVolumeName(registry);
  const vol = await runDocker([
    'volume',
    'create',
    '--label',
    'tale.buildkitd=1',
    volume,
  ]);
  if (vol.exitCode !== 0 && !/already exists/i.test(vol.stderr)) {
    throw new Error(
      `buildkitd: failed to create mirror cache volume ${volume}: ${vol.stderr.trim()}`,
    );
  }

  const run = await runDocker(
    [
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'tale.buildkitd=1',
      '--restart',
      'unless-stopped',
      // On the sandbox network so buildkit reaches it by name; it pulls upstream
      // through the egress proxy (so the mirror itself needs no external DNS).
      '--network',
      cfg.egressNetwork,
      '--env',
      `REGISTRY_PROXY_REMOTEURL=${mirrorUpstream(registry)}`,
      '--env',
      `HTTPS_PROXY=${cfg.egressProxy}`,
      '--env',
      `HTTP_PROXY=${cfg.egressProxy}`,
      '--env',
      'NO_PROXY=127.0.0.1,localhost',
      '--mount',
      `type=volume,src=${volume},dst=/var/lib/registry`,
      cfg.buildkitdMirrorImage,
    ],
    { timeoutMs: 30_000 },
  );
  if (run.exitCode !== 0) {
    if (/already in use|already exists/i.test(run.stderr)) return;
    throw new Error(
      `buildkitd: failed to launch mirror ${name}: ${run.stderr.trim() || run.stdout.trim()}`,
    );
  }
}

/**
 * Lazy, idempotent launch of the shared buildkitd; returns the endpoint a
 * session's remote buildx builder should target. An already-running daemon is
 * detected via `docker inspect` and reused (its persistent cache volume
 * survives spawner + daemon restarts). Throws on a hard launch failure — the
 * caller (docker-session-backend) treats the shared cache as an optimization
 * and proceeds without it on error, never failing session creation.
 */
export async function ensureBuildkitd(
  cfg: SpawnerConfig,
  organizationId: string,
): Promise<string> {
  const name = buildkitdContainerName(organizationId);
  const existing = ensureInFlight.get(name);
  if (existing) return existing;
  const work = ensureBuildkitdUnlocked(cfg, organizationId, name).finally(
    () => {
      ensureInFlight.delete(name);
    },
  );
  ensureInFlight.set(name, work);
  return work;
}

/**
 * Is a RUNNING buildkitd's egress fence actually installed? The entrypoint writes
 * EGRESS_READY_MARKER only after redsocks + the default route + the current-IP
 * [dns] block are in place. Absent ⇒ the daemon restarted while sandbox-egress
 * was unreachable and is serving builds with no internet — so we recreate it
 * rather than reuse it. Best-effort: a probe error is treated as healthy so a
 * transient `docker exec` hiccup never needlessly tears down a working daemon.
 */
async function buildkitdEgressHealthy(name: string): Promise<boolean> {
  const probe = await runDocker(
    ['exec', name, 'test', '-f', EGRESS_READY_MARKER],
    {
      timeoutMs: 5_000,
    },
  );
  // exit 0 = present (healthy); exit 1 = absent (broken). Other codes (exec
  // failure) → assume healthy to avoid tearing down a daemon over a probe glitch.
  return probe.exitCode !== 1;
}

async function ensureBuildkitdUnlocked(
  cfg: SpawnerConfig,
  organizationId: string,
  name: string,
): Promise<string> {
  const endpoint = buildkitdEndpoint(organizationId);

  // Already running? Reuse it ONLY if its egress fence is still installed. A
  // daemon that restarted (--restart unless-stopped) while sandbox-egress was
  // unreachable comes up with no fence and silently serves builds with no
  // internet (RUN steps fail to resolve any external host) — recreate it.
  const inspect = await runDocker([
    'inspect',
    '-f',
    '{{.State.Running}}',
    name,
  ]);
  if (inspect.exitCode === 0) {
    if (inspect.stdout.trim() === 'true') {
      if (await buildkitdEgressHealthy(name)) return endpoint;
      console.warn(
        `[sandbox.buildkitd] ${name} is running but its egress fence is missing ` +
          `(likely restarted while sandbox-egress was unreachable); recreating so ` +
          `build RUN steps regain internet. The persistent cache volume is preserved.`,
      );
    }
    // Stopped/dead OR running-but-egress-broken: reap it so the `run --name`
    // below recreates it. The cache lives in the volume, not the container, so
    // nothing is lost.
    const rm = await runDocker(['rm', '-f', name]);
    if (rm.exitCode !== 0) {
      console.warn(
        `[sandbox.buildkitd] could not reap container ${name}: ${rm.stderr.trim()}`,
      );
    }
  }

  // Persistent cache volume. Owned solely by the root buildkitd daemon, so —
  // unlike the per-org dep caches (shared by two uids, hence 1777) — it needs no
  // perms fix; just ensure it exists.
  const volume = buildkitdCacheVolumeName(organizationId);
  const vol = await runDocker([
    'volume',
    'create',
    '--label',
    'tale.buildkitd=1',
    volume,
  ]);
  if (vol.exitCode !== 0 && !/already exists/i.test(vol.stderr)) {
    throw new Error(
      `buildkitd: failed to create cache volume ${volume}: ${vol.stderr.trim() || vol.stdout.trim()}`,
    );
  }

  // Bring up the pull-through mirrors first (buildkit pulls base images from them
  // by name, sidestepping its broken external-name DNS — see MIRROR_REGISTRIES).
  const mirrors = await ensureBuildkitdMirrors(cfg);

  const run = await runDocker(
    [
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'tale.buildkitd=1',
      // Long-lived shared infra: survive a daemon crash + host docker restart.
      '--restart',
      'unless-stopped',
      // On the internal sandbox network so sessions reach it by name and its
      // RUN-step egress goes through the dual-homed sandbox-egress proxy.
      '--network',
      cfg.egressNetwork,
      // buildkitd needs mount/namespace ops to run builds. This is a host-level
      // shared build daemon with no isolation boundary by design; build RUN
      // egress is fenced through the egress proxy by the image entrypoint.
      // nosemgrep: tools.opengrep.rules.trailofbits.generic.container-privileged.container-privileged -- intentional: buildkitd requires privileged to run builds; this is host-level shared infra (not user-code), egress-fenced via sandbox-egress
      '--privileged',
      '--mount',
      `type=volume,src=${volume},dst=/var/lib/buildkit`,
      // The image entrypoint resolves the egress proxy from HTTP(S)_PROXY (a
      // sibling name, which the embedded resolver answers) to set up redsocks +
      // [dns]; and writes one [registry] mirror block per TALE_BUILDKITD_MIRRORS
      // `registry=ref` pair.
      '--env',
      `TALE_BUILDKITD_MIRRORS=${mirrors}`,
      '--env',
      `HTTPS_PROXY=${cfg.egressProxy}`,
      '--env',
      `HTTP_PROXY=${cfg.egressProxy}`,
      cfg.buildkitdImage,
    ],
    { timeoutMs: 30_000 },
  );
  if (run.exitCode !== 0) {
    // Racy across spawner replicas / restarts: a peer may have created it
    // between our inspect and our run. Treat a name conflict as success.
    if (/already in use|already exists/i.test(run.stderr)) return endpoint;
    throw new Error(
      `buildkitd: failed to launch ${name}: ${run.stderr.trim() || run.stdout.trim()}`,
    );
  }
  return endpoint;
}
