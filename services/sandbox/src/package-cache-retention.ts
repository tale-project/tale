// How long an organization's package caches outlive their last use.
//
// Every Docker session without Docker inside mounts its organization's pip,
// npm and bun cache volumes (volume.ts). None of those tools evicts on its
// own, so a cache only grows: one CUDA wheel set alone is 2-3 GB, and an
// organization that stopped using its sandboxes months ago kept all of it
// until the organization was deleted. Each create that mounts the caches
// records the moment under the session root, beside the pin and owner
// markers (`.package-caches/<organization>.used`); the host sweep removes an
// organization's three volumes once no session container of the organization
// exists and that moment is older than the retention: 14 days, as for the
// stopped build caches, unless SANDBOX_PACKAGE_CACHE_RETENTION says
// otherwise. The organization's next session starts with empty caches and
// fills them again.
//
// A create holds a use of its organization's caches from before it ensures
// them until its container exists or it gave up. No removal starts while a
// use is held, and a create that comes during a removal waits for it, so a
// create never mounts a volume half removed. Docker refuses to remove a
// volume a container mounts, a second safety net.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readDockerMetadata } from './buildkit-resources.ts';
import type { SpawnerConfig } from './types.ts';
import { listCacheVolumeOrganizations, removeCacheVolumes } from './volume.ts';
import { ORG_ID_ALPHABET_RE } from './wire.ts';

/** How long an organization's package caches outlive their last use unless
 * SANDBOX_PACKAGE_CACHE_RETENTION says otherwise: the stopped build caches'
 * default (buildkitd.ts). */
export const DEFAULT_PACKAGE_CACHE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** How often the host sweep looks at the caches: a retention counts in days,
 * and each look costs two docker CLI calls. */
export const PACKAGE_CACHE_SWEEP_INTERVAL_MS = 60 * 60_000;

const MARKER_DIR = '.package-caches';
const MARKER_SUFFIX = '.used';

/** Creates holding an organization's caches, by organization. */
const uses = new Map<string, number>();
/** The removal of an organization's caches under way, by organization;
 * never rejects. */
const removals = new Map<string, Promise<void>>();

type RetentionConfig = Pick<
  SpawnerConfig,
  'hostSessionRoot' | 'cacheVolumePrefix' | 'packageCacheRetentionMs'
>;

function markerPath(
  cfg: Pick<SpawnerConfig, 'hostSessionRoot'>,
  organizationId: string,
): string {
  if (!ORG_ID_ALPHABET_RE.test(organizationId)) {
    throw new Error(
      `package caches: refusing unsafe organizationId for a marker: ${JSON.stringify(organizationId)}`,
    );
  }
  return join(
    cfg.hostSessionRoot,
    MARKER_DIR,
    `${organizationId}${MARKER_SUFFIX}`,
  );
}

/** Record that the organization's caches were in use at `nowMs`. Best
 * effort: a marker that cannot be written leaves an older one, or none,
 * which the sweep then writes itself before anything can go. */
async function recordUse(
  cfg: Pick<SpawnerConfig, 'hostSessionRoot'>,
  organizationId: string,
  nowMs: number,
): Promise<void> {
  try {
    const path = markerPath(cfg, organizationId);
    await mkdir(join(cfg.hostSessionRoot, MARKER_DIR), { recursive: true });
    await writeFile(path, `${nowMs}\n`);
  } catch (err) {
    console.warn(
      `[sandbox.package-cache] recording the use of ${organizationId}'s package caches failed:`,
      err,
    );
  }
}

/** When the organization's caches were last in use, or undefined when no
 * marker says (or one that is not a time). THROWS when the marker cannot be
 * read, so nothing is judged on it. */
async function lastUse(
  cfg: Pick<SpawnerConfig, 'hostSessionRoot'>,
  organizationId: string,
): Promise<number | undefined> {
  let recorded: string;
  try {
    recorded = await readFile(markerPath(cfg, organizationId), 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
  const atMs = Number(recorded.trim());
  return Number.isSafeInteger(atMs) && atMs > 0 ? atMs : undefined;
}

/** The organizations with a session container on this daemon, in any state
 * and of any spawner instance: each may mount the caches. THROWS when the
 * list cannot be read, so a daemon hiccup never reads as "none". */
async function sessionOrganizations(
  organizationId?: string,
): Promise<Set<string>> {
  const listed = await readDockerMetadata(
    [
      'ps',
      '--all',
      '--no-trunc',
      '--filter',
      'label=tale.sandbox-session=1',
      ...(organizationId
        ? ['--filter', `label=tale.org=${organizationId}`]
        : []),
      '--format',
      '{{.Label "tale.org"}}',
    ],
    { timeoutMs: 15_000 },
  );
  if (listed.exitCode !== 0) {
    throw new Error(
      `package caches: cannot list session containers: ${listed.stderr.trim() || listed.stdout.trim()}`,
    );
  }
  return new Set(
    listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

/** A create's hold on its organization's caches. */
export interface PackageCacheUse {
  /** Settles once no removal of the organization's caches is under way and
   * this use is recorded; never rejects. */
  ready: Promise<void>;
  /** Give the hold back; a second call does nothing. */
  release: () => void;
}

/** Hold the organization's caches for a create that mounts them: taken at
 * once, so a removal not yet started never starts while it is held. Wait
 * for `ready` before ensuring the volumes, and release once the container
 * exists or the create gave up. */
export function holdPackageCaches(
  cfg: Pick<SpawnerConfig, 'hostSessionRoot'>,
  organizationId: string,
): PackageCacheUse {
  uses.set(organizationId, (uses.get(organizationId) ?? 0) + 1);
  const removal = removals.get(organizationId) ?? Promise.resolve();
  const ready = removal.then(() => recordUse(cfg, organizationId, Date.now()));
  let released = false;
  return {
    ready,
    release: () => {
      if (released) return;
      released = true;
      const remaining = (uses.get(organizationId) ?? 1) - 1;
      if (remaining > 0) uses.set(organizationId, remaining);
      else uses.delete(organizationId);
    },
  };
}

/** Remove the package caches no organization has used for the retention;
 * returns how many volumes went. An organization whose caches cannot be
 * judged or removed is logged and judged again next time; THROWS only when
 * the volumes or the session containers cannot be listed. */
export async function expirePackageCaches(
  cfg: RetentionConfig,
  nowMs = Date.now(),
): Promise<number> {
  const retentionMs =
    cfg.packageCacheRetentionMs ?? DEFAULT_PACKAGE_CACHE_RETENTION_MS;
  if (retentionMs <= 0) return 0;
  const organizations = await listCacheVolumeOrganizations(cfg);
  if (organizations.length === 0) {
    await forgetStaleMarkers(cfg, new Set(), retentionMs, nowMs);
    return 0;
  }
  const inUse = await sessionOrganizations();
  let removed = 0;
  for (const organizationId of organizations) {
    try {
      removed += await expireOrganization(
        cfg,
        organizationId,
        inUse.has(organizationId),
        retentionMs,
        nowMs,
      );
    } catch (err) {
      console.warn(
        `[sandbox.package-cache] expiring ${organizationId}'s package caches failed (the next sweep retries):`,
        err,
      );
    }
  }
  await forgetStaleMarkers(cfg, new Set(organizations), retentionMs, nowMs);
  return removed;
}

async function expireOrganization(
  cfg: RetentionConfig,
  organizationId: string,
  inUse: boolean,
  retentionMs: number,
  nowMs: number,
): Promise<number> {
  // A session that holds the caches is using them, however long it has run:
  // the retention counts from its end, not from its start.
  if (inUse) {
    await recordUse(cfg, organizationId, nowMs);
    return 0;
  }
  const lastUseMs = await lastUse(cfg, organizationId);
  if (lastUseMs === undefined) {
    // Caches from before their use was recorded (or a marker that is not a
    // time): the full retention counts from now.
    console.log(
      `[sandbox.package-cache] ${organizationId}'s package caches had no recorded use; counting the retention from now`,
    );
    await recordUse(cfg, organizationId, nowMs);
    return 0;
  }
  if (nowMs - lastUseMs < retentionMs) return 0;
  // From this check to the claim nothing awaits: a create either holds its
  // use already, and the caches stay, or comes later and waits for the
  // removal.
  if (uses.has(organizationId) || removals.has(organizationId)) return 0;
  const removal = removeUnused(cfg, organizationId, retentionMs, nowMs);
  const settled = removal.then(
    () => undefined,
    () => undefined,
  );
  removals.set(organizationId, settled);
  try {
    return await removal;
  } finally {
    if (removals.get(organizationId) === settled) {
      removals.delete(organizationId);
    }
  }
}

async function removeUnused(
  cfg: RetentionConfig,
  organizationId: string,
  retentionMs: number,
  nowMs: number,
): Promise<number> {
  // Judged again under the claim: a session that started since the sweep's
  // inventory, or a create that recorded its use meanwhile, keeps them.
  if ((await sessionOrganizations(organizationId)).has(organizationId)) {
    return 0;
  }
  const lastUseMs = await lastUse(cfg, organizationId);
  if (lastUseMs === undefined || nowMs - lastUseMs < retentionMs) return 0;
  // Forgets each volume's ensure memo, so the next create makes it again.
  const removed = await removeCacheVolumes(cfg, organizationId);
  await rm(markerPath(cfg, organizationId), { force: true });
  console.log(
    `[sandbox.package-cache] removed ${organizationId}'s package caches, unused since ${new Date(lastUseMs).toISOString()} (${removed} volumes); its next session starts with empty caches`,
  );
  return removed;
}

/** Remove the markers of organizations whose caches are gone (the
 * organization was deleted, or its volumes were pruned by hand) once they
 * are older than the retention. Best effort. */
async function forgetStaleMarkers(
  cfg: RetentionConfig,
  withCaches: ReadonlySet<string>,
  retentionMs: number,
  nowMs: number,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(join(cfg.hostSessionRoot, MARKER_DIR));
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
    console.warn(
      '[sandbox.package-cache] reading the package cache markers failed:',
      err,
    );
    return;
  }
  for (const name of names) {
    if (!name.endsWith(MARKER_SUFFIX)) continue;
    const organizationId = name.slice(0, -MARKER_SUFFIX.length);
    if (
      !ORG_ID_ALPHABET_RE.test(organizationId) ||
      withCaches.has(organizationId) ||
      uses.has(organizationId) ||
      removals.has(organizationId)
    ) {
      continue;
    }
    try {
      const lastUseMs = await lastUse(cfg, organizationId);
      if (lastUseMs !== undefined && nowMs - lastUseMs < retentionMs) continue;
      await rm(markerPath(cfg, organizationId), { force: true });
    } catch (err) {
      console.warn(
        `[sandbox.package-cache] removing ${organizationId}'s stale package cache marker failed:`,
        err,
      );
    }
  }
}

/** The host sweep's look at the package caches: at most once per
 * {@link PACKAGE_CACHE_SWEEP_INTERVAL_MS}, one at a time. Never rejects;
 * resolves to how many volumes went. */
export function makePackageCacheSweep(
  cfg: RetentionConfig,
): (nowMs?: number) => Promise<number> {
  let lastAtMs: number | undefined;
  let inFlight: Promise<number> | undefined;
  return (nowMs = Date.now()) => {
    if (inFlight !== undefined) return inFlight;
    if (
      lastAtMs !== undefined &&
      nowMs >= lastAtMs &&
      nowMs - lastAtMs < PACKAGE_CACHE_SWEEP_INTERVAL_MS
    ) {
      return Promise.resolve(0);
    }
    lastAtMs = nowMs;
    const sweep = expirePackageCaches(cfg, nowMs)
      .catch((err: unknown) => {
        console.warn(
          '[sandbox.package-cache] package cache sweep failed (the next sweep retries):',
          err,
        );
        return 0;
      })
      .finally(() => {
        inFlight = undefined;
      });
    inFlight = sweep;
    return sweep;
  };
}
