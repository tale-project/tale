import { expect, test } from 'bun:test';

import { parseCpuCounters, parseMemory, usedCpuCores } from './proc-stats.ts';

test('CPU counter parsing ignores already-accounted guest time and handles resets', () => {
  const parsed = parseCpuCounters(
    'cpu 10 10 10 70 10 0 0 0 100 100\ncpu0 1 1 1 1\n',
  );
  expect(parsed).toEqual({ total: 110, idle: 80, cores: 1 });
  expect(usedCpuCores({ total: 120, idle: 90, cores: 1 }, parsed!)).toBeNull();
  expect(parseCpuCounters('cpu broken')).toBeNull();
});

test('memory pressure uses MemAvailable, including genuinely zero available bytes', () => {
  expect(parseMemory('MemTotal: 1000 kB\nMemAvailable: 0 kB\n')).toEqual({
    totalBytes: 1024_000,
    usedBytes: 1024_000,
  });
  expect(parseMemory('MemTotal: 1000 kB\nMemFree: 0 kB\n')).toBeNull();
  expect(parseMemory('MemTotal: 1000 kB\nMemAvailable: 2000 kB\n')).toBeNull();
});
