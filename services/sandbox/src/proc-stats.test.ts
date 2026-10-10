import { expect, test } from 'bun:test';

import {
  parseCpuCounters,
  parseMemory,
  parsePressureSomeAvg10,
  usedCpuCores,
} from './proc-stats.ts';

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

test('CPU pressure is the some avg10 of /proc/pressure/cpu', () => {
  expect(
    parsePressureSomeAvg10(
      'some avg10=61.25 avg60=12.00 avg300=3.00 total=1234\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    ),
  ).toBe(61.25);
  // Older kernels report no "full" line for the CPU.
  expect(
    parsePressureSomeAvg10('some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n'),
  ).toBe(0);
  expect(
    parsePressureSomeAvg10('full avg10=50.00 avg60=0.00 avg300=0.00 total=0\n'),
  ).toBeNull();
  expect(parsePressureSomeAvg10('')).toBeNull();
  expect(
    parsePressureSomeAvg10('some avg10=170.00 avg60=0 avg300=0 total=0\n'),
  ).toBeNull();
});
