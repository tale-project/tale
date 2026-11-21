import { describe, expect, it } from 'vitest';

import { countedMemoryOf, readCountedMemory } from './memory.ts';

const STATUS = `Name:\tnode
Umask:\t0022
State:\tS (sleeping)
Pid:\t4242
VmPeak:\t 1184116 kB
VmRSS:\t   93212 kB
RssAnon:\t   46100 kB
RssFile:\t   47000 kB
RssShmem:\t     112 kB
VmData:\t  162240 kB
Threads:\t11
`;

describe('countedMemoryOf', () => {
  it('counts the anonymous and the shared memory, and not the file pages', () => {
    expect(countedMemoryOf(STATUS)).toBe((46100 + 112) * 1024);
  });

  it('counts nothing for a process that names neither', () => {
    // A kernel thread has no address space, and its status no Rss lines.
    expect(countedMemoryOf('Name:\tkthreadd\nPid:\t2\nThreads:\t1\n')).toBe(0);
  });

  it('is not misled by a field whose name ends the same way', () => {
    expect(countedMemoryOf('NotRssAnon:\t   999 kB\nRssAnon:\t   8 kB\n')).toBe(
      8 * 1024,
    );
  });
});

describe('readCountedMemory', () => {
  it.runIf(process.platform === 'linux')(
    'reads what this process holds',
    () => {
      const held = readCountedMemory(process.pid);
      // A test runner holds tens of megabytes, and not tens of gigabytes.
      expect(held).toBeGreaterThan(1024 * 1024);
      expect(held).toBeLessThan(64 * 1024 * 1024 * 1024);
    },
  );

  it('answers null for a process that is not there', () => {
    // Above any process id a kernel hands out.
    expect(readCountedMemory(2 ** 30)).toBeNull();
  });
});
