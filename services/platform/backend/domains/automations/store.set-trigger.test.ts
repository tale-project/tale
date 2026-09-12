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
import { describe, expect, it } from 'vitest';

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
  existing: { kind: string; tokenHash: string | null } | null = null,
): {
  sql: Sql;
  /** The trigger-table statements — the write shape under test. */
  statements: Statement[];
  /** The realtime hints emitted alongside. */
  hints: Statement[];
} {
  const statements: Statement[] = [];
  const hints: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO app_realtime.outbox')) {
      hints.push({ text, values });
      return Promise.resolve([]);
    }
    statements.push({ text, values });
    if (text.includes('FOR UPDATE')) {
      return Promise.resolve(existing === null ? [] : [existing]);
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
  return { sql: fn as unknown as Sql, statements, hints };
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

    // The locked read of the row being replaced, then the ONE write — never
    // a SELECT-then-INSERT that decides existence in JavaScript.
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

  it('hands the plaintext out exactly when the minted hash landed', async () => {
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

  it('asks the database to rotate only when told to', async () => {
    const plain = fakeUpsert('kept');
    await setTrigger(plain.sql, args({ kind: 'webhook' }));
    const rotate = fakeUpsert('fresh');
    const rotated = await setTrigger(
      rotate.sql,
      args({ kind: 'webhook', rotateToken: true }),
    );
    // The rotate flag is the CASE's boolean parameter (the last one), decided
    // in SQL against the existing row.
    expect(upsertOf(plain.statements)?.values.at(-1)).toBe(false);
    expect(upsertOf(rotate.statements)?.values.at(-1)).toBe(true);
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
    ]) {
      expect(text).toContain(`${column} = CASE`);
      expect(text).toContain(`WHEN t.kind = EXCLUDED.kind THEN t.${column}`);
    }
    expect(text).toContain('ELSE NULL');
  });

  /**
   * Binding another kind over a live webhook kills its URL — the bind used
   * to answer `{name}` and the partner's next delivery answered 404 with no
   * explanation. The answer names it; a first bind and a same-kind re-bind
   * (which keeps the token) say nothing.
   */
  it('names the webhook URL a kind change revoked', async () => {
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

  it('refuses an invalid trigger before touching the database', async () => {
    const fake = fakeUpsert('fresh');
    await expect(
      setTrigger(fake.sql, args({ kind: 'schedule', cron: 'not a cron' })),
    ).rejects.toBeInstanceOf(AutomationError);
    expect(fake.statements).toHaveLength(0);
    expect(fake.hints).toHaveLength(0);
  });
});
