// @vitest-environment node

/**
 * Unit lock for `setTrigger`'s write shape (trigger-delivery class): ONE
 * statement — an INSERT … ON CONFLICT (org_id, name) DO UPDATE — never a
 * SELECT-then-INSERT that two racing binds could both pass; and the webhook
 * plaintext is handed out only when the hash minted here is the one that
 * landed (RETURNING), so a re-bind that keeps its token answers `{}`. The
 * real-Postgres probe proves the convergence of concurrent binds and the
 * disable-stops-firing contract on the actual schema.
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
 * Scripted `sql`: the upsert answers with the token_hash that "landed" —
 * `fresh` echoes the minted hash back (an insert, or a rotate), `kept`
 * answers an existing row's hash (a re-bind that kept its token).
 */
function fakeUpsert(landing: 'fresh' | 'kept'): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
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
  fn.begin = (): never => {
    throw new Error('setTrigger must be a single statement, not a transaction');
  };
  return { sql: fn as unknown as Sql, statements };
}

const args = (trigger: Parameters<typeof setTrigger>[1]['trigger']) => ({
  organizationId: 'org_1',
  name: 'ops/greet',
  trigger,
  actor: 'user_1',
});

describe('setTrigger', () => {
  it('binds with one upsert on (org_id, name)', async () => {
    const fake = fakeUpsert('fresh');
    await setTrigger(fake.sql, args({ kind: 'schedule', cron: '0 9 * * 1' }));

    expect(fake.statements).toHaveLength(1);
    const [statement] = fake.statements;
    expect(statement?.text).toContain(
      'ON CONFLICT (org_id, name) DO UPDATE SET',
    );
    expect(statement?.text).toContain('RETURNING token_hash');
    expect(statement?.text).not.toContain('SELECT');
    // A schedule carries no token: the hash parameter is null.
    expect(statement?.values[TOKEN_HASH_PARAM]).toBeNull();
  });

  it('hands the plaintext out exactly when the minted hash landed', async () => {
    const fresh = fakeUpsert('fresh');
    const minted = await setTrigger(fresh.sql, args({ kind: 'webhook' }));
    expect(minted.token).toBeTypeOf('string');
    expect(await hashWebhookToken(minted.token ?? '')).toBe(
      fresh.statements[0]?.values[TOKEN_HASH_PARAM],
    );

    const kept = fakeUpsert('kept');
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
    expect(plain.statements[0]?.values.at(-1)).toBe(false);
    expect(rotate.statements[0]?.values.at(-1)).toBe(true);
    expect(rotated.token).toBeTypeOf('string');
  });

  it('refuses an invalid trigger before touching the database', async () => {
    const fake = fakeUpsert('fresh');
    await expect(
      setTrigger(fake.sql, args({ kind: 'schedule', cron: 'not a cron' })),
    ).rejects.toBeInstanceOf(AutomationError);
    expect(fake.statements).toHaveLength(0);
  });
});
