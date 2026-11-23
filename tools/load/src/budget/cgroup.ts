/**
 * The budget's reading of one cgroup: its cgroup v2 `memory.stat`, and where
 * a container's cgroup is.
 *
 * A container's cgroup is found from its main process, as the kernel names
 * it in `/proc/<pid>/cgroup` (`0::/system.slice/docker-<id>.scope` under
 * Docker's systemd driver, `0::/docker/<id>` under its cgroupfs driver), and
 * narrowed to the segment that names the container: a process that moved
 * into a child cgroup of its container still reads its whole container. A
 * path that names no container is not taken. Where `/proc` cannot answer,
 * the drivers' conventional paths are tried. `memory.stat` is hierarchical,
 * so a container's figure covers every cgroup below it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COUNTED_FIELDS,
  type CountedField,
  PAGE_CACHE_FIELD,
} from './limits.ts';

export interface MemoryReading {
  /** The counted fields, summed: the budget's reading. */
  readonly counted: number;
  /** The page cache, reported beside it. */
  readonly file: number;
  /** Each counted field. */
  readonly fields: Readonly<Record<CountedField, number>>;
}

/**
 * The budget's reading of a `memory.stat`, or null when the text lacks a
 * counted field or `file` (not a cgroup v2 memory controller's file).
 */
export function parseMemoryStat(text: string): MemoryReading | null {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const value = Number(line.slice(space + 1).trim());
    if (Number.isFinite(value)) values.set(line.slice(0, space), value);
  }
  const fields = {} as Record<CountedField, number>;
  let counted = 0;
  for (const field of COUNTED_FIELDS) {
    const value = values.get(field);
    if (value === undefined) return null;
    fields[field] = value;
    counted += value;
  }
  const file = values.get(PAGE_CACHE_FIELD);
  if (file === undefined) return null;
  return { counted, file, fields };
}

/**
 * The cgroup v2 path in a `/proc/<pid>/cgroup` text (its `0::` line), or
 * null when the process is in no unified hierarchy.
 */
export function unifiedCgroupPath(procCgroup: string): string | null {
  for (const line of procCgroup.split('\n')) {
    if (!line.startsWith('0::')) continue;
    const path = line.slice(3).trim();
    return path.startsWith('/') ? path : null;
  }
  return null;
}

/**
 * The container's own cgroup within a process's: the path up to the deepest
 * segment that names the container id (`docker-<id>.scope`, `<id>`), or null
 * when no segment does. Such a process is not in its container's cgroup: a
 * rootless engine's or a cgroup namespace's view, a cgroup shared by several
 * containers, or a pid another process took since the listing. Read, that
 * cgroup would be counted as this container's, and once per container that
 * landed there.
 */
export function containerCgroupPath(
  path: string,
  containerId: string,
): string | null {
  if (containerId === '') return null;
  const segments = path.split('/');
  for (let index = segments.length - 1; index > 0; index -= 1) {
    if ((segments[index] ?? '').includes(containerId)) {
      return segments.slice(0, index + 1).join('/');
    }
  }
  return null;
}

export type CgroupDriver = 'systemd' | 'cgroupfs';

/**
 * Where Docker puts a container's cgroup by default, the engine's own
 * driver first: `system.slice/docker-<id>.scope` (systemd) and
 * `docker/<id>` (cgroupfs).
 */
export function conventionalCgroupPaths(
  containerId: string,
  driver: string | null,
): { path: string; via: CgroupDriver }[] {
  const systemd = {
    path: `/system.slice/docker-${containerId}.scope`,
    via: 'systemd' as const,
  };
  const cgroupfs = { path: `/docker/${containerId}`, via: 'cgroupfs' as const };
  return driver === 'cgroupfs' ? [cgroupfs, systemd] : [systemd, cgroupfs];
}

/** Where the readings come from: the cgroup root and the process table. */
export interface CgroupLocator {
  /** The cgroup v2 mount, `/sys/fs/cgroup`. */
  readonly root: string;
  /** The process table, `/proc`. */
  readonly proc: string;
}

export const HOST_LOCATOR: CgroupLocator = {
  root: '/sys/fs/cgroup',
  proc: '/proc',
};

/** Whether `root` is a cgroup v2 (unified) mount. */
export function isUnifiedHierarchy(root: string): boolean {
  return existsSync(join(root, 'cgroup.controllers'));
}

export interface ResolvedCgroup {
  /** The cgroup's directory, under the locator's root. */
  readonly dir: string;
  /** How it was found. */
  readonly via: 'proc' | CgroupDriver;
}

/**
 * The directory of a container's cgroup, or null when neither its process
 * nor a conventional path leads to one holding a `memory.stat`. The
 * process's cgroup counts only where its path names the container; else the
 * conventional paths, which always do, are the only candidates.
 */
export function resolveContainerCgroup(
  locator: CgroupLocator,
  container: { id: string; pid: number; driver: string | null },
): ResolvedCgroup | null {
  const candidates: { path: string; via: ResolvedCgroup['via'] }[] = [];
  if (container.pid > 0) {
    let text: string | null = null;
    try {
      text = readFileSync(
        join(locator.proc, String(container.pid), 'cgroup'),
        'utf8',
      );
    } catch (error) {
      // Its process is gone, or another pid namespace's: the conventional
      // paths below still find it.
      console.warn(
        `[budget] cannot read the cgroup of process ${container.pid}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const path = text === null ? null : unifiedCgroupPath(text);
    const own = path === null ? null : containerCgroupPath(path, container.id);
    if (own !== null) candidates.push({ path: own, via: 'proc' });
    else if (path !== null) {
      console.warn(
        `[budget] process ${container.pid} is in ${path}, which names no container ${container.id.slice(0, 12)}: only the engine's conventional paths are tried`,
      );
    }
  }
  candidates.push(...conventionalCgroupPaths(container.id, container.driver));
  for (const candidate of candidates) {
    const dir = join(locator.root, candidate.path);
    if (existsSync(join(dir, 'memory.stat'))) {
      return { dir, via: candidate.via };
    }
  }
  return null;
}

/** Read and parse a cgroup's `memory.stat`; throws what the read throws. */
export function readMemoryStat(dir: string): MemoryReading {
  const reading = parseMemoryStat(
    readFileSync(join(dir, 'memory.stat'), 'utf8'),
  );
  if (reading === null) {
    throw new Error(
      `${join(dir, 'memory.stat')} lacks a counted field or ${PAGE_CACHE_FIELD}`,
    );
  }
  return reading;
}
