/**
 * What a process holds that the kernel cannot take back: its anonymous
 * memory and its shared memory. That is what a host's memory budget counts
 * (tale-project/tale#4942 reads the same two from each container's cgroup),
 * and what the heavy slot caps its child at.
 *
 * Linux only: the figures come from `/proc/<pid>/status`. Anywhere else the
 * read answers `null`, and the child is bounded by its V8 heap limit alone.
 */

import { readFileSync } from 'node:fs';

const KIB = 1024;

function field(status: string, name: string): number {
  const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(status);
  return match === null ? 0 : Number(match[1]) * KIB;
}

/**
 * The counted memory in a `/proc/<pid>/status` text, in bytes: `RssAnon`
 * plus `RssShmem`. A kernel thread, or a process that has gone, names
 * neither and counts 0.
 */
export function countedMemoryOf(status: string): number {
  return field(status, 'RssAnon') + field(status, 'RssShmem');
}

/**
 * The counted memory of a running process, in bytes; `null` where it cannot
 * be read: the process is gone, or this is not Linux.
 */
export function readCountedMemory(pid: number): number | null {
  try {
    return countedMemoryOf(readFileSync(`/proc/${pid}/status`, 'utf8'));
  } catch {
    // Gone between two samples, or no /proc here: nothing to count.
    return null;
  }
}
