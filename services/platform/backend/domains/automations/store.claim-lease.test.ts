// @vitest-environment node

/**
 * Unit lock for the run lease: ONE walker steps a run at a time.
 *
 * A claim locks the run row, decides, and takes the lease in one
 * transaction. A running run whose lease is live is refused (`leased`)
 * whoever holds it — this process included, since a worker runs several
 * walkers — so a duplicate step job or a sweep re-poke never starts a second
 * walker on the same step. A lapsed lease is taken over and recorded; a
 * released one (a hand-off) is claimed with no stamp. A run an image without
 * leases claimed last (`lease_epoch` <> `claim_epoch`) is held to that
 * image's own promise. A run a newer engine stepped is never read by this
 * one: it goes back to the queue while a roll is recent, to the sweep
 * otherwise. The real-Postgres probe races twelve claims for one winner.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { ENGINE_PROTOCOL } from '../../../lib/engine/core/protocol.ts';
import {
  ENGINE_DEFER_MS,
  RUN_CLAIM_PROMISE_MS,
  RUN_LEASE_MS,
} from '../../core/automations/liveness.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { instanceId, resetInstanceIdForTests } from '../../lib/instance.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { claimRun } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted transactional `sql`: the locked read answers `prior` (null = no
 * such run); the claim write answers the next epoch. */
function fakeSql(prior: Record<string, unknown> | null): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (
      text.includes('FROM app.automation_runs') &&
      text.includes('FOR UPDATE')
    ) {
      return Promise.resolve(prior === null ? [] : [prior]);
    }
    if (text.includes('claim_epoch = claim_epoch + 1')) {
      return Promise.resolve([{ claimEpoch: Number(prior?.claimEpoch) + 1 }]);
    }
    if (text.includes('INSERT INTO app.automation_run_events')) {
      return Promise.resolve([{ id: 'event_1' }]);
    }
    return Promise.resolve([]);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = (body: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    body(fn);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

const NOW = Date.now();

const prior = (overrides: Record<string, unknown> = {}) => ({
  status: 'running',
  claimEpoch: 3,
  leaseEpoch: 3,
  leaseOwner: 'host-a:41:0.5.80:blue',
  leaseExpiresAt: NOW + 20_000,
  wakeAt: NOW + 20_000,
  claimedAt: NOW - 5_000,
  engineProtocol: ENGINE_PROTOCOL,
  engineVersion: '0.5.80',
  ...overrides,
});

const claim = (sql: Sql) => claimRun(sql, 'org_1', 'run_1');

const claimWrite = (statements: Statement[]): Statement | undefined =>
  statements.find((s) => s.text.includes('claim_epoch = claim_epoch + 1'));

const events = (statements: Statement[]): Statement[] =>
  statements.filter((s) =>
    s.text.includes('INSERT INTO app.automation_run_events'),
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetInstanceIdForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('claimRun — one walker at a time', () => {
  it('refuses a running run whose lease is live, whoever holds it [AUTO-R16]', async () => {
    // Noah's nightly import is on step 3 when a second copy of its step job
    // arrives — here, from this very process.
    const fake = fakeSql(prior({ leaseOwner: instanceId() }));
    await expect(claim(fake.sql)).resolves.toEqual({
      claimed: false,
      status: 'leased',
      epoch: 3,
    });
    // The refusal reads under the row lock and writes nothing.
    expect(fake.statements).toHaveLength(1);
    expect(fake.statements[0]?.text).toContain('FOR UPDATE');
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('takes a queued run: a new epoch, this process’s lease and the engine stamp', async () => {
    const fake = fakeSql(
      prior({
        status: 'queued',
        claimEpoch: 0,
        leaseEpoch: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        wakeAt: NOW + RUN_CLAIM_PROMISE_MS,
        claimedAt: null,
        engineVersion: null,
      }),
    );
    await expect(claim(fake.sql)).resolves.toEqual({
      claimed: true,
      status: 'running',
      epoch: 1,
    });
    const write = claimWrite(fake.statements);
    expect(write?.text).toContain('lease_epoch = claim_epoch + 1');
    expect(write?.text).toContain('GREATEST(engine_protocol, ?::int)');
    expect(write?.values).toContain(instanceId());
    expect(write?.values).toContain(ENGINE_PROTOCOL);
    // The lease and the promise that mirrors it lapse together.
    const leaseUntil = write?.values.filter(
      (value): value is number =>
        typeof value === 'number' && value >= NOW + RUN_LEASE_MS,
    );
    expect(leaseUntil).toHaveLength(2);
    expect(leaseUntil?.[0]).toBe(leaseUntil?.[1]);
    // A first claim is no takeover: nothing counted, nothing recorded.
    expect(write?.values).toContain(false);
    expect(events(fake.statements)).toEqual([]);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('takes over a running run whose lease lapsed, counts it and records who held it', async () => {
    const fake = fakeSql(
      prior({ claimEpoch: 4, leaseEpoch: 4, leaseExpiresAt: NOW - 1 }),
    );
    await expect(claim(fake.sql)).resolves.toEqual({
      claimed: true,
      status: 'running',
      epoch: 5,
    });
    const write = claimWrite(fake.statements);
    expect(write?.text).toContain(
      "THEN 'lease_expired' ELSE last_resume_reason",
    );
    expect(write?.values).toContain(true);
    expect(write?.values).toContain(1);
    const [event] = events(fake.statements);
    expect(event?.values).toContain('taken_over');
    expect(event?.values).toContainEqual({
      json: {
        previousOwner: 'host-a:41:0.5.80:blue',
        previousEngine: '0.5.80',
      },
    });
  });

  it('claims a run whose lease was released by a hand-off, with no takeover stamp', async () => {
    const fake = fakeSql(prior({ leaseOwner: null, leaseExpiresAt: null }));
    await expect(claim(fake.sql)).resolves.toMatchObject({
      claimed: true,
      epoch: 4,
    });
    expect(claimWrite(fake.statements)?.values).toContain(false);
    expect(events(fake.statements)).toEqual([]);
  });

  it('takes a parked run whatever lease it last carried', async () => {
    const fake = fakeSql(
      prior({ status: 'waiting', leaseExpiresAt: NOW + 20_000 }),
    );
    await expect(claim(fake.sql)).resolves.toMatchObject({ claimed: true });
    expect(events(fake.statements)).toEqual([]);
  });

  it.each([
    ['a lease epoch of an older claim', 2],
    ['no lease epoch at all', null],
  ])(
    'holds a run an image without leases claimed last to its promise (%s)',
    async (_case, leaseEpoch) => {
      const alive = fakeSql(
        prior({
          leaseEpoch,
          leaseExpiresAt: NOW - 60_000,
          wakeAt: NOW + 60_000,
        }),
      );
      await expect(claim(alive.sql)).resolves.toMatchObject({
        claimed: false,
        status: 'leased',
      });

      const lapsed = fakeSql(
        prior({ leaseEpoch, leaseExpiresAt: NOW + 60_000, wakeAt: NOW - 1 }),
      );
      await expect(claim(lapsed.sql)).resolves.toMatchObject({ claimed: true });
      // Its walker held no lease of ours: not counted as a takeover.
      expect(claimWrite(lapsed.statements)?.values).toContain(false);
      expect(events(lapsed.statements)).toEqual([]);
    },
  );

  it.each([['success'], ['failed'], ['cancelled']])(
    'never takes a %s run, and says so',
    async (status) => {
      const fake = fakeSql(prior({ status }));
      await expect(claim(fake.sql)).resolves.toEqual({
        claimed: false,
        status,
        epoch: 3,
      });
      expect(claimWrite(fake.statements)).toBeUndefined();
    },
  );

  it('answers missing for a run that does not exist', async () => {
    const fake = fakeSql(null);
    await expect(claim(fake.sql)).resolves.toEqual({
      claimed: false,
      status: 'missing',
      epoch: 0,
    });
  });
});

describe('claimRun — a run a newer engine stepped', () => {
  it('goes back to the queue while the roll is recent, and is recorded once per release', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeSql(
      prior({
        status: 'queued',
        engineProtocol: ENGINE_PROTOCOL + 1,
        claimedAt: NOW - 60_000,
      }),
    );
    await expect(claim(fake.sql)).resolves.toEqual({
      claimed: false,
      status: 'deferred',
      epoch: 3,
    });
    expect(claimWrite(fake.statements)).toBeUndefined();
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.step',
      { organizationId: 'org_1', runId: 'run_1' },
      { startAfter: expect.any(Date) },
    );
    const promise = fake.statements.find((s) =>
      s.text.includes('UPDATE app.automation_runs'),
    );
    const wake = promise?.values.find(
      (value): value is number => typeof value === 'number',
    );
    expect(wake).toBeGreaterThanOrEqual(
      NOW + ENGINE_DEFER_MS + RUN_CLAIM_PROMISE_MS,
    );
    const [event] = events(fake.statements);
    expect(event?.values).toContain('engine_deferred');
    expect(event?.text).toContain('NOT EXISTS');
    expect(event?.values).toContain(false);
    expect(warn).toHaveBeenCalledWith(
      `[automations] run run_1 needs engine protocol ${ENGINE_PROTOCOL + 1}; this engine is ${ENGINE_PROTOCOL} — deferred`,
    );
  });

  it('is left to the sweep once the newer engine’s claim is old', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeSql(
      prior({
        status: 'queued',
        engineProtocol: ENGINE_PROTOCOL + 1,
        claimedAt: NOW - 11 * 60_000,
      }),
    );
    await expect(claim(fake.sql)).resolves.toMatchObject({
      status: 'deferred',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(
      fake.statements.some((s) =>
        s.text.includes('UPDATE app.automation_runs'),
      ),
    ).toBe(false);
  });

  it('is refused as leased, not deferred, while a walker holds it', async () => {
    const fake = fakeSql(prior({ engineProtocol: ENGINE_PROTOCOL + 1 }));
    await expect(claim(fake.sql)).resolves.toMatchObject({ status: 'leased' });
    expect(events(fake.statements)).toEqual([]);
  });
});
