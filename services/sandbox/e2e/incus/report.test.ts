import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatDuration, Report } from './report.ts';

describe('formatDuration', () => {
  test('milliseconds, seconds, minutes', () => {
    expect(formatDuration(42.4)).toBe('42 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1_500)).toBe('1.5 s');
    expect(formatDuration(119_000)).toBe('119.0 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
  });
});

describe('Report', () => {
  test('keeps what was measured, as a table and as JSON, and escapes a pipe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'incus-e2e-report-'));
    const summary = join(dir, 'summary.md');
    const report = new Report('lifecycle', join(dir, 'report'), summary);
    report.fact('Incus', '7.5.1');
    report.add('cold create', 21_400, 'two | waits');
    const value = await report.time(
      'exec',
      () => Promise.resolve(7),
      (result) => `result ${result}`,
    );
    expect(value).toBe(7);
    expect(report.entries.map((entry) => entry.name)).toEqual([
      'cold create',
      'exec',
    ]);
    const log = spyOn(console, 'log').mockImplementation(() => {});
    report.flush();
    log.mockRestore();

    const markdown = readFileSync(summary, 'utf8');
    expect(markdown).toContain('### lifecycle');
    expect(markdown).toContain('- Incus: 7.5.1');
    expect(markdown).toContain('| cold create | 21.4 s | two \\| waits |');
    expect(markdown).toContain('| exec |');
    const json = JSON.parse(
      readFileSync(join(dir, 'report', 'lifecycle.json'), 'utf8'),
    );
    expect(json.timings[0]).toEqual({
      name: 'cold create',
      ms: 21_400,
      note: 'two | waits',
    });
  });

  test('writes no summary when the runner gives none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'incus-e2e-report-'));
    const report = new Report('quiet', dir, undefined);
    report.add('step', 10);
    const log = spyOn(console, 'log').mockImplementation(() => {});
    expect(() => report.flush()).not.toThrow();
    log.mockRestore();
    expect(report.markdown()).toContain('| step | 10 ms |');
  });
});
