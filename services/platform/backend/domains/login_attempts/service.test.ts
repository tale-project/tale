// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { clearOnSuccess, getLockState, recordBlocked } from './service.ts';

/**
 * Every lockout read and write keys `app.login_attempts` by the canonical
 * address (lowercase + trim) — the form the user row is matched by. The
 * lock gate used to key by `toLowerCase()` alone, so a padded address read
 * (and cleared) a key beside the real account's.
 */

interface Captured {
  text: string;
  values: unknown[];
}

function fakeSql(): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({
      text: strings.join('$?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service only tags queries on it
const asTx = (sql: Sql): TransactionSql => sql as unknown as TransactionSql;

describe('login attempt keys are canonical', () => {
  it('getLockState reads the trimmed, lowercased key', async () => {
    const { sql, queries } = fakeSql();
    await getLockState(sql, '  User@Example.com ');
    expect(queries[0]?.text).toContain('FROM app.login_attempts WHERE email');
    expect(queries[0]?.values).toEqual(['user@example.com']);
  });

  it('clearOnSuccess deletes the canonical key', async () => {
    const { sql, queries } = fakeSql();
    await clearOnSuccess(asTx(sql), { email: ' User@Example.com' });
    expect(queries[0]?.text).toBe(
      'DELETE FROM app.login_attempts WHERE email = $?',
    );
    expect(queries[0]?.values).toEqual(['user@example.com']);
  });

  it('recordBlocked resolves the account by the canonical key', async () => {
    const { sql, queries } = fakeSql();
    await recordBlocked(asTx(sql), { email: 'User@Example.com  ' });
    expect(queries[0]?.text).toContain('FROM "user" WHERE lower("email")');
    expect(queries[0]?.values).toEqual(['user@example.com']);
  });
});
