/**
 * A cgroup v2 tree and a process table on disk, in a temporary directory:
 * enough for the budget's sampler to find a container's cgroup from its
 * process and read its `memory.stat`, as it would under `/sys/fs/cgroup`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CgroupLocator } from '../../src/budget/cgroup.ts';

/** A memory.stat's fields; the ones not given are 0. */
export interface StatFields {
  anon?: number;
  file?: number;
  shmem?: number;
  slab_unreclaimable?: number;
  kernel_stack?: number;
  pagetables?: number;
  sock?: number;
  /** Not counted: in the text to prove it is left out. */
  slab_reclaimable?: number;
  kernel?: number;
  percpu?: number;
}

/** The text of a cgroup v2 memory.stat, in the kernel's order. */
export function statText(fields: StatFields): string {
  const value = (name: keyof StatFields): number => fields[name] ?? 0;
  return [
    `anon ${value('anon')}`,
    `file ${value('file')}`,
    `kernel ${value('kernel')}`,
    `kernel_stack ${value('kernel_stack')}`,
    `pagetables ${value('pagetables')}`,
    'sec_pagetables 0',
    `percpu ${value('percpu')}`,
    `sock ${value('sock')}`,
    'vmalloc 0',
    `shmem ${value('shmem')}`,
    'zswap 0',
    'file_mapped 0',
    'inactive_anon 0',
    `slab_reclaimable ${value('slab_reclaimable')}`,
    `slab_unreclaimable ${value('slab_unreclaimable')}`,
    'pgfault 12345',
    '',
  ].join('\n');
}

export interface FakeTree {
  readonly locator: CgroupLocator;
  /** Write `memory.stat` at `path` under the cgroup root. */
  stat(path: string, fields: StatFields): void;
  /** Make `pid`'s `/proc/<pid>/cgroup` name `path`. */
  process(pid: number, path: string): void;
  /** Remove the cgroup at `path`, as the kernel does when it empties. */
  remove(path: string): void;
  close(): void;
}

export function fakeTree(): FakeTree {
  const base = mkdtempSync(join(tmpdir(), 'tale-load-cgroup-'));
  const root = join(base, 'cgroup');
  const proc = join(base, 'proc');
  mkdirSync(root, { recursive: true });
  mkdirSync(proc, { recursive: true });
  writeFileSync(join(root, 'cgroup.controllers'), 'cpu memory pids\n');
  return {
    locator: { root, proc },
    stat(path, fields) {
      const dir = join(root, path);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'memory.stat'), statText(fields));
    },
    process(pid, path) {
      mkdirSync(join(proc, String(pid)), { recursive: true });
      writeFileSync(join(proc, String(pid), 'cgroup'), `0::${path}\n`);
    },
    remove(path) {
      rmSync(join(root, path), { recursive: true, force: true });
    },
    close() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}
