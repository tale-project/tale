// Per-org cache volume helpers + post-run output harvest.
//
// Per-org pip/npm caches are persistent named volumes scoped to organizationId
// (R2.3 — closes the cross-tenant wheel-cache poison vector). The runtime
// container itself uses a `--tmpfs /agent` for the workspace, so there is
// no per-call workspace volume to manage.

import { runDocker } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

const ORG_SLUG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function orgSlug(organizationId: string): string {
  if (!ORG_SLUG_RE.test(organizationId)) {
    throw new Error(
      `volume: refusing unsafe organizationId for volume name: ${JSON.stringify(organizationId)}`,
    );
  }
  return organizationId;
}

export function pipCacheVolumeName(
  cfg: SpawnerConfig,
  organizationId: string,
): string {
  return `${cfg.cacheVolumePrefix.pip}-${orgSlug(organizationId)}`;
}

export function npmCacheVolumeName(
  cfg: SpawnerConfig,
  organizationId: string,
): string {
  return `${cfg.cacheVolumePrefix.npm}-${orgSlug(organizationId)}`;
}

export function bunCacheVolumeName(
  cfg: SpawnerConfig,
  organizationId: string,
): string {
  return `${cfg.cacheVolumePrefix.bun}-${orgSlug(organizationId)}`;
}

const CACHE_LABEL = 'tale.sandbox-cache';

/** Whether a volume under a cache name is missing, the spawner's (it carries
 * the cache label), or one the spawner did not make: Docker creates a volume
 * a `--mount` names when it is missing, without a label. THROWS when the
 * daemon cannot say. */
async function cacheVolumeLabel(
  name: string,
): Promise<'missing' | 'labelled' | 'unlabelled'> {
  const inspected = await runDocker(
    ['volume', 'inspect', '--format', '{{json .Labels}}', name],
    { timeoutMs: 15_000 },
  );
  if (inspected.exitCode !== 0) {
    if (/no such volume/i.test(inspected.stderr)) return 'missing';
    throw new Error(
      `volume: cannot inspect ${name}: ${inspected.stderr.trim()}`,
    );
  }
  const labels: unknown = JSON.parse(inspected.stdout.trim() || 'null');
  return labels !== null &&
    typeof labels === 'object' &&
    Reflect.get(labels, CACHE_LABEL) === '1'
    ? 'labelled'
    : 'unlabelled';
}

/** The organizations holding a package cache volume on this daemon, read
 * off the cache label and the configured name prefixes (the longest prefix
 * wins, so one prefix extending another never misreads an id). THROWS when
 * the volume list cannot be read. */
export async function listCacheVolumeOrganizations(
  cfg: SpawnerConfig,
): Promise<string[]> {
  const listed = await runDocker(
    [
      'volume',
      'ls',
      '--filter',
      `label=${CACHE_LABEL}=1`,
      '--format',
      '{{.Name}}',
    ],
    { timeoutMs: 15_000 },
  );
  if (listed.exitCode !== 0) {
    throw new Error(
      `volume: cannot list cache volumes: ${listed.stderr.trim() || listed.stdout.trim()}`,
    );
  }
  const prefixes = [
    cfg.cacheVolumePrefix.pip,
    cfg.cacheVolumePrefix.npm,
    cfg.cacheVolumePrefix.bun,
  ].sort((a, b) => b.length - a.length);
  const organizations = new Set<string>();
  for (const line of listed.stdout.split('\n')) {
    const name = line.trim();
    const prefix = prefixes.find((p) => name.startsWith(`${p}-`));
    if (prefix === undefined) continue;
    const organizationId = name.slice(prefix.length + 1);
    if (ORG_SLUG_RE.test(organizationId)) organizations.add(organizationId);
  }
  return [...organizations];
}

/** Remove an organization's package caches once it no longer exists. A
 * volume under a cache name that does not carry the cache label is not the
 * spawner's and is refused; a missing one is already gone. Returns how many
 * were removed; THROWS when one could not be (still mounted, a daemon
 * hiccup), so the caller retries. */
export async function removeCacheVolumes(
  cfg: SpawnerConfig,
  organizationId: string,
): Promise<number> {
  let removed = 0;
  for (const name of [
    pipCacheVolumeName(cfg, organizationId),
    npmCacheVolumeName(cfg, organizationId),
    bunCacheVolumeName(cfg, organizationId),
  ]) {
    try {
      const label = await cacheVolumeLabel(name);
      if (label === 'missing') continue;
      if (label === 'unlabelled') {
        throw new Error(`volume: refusing to remove unlabelled volume ${name}`);
      }
      const rm = await runDocker(['volume', 'rm', name], {
        timeoutMs: 30_000,
      });
      if (rm.exitCode === 0) {
        removed += 1;
        continue;
      }
      if (/no such volume/i.test(rm.stderr)) continue;
      throw new Error(`volume: cannot remove ${name}: ${rm.stderr.trim()}`);
    } finally {
      // The next create of the organization asks the daemon again. Only now:
      // an ensure that ran during the removal found the volume still there.
      forgetCacheVolume(name);
    }
  }
  return removed;
}

// Coalesce concurrent ensureCacheVolume calls for the same volume name.
// Two parallel /v1/execute requests from the same org trigger this twice
// in quick succession; without a mutex, both race past the `volume inspect`
// gate, both run `volume create`, and the second wastes a chown + race.
// Storing the in-flight promise here lets the second caller await the
// first's settle instead of repeating the work.
const ensureInFlight = new Map<string, Promise<void>>();

/** How long a cache volume found or made ready is taken to still be: every
 * session create of the organization would otherwise ask the daemon again,
 * one docker CLI process per volume. A volume removed behind the spawner's
 * back meanwhile (a `docker volume prune` while none of the organization's
 * sessions ran) goes unnoticed: Docker makes it again for the next session's
 * `--mount`, unlabelled and root-owned at 0755, so the organization's
 * sessions cannot write that cache until the first check past this window
 * replaces it. */
const ENSURED_FOR_MS = 5 * 60_000;
/** When each cache volume was last found or made ready, by name. */
const ensuredAt = new Map<string, number>();
/** How many times a teardown has forgotten a volume: an ensure in flight
 * across one may have found its volume before the removal, so it does not
 * mark it ready. */
let forgotten = 0;

function forgetCacheVolume(name: string): void {
  ensuredAt.delete(name);
  forgotten += 1;
}

/**
 * Lazy idempotent create. New volumes are root-owned by default, but the
 * per-org cache is shared by BOTH session profiles — the one-shot default
 * profile (uid 65534) and the agent session profile (uid 10001) — so no single
 * owner works. On first creation we spin up a transient busybox to set the
 * volume root to 1777 (sticky, world-writable, like /tmp): every same-org
 * sandbox uid can write its own cache entries, and the sticky bit stops one uid
 * from deleting another's. The per-org volume is the isolation boundary (R2.3),
 * so intra-org world-write is acceptable. Subsequent calls find the cache
 * label (`docker volume inspect`) and do nothing more. A volume under the name
 * without the label is one Docker made for a session's `--mount`: it is
 * replaced, or made writable while a session still holds it.
 */
export async function ensureCacheVolume(
  name: string,
  nowMs = Date.now(),
): Promise<void> {
  const at = ensuredAt.get(name);
  if (at !== undefined && nowMs - at < ENSURED_FOR_MS && nowMs >= at) return;
  const existing = ensureInFlight.get(name);
  if (existing) return existing;
  const forgottenBefore = forgotten;
  const work = (async () => {
    try {
      await ensureCacheVolumeUnlocked(name);
      if (forgotten === forgottenBefore) ensuredAt.set(name, nowMs);
    } finally {
      ensureInFlight.delete(name);
    }
  })();
  ensureInFlight.set(name, work);
  return work;
}

async function ensureCacheVolumeUnlocked(name: string): Promise<void> {
  const label = await cacheVolumeLabel(name);
  if (label === 'labelled') return; // made below, its mode set
  if (label === 'unlabelled') {
    // Docker made it for a session's `--mount` while the spawner took it to
    // be ready (see ENSURED_FOR_MS): root-owned at 0755, which the sessions'
    // uids cannot write, and without the label the organization's teardown
    // looks for. A volume a session holds cannot be removed, only made
    // writable; a later check replaces it once it is free.
    const rm = await runDocker(['volume', 'rm', name], { timeoutMs: 30_000 });
    if (rm.exitCode !== 0 && !/no such volume/i.test(rm.stderr)) {
      await setCacheVolumeMode(name);
      console.warn(
        `[sandbox.volume] cache volume ${name} lacks the ${CACHE_LABEL} label and could not be replaced (${rm.stderr.trim()}); made it writable, and a later check replaces it once no session holds it`,
      );
      return;
    }
  }

  const create = await runDocker(
    ['volume', 'create', '--label', `${CACHE_LABEL}=1`, name],
    { timeoutMs: 15_000 },
  );
  if (create.exitCode !== 0) {
    // `volume create` is racey across processes/restarts: if another caller
    // (or a prior boot) created the volume between our inspect and our
    // create, the daemon can answer "volume already exists" with non-zero
    // exit. Carrying the label, that is the success state we wanted: skip
    // the chmod, the prior create ran it.
    const stderr = create.stderr.trim();
    if (
      /already exists/i.test(stderr) &&
      (await cacheVolumeLabel(name)) === 'labelled'
    ) {
      return;
    }
    throw new Error(
      `volume: failed to create cache volume ${name}: ${stderr || create.stdout.trim()}`,
    );
  }

  try {
    await setCacheVolumeMode(name);
  } catch (err) {
    // A labelled volume reads as ready: never leave one the sessions cannot
    // write. The next ensure makes it again.
    const rm = await runDocker(['volume', 'rm', name], { timeoutMs: 30_000 });
    if (rm.exitCode !== 0 && !/no such volume/i.test(rm.stderr)) {
      console.warn(
        `[sandbox.volume] cannot remove cache volume ${name} after setting its mode failed: ${rm.stderr.trim()}`,
      );
    }
    throw err;
  }
}

/** One-shot perms fix so EITHER profile's uid can write the shared cache.
 * 1777 (sticky world-writable) rather than a chown because the per-org volume
 * is shared by the one-shot uid 65534 and the agent-session uid 10001;
 * chowning to one would lock out the other. */
async function setCacheVolumeMode(name: string): Promise<void> {
  const perms = await runDocker(
    [
      'run',
      '--rm',
      '--user',
      '0:0',
      '--label',
      'tale.sandbox-staging=1',
      '--mount',
      `type=volume,src=${name},dst=/cache`,
      'busybox:1.36',
      'chmod',
      '1777',
      '/cache',
    ],
    {
      // Pulls busybox on first use; a generous bound, not a routine wait.
      timeoutMs: 120_000,
    },
  );
  if (perms.exitCode !== 0) {
    throw new Error(
      `volume: failed to set perms on cache volume ${name}: ${perms.stderr.trim()}`,
    );
  }
}
