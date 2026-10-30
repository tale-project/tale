import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { describe, expect, test, vi } from 'vitest';

import { setEnqueueBoss } from './enqueue.ts';
import { SCHEDULES, sweepRunsAtBoot } from './schedules.ts';

/** `m h dom mon dow` — these three are all daily, so hour and minute suffice. */
function timeOf(name: string): { hour: number; minute: number } {
  const entry = SCHEDULES.find((row) => row.name === name);
  if (entry === undefined) throw new Error(`no schedule named ${name}`);
  const [minute, hour] = entry.cron.split(' ');
  return { hour: Number(hour), minute: Number(minute) };
}

describe('the daily governance schedules stay spaced', () => {
  const releases = timeOf('governance.effect_hold_releases');
  const verify = timeOf('audit.chain_check');
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

describe('the realtime outbox has a reclaimer that needs no browser', () => {
  test('the outbox sweep is scheduled on the worker', () => {
    // The `/events` poll loops reclaim only while a stream is open; without
    // this entry a headless deployment grows app_realtime.outbox forever.
    const entry = SCHEDULES.find(
      (row) => row.name === 'realtime.reclaim_outbox',
    );
    expect(entry).toBeDefined();
    // Minute-step cadence: the retention horizon is an hour, so a sweep well
    // inside it keeps the table near its steady-state size.
    expect(entry?.cron).toMatch(/^\*\/\d+ \* \* \* \*$/);
  });
});

describe('expired auth sessions have a reaper', () => {
  test('the expired-session sweep is scheduled once a day', () => {
    // Better Auth deletes an expired session only when it is presented
    // again; without this entry one nobody comes back with stays for good.
    const entry = SCHEDULES.find(
      (row) => row.name === 'maintenance.expired_sessions',
    );
    expect(entry?.cron).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});

describe('repeating tasks that continue on their due date have a scan', () => {
  test('the due-date scan runs every five minutes, off the shared minute', () => {
    // The spec promises the next task within five minutes of the due day's
    // start; the offset keeps it off the minute the other five-minute
    // sweeps share.
    const entry = SCHEDULES.find((row) => row.name === 'tasks.repeat_on_due');
    expect(entry?.cron).toMatch(/^[1-4]-59\/5 \* \* \* \*$/);
    const taken = SCHEDULES.filter(
      (row) => row.name !== 'tasks.repeat_on_due',
    ).map((row) => row.cron.split(' ')[0]);
    expect(taken).not.toContain(entry?.cron.split(' ')[0]);
  });
});

/** The minutes of the hour a cron minute field names, in the forms the
 * roster uses: every minute, one minute, a step over the hour or over a
 * range, and lists of those. */
function minutesOf(field: string): Set<number> {
  const minutes = new Set<number>();
  for (const part of field.split(',')) {
    const [range = '*', step = '1'] = part.split('/');
    const [from, to] =
      range === '*'
        ? [0, 59]
        : range.includes('-')
          ? range.split('-').map(Number)
          : [Number(range), part.includes('/') ? 59 : Number(range)];
    for (let minute = from ?? 0; minute <= (to ?? 59); minute += Number(step))
      minutes.add(minute);
  }
  return minutes;
}

describe('expired chat send keys have a sweep that waits for no send', () => {
  test('the send-key sweep runs hourly, on a minute only the every-minute schedules share', () => {
    // A keyed send no longer sweeps its organization's expired keys; without
    // this entry the ledger keeps every key it was ever given.
    const entry = SCHEDULES.find(
      (row) => row.name === 'chat.send_idempotency_gc',
    );
    expect(entry?.cron).toMatch(/^\d+ \* \* \* \*$/);
    const minute = Number(entry?.cron.split(' ')[0]);
    const sharing = SCHEDULES.filter((row) => {
      const field = row.cron.split(' ')[0] ?? '*';
      return (
        row.name !== 'chat.send_idempotency_gc' &&
        field !== '*' &&
        minutesOf(field).has(minute)
      );
    }).map((row) => row.name);
    expect(sharing).toEqual([]);
  });

  test('the minute reader reads the roster’s forms', () => {
    expect([...minutesOf('41')]).toEqual([41]);
    expect([...minutesOf('*/15')]).toEqual([0, 15, 30, 45]);
    expect([...minutesOf('7-59/15')]).toEqual([7, 22, 37, 52]);
    expect(minutesOf('*').size).toBe(60);
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

describe('a booting worker sweeps automation runs at once', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the send is faked, so the pool is never reached
  const sql = {} as Sql;

  test('it queues one liveness sweep beside the minute schedule', async () => {
    // A worker restarted after a crash pokes the runs the dead one left
    // without waiting for the next minute.
    const send = vi.fn().mockResolvedValue('job-1');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the façade calls `send` alone
    setEnqueueBoss({ send } as unknown as PgBoss);
    await sweepRunsAtBoot(sql);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'automation.liveness',
      {},
      expect.objectContaining({ db: expect.any(Object) }),
    );
    expect(
      SCHEDULES.find((row) => row.name === 'automation.liveness')?.cron,
    ).toBe('* * * * *');
  });

  test('a send that fails is logged and never fails the boot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = vi.fn().mockRejectedValue(new Error('queue unavailable'));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the façade calls `send` alone
    setEnqueueBoss({ send } as unknown as PgBoss);
    await expect(sweepRunsAtBoot(sql)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('boot liveness sweep'),
      expect.objectContaining({ message: 'queue unavailable' }),
    );
    warn.mockRestore();
  });
});
