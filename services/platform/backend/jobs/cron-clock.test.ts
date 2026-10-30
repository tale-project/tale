// @vitest-environment node

/**
 * Unit lock for the harness's guard against a pg-boss cron tick during the
 * lanes: it fails on a cron pass or on any forwarded tick since boot, a
 * forward whose data names no queue included, names the queues the ticks
 * were forwarded to, and holds a database a clock ran on before the run to
 * that pass. The real pg-boss tables ride `backend:integration`.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { RecordCheck } from '../integration-lane-helpers.ts';
import { checkNoCronTick, type CronClock } from './cron-clock.integration.ts';

interface ClockRow {
  lastPass: string | null;
  forwarded: string;
  queues: string;
}

/** A `sql` that answers its one statement with `row`, keeping what it sent. */
function answering(row: ClockRow): {
  sql: Sql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([row]);
  };
  return { sql: sql as unknown as Sql, statements };
}

const BOOT: CronClock = {
  readAt: '2026-10-29 17:00:00.000001+00',
  lastPass: null,
};

describe('checkNoCronTick', () => {
  it('passes when no cron pass ran and no tick was forwarded since boot', async () => {
    const { sql, statements } = answering({
      lastPass: null,
      forwarded: '0',
      queues: '',
    });
    const record = vi.fn<RecordCheck>();

    await checkNoCronTick(sql, BOOT, record);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[1]).toBe(true);
    // It reads the pass stamp, and counts the forwards since the boot
    // reading — a forward that names no queue among them.
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(
      'SELECT max(cron_on)::text FROM pgboss.version',
    );
    expect(statements[0]?.text).toContain(
      "WHERE name = '__pgboss__send-it' AND created_on >= ?::timestamptz",
    );
    expect(statements[0]?.text).toContain(
      "coalesce(data->>'name', '(no queue named)')",
    );
    expect(statements[0]?.text).toContain(
      'SELECT count(*)::text FROM forwards',
    );
    expect(statements[0]?.values).toEqual([BOOT.readAt]);
  });

  // A pass that found nothing due forwards nothing, and the clock still ran.
  it('fails when a cron pass ran since boot, even one that forwarded nothing', async () => {
    const { sql } = answering({
      lastPass: '2026-10-29 17:00:30.5+00',
      forwarded: '0',
      queues: '',
    });
    const record = vi.fn<RecordCheck>();

    await checkNoCronTick(sql, BOOT, record);

    expect(record.mock.calls[0]?.[1]).toBe(false);
    expect(record.mock.calls[0]?.[2]).toContain(
      'last cron pass=2026-10-29 17:00:30.5+00 (want never, as at boot)',
    );
  });

  it('fails when a tick was forwarded since boot, naming its queue', async () => {
    const { sql } = answering({
      lastPass: null,
      forwarded: '2',
      queues: 'automation.liveness, watchdog.transcriptions',
    });
    const record = vi.fn<RecordCheck>();

    await checkNoCronTick(sql, BOOT, record);

    expect(record.mock.calls[0]?.[1]).toBe(false);
    expect(record.mock.calls[0]?.[2]).toContain(
      'ticks forwarded since boot=2 to automation.liveness, watchdog.transcriptions (want 0)',
    );
  });

  // The names only say where the ticks went: the count decides, so a
  // forward the names miss still fails the check.
  it('fails on a forward the queue names miss, by its count', async () => {
    const { sql } = answering({ lastPass: null, forwarded: '1', queues: '' });
    const record = vi.fn<RecordCheck>();

    await checkNoCronTick(sql, BOOT, record);

    expect(record.mock.calls[0]?.[1]).toBe(false);
    expect(record.mock.calls[0]?.[2]).toContain(
      'ticks forwarded since boot=1 to none (want 0)',
    );
  });

  // A throwaway database a clock ran on before this run keeps that stamp.
  it('holds a database a clock ran on before boot to that pass', async () => {
    const before = '2026-10-28 09:15:00+00';
    const { sql } = answering({ lastPass: before, forwarded: '0', queues: '' });
    const record = vi.fn<RecordCheck>();

    await checkNoCronTick(sql, { ...BOOT, lastPass: before }, record);

    expect(record.mock.calls[0]?.[1]).toBe(true);
  });
});
