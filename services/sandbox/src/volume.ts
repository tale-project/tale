// Per-org cache volume helpers + post-run output harvest.
//
// Per-org pip/npm caches are persistent named volumes scoped to organizationId
// (R2.3 — closes the cross-tenant wheel-cache poison vector). The runtime
// container itself uses a `--tmpfs /workspace` for the workspace, so there is
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

/**
 * Lazy idempotent create. New volumes are root-owned by default and the
 * runtime container runs as nobody (65534), so on first creation we also
 * spin up a transient busybox to chown the volume's root to 65534:65534.
 * Subsequent calls are no-ops (we detect via `docker volume inspect`).
 */
export async function ensureCacheVolume(name: string): Promise<void> {
  const inspect = await runDocker(['volume', 'inspect', name]);
  if (inspect.exitCode === 0) return; // already exists, already chowned

  const create = await runDocker([
    'volume',
    'create',
    '--label',
    'tale.sandbox-cache=1',
    name,
  ]);
  if (create.exitCode !== 0) {
    throw new Error(
      `volume: failed to create cache volume ${name}: ${create.stderr.trim() || create.stdout.trim()}`,
    );
  }

  // One-shot chown so the unprivileged runtime user can write to the cache.
  const chown = await runDocker([
    'run',
    '--rm',
    '--user',
    '0:0',
    '--label',
    'tale.sandbox-staging=1',
    '--mount',
    `type=volume,src=${name},dst=/cache`,
    'busybox:1.36',
    'chown',
    '65534:65534',
    '/cache',
  ]);
  if (chown.exitCode !== 0) {
    throw new Error(
      `volume: failed to chown cache volume ${name}: ${chown.stderr.trim()}`,
    );
  }
}
