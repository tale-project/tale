// @vitest-environment node

/**
 * Unit lock for `setTrigger`'s write shape (trigger-delivery class): ONE
 * trigger statement — an INSERT … ON CONFLICT (org_id, name) DO UPDATE —
 * never a SELECT-then-INSERT that two racing binds could both pass; and the
 * webhook plaintext is handed out only when the hash minted here is the one
 * that landed (RETURNING), so a re-bind that keeps its token answers `{}`.
 * The bind rides one transaction with the `automation` hint that refreshes
 * other viewers' screens. The real-Postgres probe proves the convergence of
 * concurrent binds and the disable-stops-firing contract on the actual
 * schema.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The definition writes' audit rows are their own concern (`audit.ts`,
// `audit.test.ts`); this double answers no audit-chain query.
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(async () => undefined),
  listDeployments: vi.fn(async () => []),
}));

import { hashWebhookToken } from '../../core/automations/webhook_token.ts';
import { AutomationError, setTrigger, type TriggerInput } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Positions of parameters in the upsert: the VALUES list (org, name,
 * kind, cron, timezone, event, token_hash, enabled, created_by, created_at,
 * updated_at, schedule_rule, catch_up, next_due, run_input), then the
 * rotate flag and
 * the managed flag the ON CONFLICT branch decides on. */
const TOKEN_HASH_PARAM = 6;
const CRON_PARAM = 3;
const TIMEZONE_PARAM = 4;
const SCHEDULE_RULE_PARAM = 11;
const CATCH_UP_PARAM = 12;
const NEXT_DUE_PARAM = 13;
const RUN_INPUT_PARAM = 14;
const ROTATE_PARAM = 15;
const MANAGED_PARAM = 16;

/**
 * Scripted `sql`: the locked read of the row being replaced answers
 * `existing` (nothing on a first bind); the upsert answers with the
 * token_hash that "landed" — `fresh` echoes the minted hash back (an insert,
 * or a rotate), `kept` answers an existing row's hash (a re-bind that kept
 * its token).
 */
function fakeUpsert(
  landing: 'fresh' | 'kept',
  existing: {
    id?: string;
    kind: string;
    tokenHash: string | null;
    lastSkipReason?: string | null;
    cron?: string | null;
    timezone?: string | null;
    scheduleRule?: unknown;
    enabled?: boolean;
    nextDueAt?: number | null;
  } | null = null,
  /** The inputs schema of the deployed version; nothing is deployed when
   * absent. */
  deployedInputs?: Record<string, unknown>,
): {
  sql: Sql;
  /** The trigger-table statements — the write shape under test. */
  statements: Statement[];
  /** The realtime hints emitted alongside. */
  hints: Statement[];
  /** Every statement in order, the advisory locks included. */
  sequence: Statement[];
} {
  const statements: Statement[] = [];
  const hints: Statement[] = [];
  const sequence: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    sequence.push({ text, values });
    if (text.includes('INSERT INTO app_realtime.outbox')) {
      hints.push({ text, values });
      return Promise.resolve([]);
    }
    // The audit chain's lock (`lockAuditChain`) — taken, not a trigger write.
    if (text.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    statements.push({ text, values });
    if (text.includes('FOR UPDATE')) {
      return Promise.resolve(
        existing === null
          ? []
          : [
              {
                cron: null,
                timezone: null,
                scheduleRule: null,
                enabled: true,
                nextDueAt: null,
                ...existing,
              },
            ],
      );
    }
    if (text.includes('UPDATE app.user_notifications')) {
      return Promise.resolve([{ userId: 'admin_1' }]);
    }
    // The warnings' read of the version that runs, after the bind.
    if (text.includes('FROM app.automation_deployments')) {
      return Promise.resolve(
        deployedInputs === undefined ? [] : [{ version: 7 }],
      );
    }
    if (text.includes('FROM app.automations')) {
      return Promise.resolve([
        {
          name: 'ops/greet',
          version: 7,
          document: { inputs: deployedInputs },
          createdAt: 1,
        },
      ]);
    }
    if (!text.includes('INSERT INTO app.automation_triggers')) {
      throw new Error(`unexpected statement: ${text}`);
    }
    return Promise.resolve([
      {
        tokenHash:
          landing === 'fresh' ? values[TOKEN_HASH_PARAM] : 'existing-hash',
      },
    ]);
  };
  fn.begin = (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    callback(fn);
  fn.json = (value: unknown): unknown => value;
  return { sql: fn as unknown as Sql, statements, hints, sequence };
}

/** The upsert — the one write of the bind. */
const upsertOf = (statements: Statement[]): Statement | undefined =>
  statements.find((s) =>
    s.text.includes('INSERT INTO app.automation_triggers'),
  );

const args = (trigger: Parameters<typeof setTrigger>[1]['trigger']) => ({
  organizationId: 'org_1',
  name: 'ops/greet',
  trigger,
  actor: 'user_1',
});

describe('setTrigger', () => {
  it('binds with one upsert on (org_id, name), behind a lock on the row it replaces', async () => {
    const fake = fakeUpsert('fresh');
    await setTrigger(fake.sql, args({ kind: 'schedule', cron: '0 9 * * 1' }));

    // The organization's audit chain first — the order every transaction
    // holding the chain and a trigger row takes them in
    // (`trigger-failures.ts`) — then the locked read of the row being
    // replaced, then the ONE write — never a SELECT-then-INSERT that decides
    // existence in JavaScript. After the bind, only the read of the version
    // that runs, for the warnings.
    expect(fake.sequence[0]?.values).toEqual([
      expect.any(Number),
      'audit-chain:org_1',
    ]);
    expect(fake.statements).toHaveLength(3);
    const [read, statement, deployedRead] = fake.statements;
    expect(deployedRead?.text).toContain('FROM app.automation_deployments');
    expect(read?.text).toContain('FOR UPDATE');
    expect(read?.values).toEqual(['org_1', 'ops/greet']);
    expect(statement?.text).toContain(
      'ON CONFLICT (org_id, name) DO UPDATE SET',
    );
    expect(statement?.text).toContain('RETURNING token_hash');
    expect(statement?.text).not.toContain('SELECT');
    // A schedule carries no token: the hash parameter is null.
    expect(statement?.values[TOKEN_HASH_PARAM]).toBeNull();
    // The bind refreshes other viewers' automation reads.
    expect(fake.hints).toHaveLength(1);
    expect(fake.hints[0]?.values).toEqual([
      'org_1',
      null,
      'automation',
      'ops/greet',
    ]);
  });

  it('hands the plaintext out exactly when the minted hash landed [AUTO-R11]', async () => {
    const fresh = fakeUpsert('fresh');
    const minted = await setTrigger(fresh.sql, args({ kind: 'webhook' }));
    expect(minted.token).toBeTypeOf('string');
    expect(await hashWebhookToken(minted.token ?? '')).toBe(
      upsertOf(fresh.statements)?.values[TOKEN_HASH_PARAM],
    );

    const kept = fakeUpsert('kept', {
      kind: 'webhook',
      tokenHash: 'existing-hash',
    });
    const rebound = await setTrigger(kept.sql, args({ kind: 'webhook' }));
    expect(rebound).toEqual({});
  });

  it('asks the database to rotate only when told to [AUTO-R11]', async () => {
    const plain = fakeUpsert('kept');
    await setTrigger(plain.sql, args({ kind: 'webhook' }));
    const rotate = fakeUpsert('fresh');
    const rotated = await setTrigger(
      rotate.sql,
      args({ kind: 'webhook', rotateToken: true }),
    );
    // The rotate flag follows the fourteen INSERT parameters, decided
    // in SQL against the existing row.
    expect(upsertOf(plain.statements)?.values[ROTATE_PARAM]).toBe(false);
    expect(upsertOf(rotate.statements)?.values[ROTATE_PARAM]).toBe(true);
    expect(rotated.token).toBeTypeOf('string');
  });

  it('clears the whole fire ledger when the kind changes, and keeps it otherwise', async () => {
    // Decided in SQL against the existing row: a fresh event trigger never
    // inherits the firing history of the webhook it replaced — neither the
    // fire stamp nor the run it named, the claim cursor or the last skip.
    const fake = fakeUpsert('fresh');
    await setTrigger(
      fake.sql,
      args({ kind: 'event', event: 'contact.created' }),
    );
    const text = upsertOf(fake.statements)?.text ?? '';
    for (const column of [
      'last_fired_at_ms',
      'last_due_at_ms',
      'last_run_id',
      'last_skipped_at_ms',
      'last_skip_reason',
      'last_skip_detail',
      'last_failed_at_ms',
      'last_failure_code',
      'last_failed_run_id',
    ]) {
      expect(text).toContain(`${column} = CASE`);
      expect(text).toContain(`WHEN t.kind = EXCLUDED.kind THEN t.${column}`);
    }
    expect(text).toContain('ELSE NULL');
  });

  it('starts a fresh failure streak on every save [AUTO-R13]', async () => {
    // A person looked at the binding: runs started before the save no
    // longer count toward pausing it (`trigger-failures.ts`).
    const fake = fakeUpsert('kept', { kind: 'schedule', tokenHash: null });
    await setTrigger(fake.sql, args({ kind: 'schedule', cron: '0 9 * * 1' }));
    const text = upsertOf(fake.statements)?.text ?? '';
    expect(text).toContain(
      'consecutive_failures = CASE WHEN ? THEN t.consecutive_failures ELSE 0 END',
    );
    expect(upsertOf(fake.statements)?.values[MANAGED_PARAM]).toBe(false);
    // A save that finds no pause dismisses nothing: the read and the write,
    // then the read of the version that runs, for the warnings.
    expect(fake.statements).toHaveLength(3);
  });

  it('clears the pause of a schedule its failures paused, and the notices of it [AUTO-R13]', async () => {
    const fake = fakeUpsert('kept', {
      id: 'trg_1',
      kind: 'schedule',
      tokenHash: null,
      lastSkipReason: 'paused_after_failures',
    });
    await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 9 * * 1', enabled: false }),
    );
    // Whatever `enabled` the save sets, someone decided: the skip stamp the
    // pause wrote goes, decided in SQL against the row it replaces.
    const text = upsertOf(fake.statements)?.text ?? '';
    for (const column of [
      'last_skipped_at_ms',
      'last_skip_reason',
      'last_skip_detail',
    ]) {
      expect(text).toMatch(
        new RegExp(
          `${column} = CASE\\s+WHEN t\\.last_skip_reason = 'paused_after_failures' THEN NULL`,
        ),
      );
    }
    // The owners' and admins' unread notices of the pause are marked read.
    const dismissal = fake.statements.find((s) =>
      s.text.includes('UPDATE app.user_notifications'),
    );
    expect(dismissal?.text).toContain("type = 'automation_failed'");
    expect(dismissal?.values).toEqual([expect.any(Number), 'org_1', 'trg_1']);
    // Their bells hear about it, and the automation read refreshes.
    expect(fake.hints.map((hint) => hint.values[2])).toEqual(
      expect.arrayContaining(['automation']),
    );
    expect(fake.hints).toHaveLength(2);
  });

  /**
   * Binding another kind over a live webhook kills its URL — the bind used
   * to answer `{name}` and the partner's next delivery answered 404 with no
   * explanation. The answer names it; a first bind and a same-kind re-bind
   * (which keeps the token) say nothing.
   */
  it('names the webhook URL a kind change revoked [AUTO-R11]', async () => {
    const fake = fakeUpsert('fresh', {
      kind: 'webhook',
      tokenHash: 'existing-hash',
    });
    const outcome = await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 9 * * 1' }),
    );
    expect(outcome).toEqual({
      revoked: 'webhook',
      nextRunAt: expect.any(Number),
    });
  });

  it.each([
    ['a first bind', null, { kind: 'schedule', cron: '0 9 * * 1' } as const],
    [
      'a same-kind re-bind of a webhook',
      { kind: 'webhook', tokenHash: 'existing-hash' },
      { kind: 'webhook' } as const,
    ],
    [
      'a kind change over a schedule',
      { kind: 'schedule', tokenHash: null },
      { kind: 'event', event: 'contact.created' } as const,
    ],
    [
      'a kind change over a webhook row that never minted a token',
      { kind: 'webhook', tokenHash: null },
      { kind: 'schedule', cron: '0 9 * * 1' } as const,
    ],
  ])(
    'says nothing about revocation on %s',
    async (_case, existing, trigger) => {
      const fake = fakeUpsert('kept', existing);
      const outcome = await setTrigger(fake.sql, args(trigger));
      expect(outcome.revoked).toBeUndefined();
    },
  );

  it('stores the event name trimmed, as it was validated', async () => {
    const fake = fakeUpsert('fresh');
    await setTrigger(
      fake.sql,
      args({ kind: 'event', event: '  contact.created  ' }),
    );
    // VALUES order: org, name, kind, cron, timezone, event, token_hash, …
    expect(upsertOf(fake.statements)?.values[5]).toBe('contact.created');
  });

  it('refuses an invalid trigger before touching the database [AUTO-R10]', async () => {
    const fake = fakeUpsert('fresh');
    await expect(
      setTrigger(fake.sql, args({ kind: 'schedule', cron: 'not a cron' })),
    ).rejects.toBeInstanceOf(AutomationError);
    expect(fake.statements).toHaveLength(0);
    expect(fake.hints).toHaveLength(0);
  });
});

/**
 * When a schedule is next due is decided at the save (0170): a save that
 * changes what the schedule is, or switches it on, starts counting after
 * the save; one that leaves it as it was keeps the instant the scan has not
 * reached yet, so an input-only save never drops an occurrence. The bind
 * also stores one spelling per value: the zone as `Intl` spells it, the
 * rule normalised with the day it starts on, `catchUp` only when it is
 * `skip`.
 */
describe('setTrigger — the next start of a schedule', () => {
  // 09:30 in Zurich on Thursday, 8 October 2026.
  const NOW = Date.UTC(2026, 9, 8, 7, 30);
  const NINE_TOMORROW = Date.UTC(2026, 9, 9, 7, 0);
  const daily: TriggerInput & { kind: 'schedule' } = {
    kind: 'schedule',
    repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
    timezone: 'Europe/Zurich',
  };
  const storedDaily = {
    repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
    startDate: '2026-10-08',
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts after the save, and answers it', async () => {
    const fake = fakeUpsert('fresh');
    const outcome = await setTrigger(fake.sql, args(daily));
    const values = upsertOf(fake.statements)?.values ?? [];
    expect(values[NEXT_DUE_PARAM]).toBe(NINE_TOMORROW);
    expect(outcome).toEqual({ nextRunAt: NINE_TOMORROW });
  });

  it('keeps the instant the scan has not reached when the schedule is unchanged and stays on', async () => {
    const due = Date.UTC(2026, 9, 8, 7, 0); // 09:00 today, not scanned yet
    const fake = fakeUpsert('kept', {
      kind: 'schedule',
      tokenHash: null,
      timezone: 'Europe/Zurich',
      scheduleRule: storedDaily,
      enabled: true,
      nextDueAt: due,
    });
    await setTrigger(fake.sql, args({ ...daily, startDate: '2026-10-08' }));
    expect(upsertOf(fake.statements)?.values[NEXT_DUE_PARAM]).toBe(due);
  });

  it.each<
    [string, { enabled: boolean; scheduleRule: unknown }, TriggerInput, number]
  >([
    [
      'a changed time',
      { enabled: true, scheduleRule: storedDaily },
      {
        ...daily,
        repeat: { frequency: 'daily', interval: 1, times: ['10:00'] },
        startDate: '2026-10-08',
      },
      Date.UTC(2026, 9, 8, 8, 0),
    ],
    [
      'a schedule switched back on',
      { enabled: false, scheduleRule: storedDaily },
      { ...daily, startDate: '2026-10-08' },
      NINE_TOMORROW,
    ],
    [
      'a cron saved over a rule',
      { enabled: true, scheduleRule: storedDaily },
      { kind: 'schedule', cron: '0 9 * * *', timezone: 'Europe/Zurich' },
      NINE_TOMORROW,
    ],
  ])(
    'counts from the save after %s, never from the old instant [AUTO-R13]',
    async (_case, existing, trigger, expected) => {
      const fake = fakeUpsert('kept', {
        kind: 'schedule',
        tokenHash: null,
        timezone: 'Europe/Zurich',
        nextDueAt: Date.UTC(2026, 9, 8, 7, 0),
        ...existing,
      });
      await setTrigger(fake.sql, args(trigger));
      expect(upsertOf(fake.statements)?.values[NEXT_DUE_PARAM]).toBe(expected);
    },
  );

  it('keeps no instant while the schedule is off, and answers none', async () => {
    const fake = fakeUpsert('fresh');
    const outcome = await setTrigger(
      fake.sql,
      args({ ...daily, enabled: false }),
    );
    expect(upsertOf(fake.statements)?.values[NEXT_DUE_PARAM]).toBeNull();
    expect(outcome).toEqual({ nextRunAt: null });
  });

  it('answers no next start for a webhook or an event', async () => {
    const fake = fakeUpsert('fresh');
    const outcome = await setTrigger(
      fake.sql,
      args({ kind: 'event', event: 'contact.created' }),
    );
    expect(outcome).toEqual({});
    expect(upsertOf(fake.statements)?.values[NEXT_DUE_PARAM]).toBeNull();
  });

  it('stores one spelling: the zone, the rule with its start day, catch-up only when skip', async () => {
    const fake = fakeUpsert('fresh');
    await setTrigger(
      fake.sql,
      args({
        kind: 'schedule',
        repeat: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [5, 1, 1],
          times: ['17:30', '09:00'],
        },
        timezone: ' europe/zurich ',
        catchUp: 'skip',
      }),
    );
    const values = upsertOf(fake.statements)?.values ?? [];
    expect(values[CRON_PARAM]).toBeNull();
    expect(values[TIMEZONE_PARAM]).toBe('Europe/Zurich');
    expect(values[SCHEDULE_RULE_PARAM]).toEqual(
      JSON.stringify({
        repeat: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1, 5],
          times: ['09:00', '17:30'],
        },
        startDate: '2026-10-08',
      }),
    );
    expect(values[CATCH_UP_PARAM]).toBe('skip');

    const latest = fakeUpsert('fresh');
    await setTrigger(
      latest.sql,
      args({ kind: 'schedule', cron: ' 0 9 * * * ', catchUp: 'latest' }),
    );
    const cronValues = upsertOf(latest.statements)?.values ?? [];
    expect(cronValues[CRON_PARAM]).toBe('0 9 * * *');
    expect(cronValues[TIMEZONE_PARAM]).toBeNull();
    expect(cronValues[SCHEDULE_RULE_PARAM]).toBeNull();
    expect(cronValues[CATCH_UP_PARAM]).toBeNull();
  });
});

/**
 * A trigger whose input the deployed version would refuse is saved, with a
 * warning that names what is missing; a fixed input that has it saves
 * clean, and is stored as the run input it adds.
 */
describe('setTrigger — warnings about what the trigger sends [AUTO-R31]', () => {
  const ownerRepo = {
    type: 'object',
    required: ['owner', 'repo'],
    properties: { owner: { type: 'string' }, repo: { type: 'string' } },
  };

  it('saves Ada’s GitHub schedule without owner and repo, and warns naming both', async () => {
    const fake = fakeUpsert('fresh', null, ownerRepo);
    const outcome = await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 7 * * *', timezone: 'UTC' }),
    );
    expect(upsertOf(fake.statements)).toBeDefined();
    expect(outcome.warnings).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'TRIGGER_INPUT_MISMATCH',
        at: { pointer: '/inputs' },
        params: {
          kind: 'schedule',
          missing: ['owner', 'repo'],
          problems: ['owner is required', 'repo is required'],
        },
      }),
    ]);
  });

  it('saves clean once the fixed input has them, and stores that input', async () => {
    const fake = fakeUpsert('fresh', null, ownerRepo);
    const outcome = await setTrigger(
      fake.sql,
      args({
        kind: 'schedule',
        cron: '0 7 * * *',
        timezone: 'UTC',
        input: { owner: 'tale', repo: 'tale' },
      }),
    );
    expect(outcome.warnings).toBeUndefined();
    expect(upsertOf(fake.statements)?.values[RUN_INPUT_PARAM]).toBe(
      JSON.stringify({ owner: 'tale', repo: 'tale' }),
    );
  });

  it('warns about a template in the fixed input even with nothing deployed', async () => {
    const fake = fakeUpsert('fresh');
    const outcome = await setTrigger(
      fake.sql,
      args({ kind: 'webhook', input: { owner: '{{ payload.owner }}' } }),
    );
    expect(outcome.warnings?.map((warning) => warning.code)).toEqual([
      'TRIGGER_INPUT_NOT_TEMPLATED',
    ]);
  });

  it('refuses a fixed input that names a field the trigger sets itself', async () => {
    const fake = fakeUpsert('fresh');
    await expect(
      setTrigger(
        fake.sql,
        args({ kind: 'webhook', input: { payload: { forged: true } } }),
      ),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
      data: {
        issues: [expect.objectContaining({ code: 'input.reserved_key' })],
      },
    });
    expect(fake.statements).toHaveLength(0);
  });
});
