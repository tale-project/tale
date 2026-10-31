import { afterAll, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POOL_TIMEOUT_PATTERNS } from '../../src/burst/driver.ts';
import {
  parseMeminfo,
  parseOomKills,
  parseUptime,
  parseVmstatOomKills,
  scanLog,
  sizeOf,
} from '../../src/burst/probes.ts';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tale-load-burst-'));
  dirs.push(dir);
  return dir;
}

describe('parseMeminfo', () => {
  test('reads the total and the available memory in bytes', () => {
    const text = [
      'MemTotal:       16374596 kB',
      'MemFree:         1234567 kB',
      'MemAvailable:    9876543 kB',
      'Buffers:          123456 kB',
    ].join('\n');
    expect(parseMeminfo(text)).toEqual({
      totalBytes: 16_374_596 * 1024,
      availableBytes: 9_876_543 * 1024,
    });
  });

  test('is null without MemAvailable', () => {
    expect(parseMeminfo('MemTotal:       16374596 kB\n')).toBeNull();
  });
});

describe('parseVmstatOomKills and parseUptime', () => {
  test('read the OOM kill count and the seconds since boot', () => {
    expect(parseVmstatOomKills('pgfault 991\noom_kill 3\npgmajfault 2\n')).toBe(
      3,
    );
    expect(parseVmstatOomKills('pgfault 991\n')).toBeNull();
    expect(parseUptime('12345.67 45678.90\n')).toBe(12_345.67);
    expect(parseUptime('')).toBeNull();
  });
});

describe('parseOomKills', () => {
  test('tells a session cgroup kill from a host-wide one', () => {
    const log = [
      '[  100.123456] python3 invoked oom-killer: gfp_mask=0xcc0(GFP_KERNEL), order=0, oom_score_adj=0',
      '[  100.123500] Memory cgroup out of memory: Killed process 4242 (python3) total-vm:2200000kB, anon-rss:2097152kB, file-rss:0kB, shmem-rss:0kB, UID:1000 pgtables:4200kB oom_score_adj:0',
      '[  200.000001] Out of memory: Killed process 777 (node) total-vm:1234kB, anon-rss:1000kB',
      '[  300.500000] oom_reaper: reaped process 777 (node), now anon-rss:0kB',
    ].join('\n');
    expect(parseOomKills(log)).toEqual([
      {
        atSeconds: 100.1235,
        scope: 'cgroup',
        pid: 4242,
        process: 'python3',
        line: expect.stringContaining('Memory cgroup out of memory'),
      },
      {
        atSeconds: 200.000001,
        scope: 'host',
        pid: 777,
        process: 'node',
        line: expect.stringContaining('Out of memory: Killed process 777'),
      },
    ]);
  });

  test('finds none in a quiet log', () => {
    expect(parseOomKills('[    0.000000] Linux version 6.8.0\n')).toEqual([]);
  });
});

describe('scanLog', () => {
  test('counts only what was written after the offset', async () => {
    const path = join(await tempDir(), 'api-0.log');
    await writeFile(
      path,
      'boot: timeout exceeded when trying to connect (before the burst)\n',
    );
    const offset = await sizeOf(path);
    await appendFile(
      path,
      [
        '{"level":"info","msg":"ready"}',
        '{"level":"error","msg":"timeout exceeded when trying to connect"}',
        'Error: write CONNECT_TIMEOUT 127.0.0.1:5432',
        `{"msg":"Connection terminated due to connection timeout","pad":"${'x'.repeat(600)}"}`,
        '',
      ].join('\n'),
    );
    const scan = await scanLog(path, offset, POOL_TIMEOUT_PATTERNS, 2);
    expect(scan.counts).toEqual({
      'pool connect timeout': 1,
      CONNECT_TIMEOUT: 1,
      'connection timeout': 1,
    });
    expect(scan.examples).toHaveLength(2);
    expect(scan.examples[0]).toContain('timeout exceeded');
    expect(
      (await scanLog(path, offset, POOL_TIMEOUT_PATTERNS)).examples[2]?.length,
    ).toBe(400);
  });

  test('reads a missing log as empty', async () => {
    const path = join(await tempDir(), 'worker-0.log');
    expect(await sizeOf(path)).toBe(0);
    const scan = await scanLog(path, 0, POOL_TIMEOUT_PATTERNS);
    expect(Object.values(scan.counts)).toEqual([0, 0, 0]);
    expect(scan.examples).toEqual([]);
  });
});
