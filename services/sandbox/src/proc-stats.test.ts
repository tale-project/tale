import { expect, test } from 'bun:test';

import {
  parseCpuCounters,
  parseLoadAverage,
  parseMemory,
  parseOnlineCpus,
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

test('memory and I/O pressure read the same way, their "full" line ignored', () => {
  const file = (some: string) =>
    `some avg10=${some} avg60=2.00 avg300=1.00 total=88\nfull avg10=99.00 avg60=0.00 avg300=0.00 total=0\n`;
  expect(parsePressureSomeAvg10(file('1.25'))).toBe(1.25);
  expect(parsePressureSomeAvg10(file('0.00'))).toBe(0);
});

test('the load average is the first field of /proc/loadavg', () => {
  expect(parseLoadAverage('0.52 0.58 0.59 1/468 12345\n')).toBe(0.52);
  expect(parseLoadAverage('94.10 60.00 30.00 12/900 777\n')).toBe(94.1);
  expect(parseLoadAverage('3')).toBe(3);
  expect(parseLoadAverage('')).toBeNull();
  expect(parseLoadAverage('busy 1 2')).toBeNull();
  expect(parseLoadAverage('-1 0 0 1/1 1')).toBeNull();
});

test('the online CPUs are counted from the range list', () => {
  expect(parseOnlineCpus('0-3\n')).toBe(4);
  expect(parseOnlineCpus('0-3,6')).toBe(5);
  expect(parseOnlineCpus('0,2,4-5\n')).toBe(4);
  expect(parseOnlineCpus('7')).toBe(1);
  for (const broken of ['', '\n', '3-1', '0-', 'a-b', '0-3,,4', '1.5']) {
    expect(parseOnlineCpus(broken)).toBeNull();
  }
});
