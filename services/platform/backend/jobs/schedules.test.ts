import { describe, expect, test } from 'vitest';

import { SCHEDULES } from './schedules.ts';

/** `m h dom mon dow` — these three are all daily, so hour and minute suffice. */
function timeOf(name: string): { hour: number; minute: number } {
  const entry = SCHEDULES.find((row) => row.name === name);
  if (entry === undefined) throw new Error(`no schedule named ${name}`);
  const [minute, hour] = entry.cron.split(' ');
  return { hour: Number(hour), minute: Number(minute) };
}

describe('the daily governance schedules stay spaced', () => {
  const releases = timeOf('governance.effect_hold_releases');
  const verify = timeOf('audit.integrity_check');
  const sweep = timeOf('governance.retention_cleanup');

  test('releases run before the sweep that frees their data', () => {
    // A cleared maker-checker release frees data for the same night's sweep
    // instead of waiting another day.
    expect(releases.hour).toBeLessThan(sweep.hour);
  });

  test('the audit verify does not run inside the retention window', () => {
    // The verifier anchors on the oldest surviving row, so walking the chain
    // while retention deletes audit prefixes reads a chain mid-deletion.
    expect(verify.hour).not.toBe(sweep.hour);
  });

  test('no two of the three share an hour', () => {
    const hours = [releases.hour, verify.hour, sweep.hour];
    expect(new Set(hours).size).toBe(3);
  });

  test('the corpus reconcile runs after the sweep, not before it', () => {
    // This one DOES share the sweep's hour, deliberately: its own comment
    // says it runs after retention so rows the sweep just purged reconcile
    // the same night. Pinned so the spacing rule above is not read as
    // "spread everything out" and this gets moved.
    const reconcile = timeOf('knowledge.reconcile_corpus');
    expect(reconcile.hour).toBe(sweep.hour);
    expect(reconcile.minute).toBeGreaterThan(sweep.minute);
  });
});

describe('the schedule roster is well formed', () => {
  test('every name is unique', () => {
    const names = SCHEDULES.map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every cron has five fields', () => {
    const malformed = SCHEDULES.filter(
      (row) => row.cron.trim().split(/\s+/).length !== 5,
    );
    expect(malformed.map((row) => row.name)).toEqual([]);
  });
});
