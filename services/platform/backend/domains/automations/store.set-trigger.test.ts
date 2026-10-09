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
import { describe, expect, it, vi } from 'vitest';

// The definition writes' audit rows are their own concern (`audit.ts`,
// `audit.test.ts`); this double answers no audit-chain query.
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(async () => undefined),
  listDeployments: vi.fn(async () => []),
}));

import { hashWebhookToken } from '../../core/automations/webhook_token.ts';
import { AutomationError, setTrigger } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Position of the token_hash parameter in the upsert's VALUES list. */
const TOKEN_HASH_PARAM = 6;

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
  } | null = null,
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
    // Audit-chain and automation-name locks are not trigger writes.
    if (text.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    statements.push({ text, values });
    if (text.includes('FOR UPDATE')) {
      return Promise.resolve(existing === null ? [] : [existing]);
    }
    if (text.includes('UPDATE app.user_notifications')) {
      return Promise.resolve([{ userId: 'admin_1' }]);
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
    // existence in JavaScript.
    expect(fake.sequence[0]?.values).toEqual([
      expect.any(Number),
      'audit-chain:org_1',
    ]);
    expect(fake.statements).toHaveLength(2);
    const [read, statement] = fake.statements;
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
    // Read the parameter at the rotation expression, independently of
    // columns appended to the INSERT list.
    const rotationFlag = (statements: Statement[]) => {
      const upsert = upsertOf(statements);
      const marker = 'WHEN ?::boolean OR t.token_hash IS NULL';
      if (upsert === undefined || upsert.text.split(marker).length !== 2)
        throw new Error('expected one token rotation expression');
      const before = upsert.text.slice(0, upsert.text.indexOf(marker));
      return upsert.values[before.split('?').length - 1];
    };
    expect(rotationFlag(plain.statements)).toBe(false);
    expect(rotationFlag(rotate.statements)).toBe(true);
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
    expect(upsertOf(fake.statements)?.values[12]).toBe(false);
    // A save that finds no pause dismisses nothing: the read and the write.
    expect(fake.statements).toHaveLength(2);
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
    for (const column of ['last_skipped_at_ms', 'last_skip_reason']) {
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
    expect(outcome).toEqual({ revoked: 'webhook' });
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
 * The slot-wake opt-in (#4540): a scripted `sql` whose locked read answers
 * `existing` and whose single-target probe answers `others` — another
 * enabled, opted-in schedule bound to one of this automation's projects.
 */
function fakeWakeBind(
  existing: { kind: string; enabled: boolean; wakeOnSlotFreed: boolean } | null,
  others: { name: string }[] = [],
  options: { bound?: string[]; claimFails?: boolean } = {},
): { sql: Sql; statements: Statement[]; order: string[] } {
  const statements: Statement[] = [];
  const order: string[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO app_realtime.outbox')) {
      order.push('hint');
      return Promise.resolve([]);
    }
    if (text.includes('pg_advisory_xact_lock')) {
      order.push(
        values.includes('audit-chain:org_1') ? 'audit-lock' : 'name-lock',
      );
      return Promise.resolve([]);
    }
    statements.push({ text, values });
    if (text.includes('FROM app.automation_project_bindings theirs')) {
      order.push('pre-check');
      return Promise.resolve(others);
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      order.push('claim-rows');
      return Promise.resolve(
        (options.bound ?? []).map((projectId) => ({ projectId })),
      );
    }
    if (text.includes('UPDATE app.automation_project_bindings')) {
      order.push(`claim:${String(values[0])}:${String(values[3])}`);
      return Promise.resolve([]);
    }
    if (text.includes('FOR UPDATE')) {
      order.push('trigger-row');
      return Promise.resolve(
        existing === null
          ? []
          : [
              {
                id: 'trigger_1',
                tokenHash: null,
                lastSkipReason: null,
                cron: '0 9 * * *',
                timezone: 'UTC',
                ...existing,
              },
            ],
      );
    }
    if (!text.includes('INSERT INTO app.automation_triggers')) {
      throw new Error(`unexpected statement: ${text}`);
    }
    order.push('upsert');
    if (options.claimFails === true) {
      // Migration 0168's trigger rewrites the bindings inside the upsert and
      // the one-wake index refuses a second claim there.
      return Promise.reject(
        Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint_name: 'automation_project_bindings_one_wake',
        }),
      );
    }
    return Promise.resolve([{ tokenHash: null }]);
  };
  fn.begin = (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    callback(fn);
  return { sql: fn as unknown as Sql, statements, order };
}

/** Position of the opt-in in the upsert's VALUES list. */
const WAKE_PARAM = 11;

describe('setTrigger — the slot-wake opt-in (#4540) [AUTO-R29]', () => {
  it('keeps the opt-in when a save omits it, and clears it on a kind change', async () => {
    const fake = fakeWakeBind({
      kind: 'schedule',
      enabled: true,
      wakeOnSlotFreed: true,
    });
    await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 9 * * 1', enabled: false }),
    );
    const upsert = upsertOf(fake.statements);
    expect(upsert?.values[WAKE_PARAM]).toBe(true);
    expect(upsert?.text).toContain(
      "WHEN EXCLUDED.kind <> 'schedule' THEN false",
    );
    expect(upsert?.text).toContain(
      "THEN t.kind = 'schedule' AND t.wake_on_slot_freed",
    );
  });

  it('never opts in a trigger of another kind', async () => {
    const fake = fakeWakeBind({
      kind: 'schedule',
      enabled: true,
      wakeOnSlotFreed: true,
    });
    await setTrigger(fake.sql, args({ kind: 'webhook' }));
    expect(upsertOf(fake.statements)?.values[WAKE_PARAM]).toBe(false);
  });

  it('refuses a second enabled schedule that wakes the same project', async () => {
    const fake = fakeWakeBind(null, [{ name: 'ops/other-manager' }]);
    const refused = await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 9 * * 1', wakeOnSlotFreed: true }),
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AutomationError);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
      status: 409,
    });
    expect(upsertOf(fake.statements)).toBeUndefined();
  });

  it('lets a disabled schedule keep its opt-in beside an enabled one', async () => {
    const fake = fakeWakeBind(null, [{ name: 'ops/other-manager' }]);
    await setTrigger(
      fake.sql,
      args({
        kind: 'schedule',
        cron: '0 9 * * 1',
        enabled: false,
        wakeOnSlotFreed: true,
      }),
    );
    expect(
      fake.statements.some((s) =>
        s.text.includes('FROM app.automation_project_bindings theirs'),
      ),
    ).toBe(false);
    expect(upsertOf(fake.statements)?.values[WAKE_PARAM]).toBe(true);
  });
});

describe('setTrigger — one wake target per project, kept by the database (#4540) [AUTO-R29]', () => {
  it('takes the automation name lock before the row it replaces', async () => {
    const fake = fakeWakeBind(null);
    await setTrigger(fake.sql, args({ kind: 'schedule', cron: '0 9 * * 1' }));
    expect(fake.order.slice(0, 3)).toEqual([
      'audit-lock',
      'name-lock',
      'trigger-row',
    ]);
  });

  it('leaves the bindings to the database: a claiming save writes no binding itself', async () => {
    const fake = fakeWakeBind(
      { kind: 'schedule', enabled: true, wakeOnSlotFreed: false },
      [],
      { bound: ['p-1', 'p-2'] },
    );
    await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 9 * * 1', wakeOnSlotFreed: true }),
    );
    expect(fake.order).toEqual([
      'audit-lock',
      'name-lock',
      'trigger-row',
      'pre-check',
      'upsert',
      'hint',
    ]);
  });

  it('answers a second claim the database refuses (the one-wake index) with 409 and stops there', async () => {
    const fake = fakeWakeBind(
      { kind: 'schedule', enabled: true, wakeOnSlotFreed: false },
      [],
      { bound: ['p-1'], claimFails: true },
    );
    const refused = await setTrigger(
      fake.sql,
      args({ kind: 'schedule', cron: '0 9 * * 1', wakeOnSlotFreed: true }),
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AutomationError);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
      status: 409,
    });
    expect(fake.order).not.toContain('hint');
  });

  it('skips the friendly pre-check when the claim does not change', async () => {
    const fake = fakeWakeBind(
      { kind: 'schedule', enabled: true, wakeOnSlotFreed: true },
      [],
      { bound: ['p-1'] },
    );
    await setTrigger(fake.sql, args({ kind: 'schedule', cron: '0 10 * * 1' }));
    expect(fake.order).not.toContain('pre-check');
  });
});
