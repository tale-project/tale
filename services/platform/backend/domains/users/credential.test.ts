import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  forcedResetCredentialPassword,
  setCredentialPassword,
} from './service.ts';

vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn((password: string) =>
    Promise.resolve(`hashed:${password}`),
  ),
  verifyPassword: vi.fn(
    ({ hash, password }: { hash: string; password: string }) =>
      Promise.resolve(hash === `hashed:${password}`),
  ),
}));

/**
 * A user has at most ONE credential (`providerId = 'credential'`) account
 * row. Better Auth owns the `account` table and declares no unique key on
 * (userId, providerId), so the old `INSERT … ON CONFLICT DO NOTHING` had no
 * conflict target and inserted a second row on every admin reset; the
 * user's forced first-login change then rotated only one of them and the
 * temporary password kept working. The setter now decides inside the
 * caller's serializable transaction: create the row when there is none,
 * otherwise update the newest and fold any duplicates into it.
 */

const USER_ID = 'user-target';
const HASH = 'argon2-hash';

interface Statement {
  text: string;
  values: unknown[];
}

function createRecordingTx(existing: { id: string }[]): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const answer = (text: string): unknown[] => {
    if (text.startsWith('SELECT "id" FROM "account"')) {
      return existing;
    }
    if (/^(INSERT|UPDATE|DELETE)\b/.test(text)) {
      return [];
    }
    throw new Error(`unexpected SQL in recording tx: ${text}`);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { tx: tag as unknown as TransactionSql, statements };
}

const writes = (statements: Statement[]): Statement[] =>
  statements.filter((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s.text));

describe('setCredentialPassword', () => {
  it('creates the one credential row for a user without a password', async () => {
    const { tx, statements } = createRecordingTx([]);
    await setCredentialPassword(tx, USER_ID, HASH);
    const w = writes(statements);
    expect(w).toHaveLength(1);
    expect(w[0]?.text).toMatch(/^INSERT INTO "account"/);
    expect(w[0]?.values).toEqual(expect.arrayContaining([USER_ID, HASH]));
    // The lookup locks the rows it decides on (serializable + FOR UPDATE).
    expect(statements[0]?.text).toMatch(/FOR UPDATE/);
  });

  it('updates the existing row in place — never a second INSERT', async () => {
    const { tx, statements } = createRecordingTx([{ id: 'acct-1' }]);
    await setCredentialPassword(tx, USER_ID, HASH);
    const w = writes(statements);
    expect(w.map((s) => s.text.split(' ').slice(0, 2).join(' '))).toEqual([
      'UPDATE "account"',
    ]);
    expect(w[0]?.values).toEqual(expect.arrayContaining([HASH, 'acct-1']));
    expect(statements.some((s) => s.text.startsWith('INSERT'))).toBe(false);
  });

  it('folds duplicate rows left by the old blind INSERT into the newest one', async () => {
    const { tx, statements } = createRecordingTx([
      { id: 'acct-newest' },
      { id: 'acct-older' },
      { id: 'acct-oldest' },
    ]);
    await setCredentialPassword(tx, USER_ID, HASH);
    const w = writes(statements);
    const del = w.find((s) => s.text.startsWith('DELETE FROM "account"'));
    const upd = w.find((s) => s.text.startsWith('UPDATE "account"'));
    expect(del?.values).toEqual([
      USER_ID,
      expect.arrayContaining(['acct-older', 'acct-oldest']),
    ]);
    expect(upd?.values).toEqual(expect.arrayContaining([HASH, 'acct-newest']));
    expect(statements.some((s) => s.text.startsWith('INSERT'))).toBe(false);
  });
});

describe('forcedResetCredentialPassword', () => {
  function createRecordingSql(credentials: { password: string | null }[]): {
    sql: Sql;
    statements: Statement[];
  } {
    const statements: Statement[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      if (text.startsWith('SELECT "password" FROM "account"')) {
        return Promise.resolve(credentials);
      }
      if (text.startsWith('UPDATE "account"')) {
        return Promise.resolve([]);
      }
      throw new Error(`unexpected SQL in recording sql: ${text}`);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
    return { sql: tag as unknown as Sql, statements };
  }

  it('rotates EVERY credential row of the user — keyed by (user, provider), never by one row id', async () => {
    const { sql, statements } = createRecordingSql([
      { password: 'hashed:temp-pass' },
    ]);

    await forcedResetCredentialPassword(sql, USER_ID, 'new-pass');

    const updates = writes(statements);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.text).toBe(
      'UPDATE "account" SET "password" = $, "updatedAt" = $ WHERE "userId" = $ AND "providerId" = \'credential\'',
    );
    expect(updates[0]?.values).toContain(USER_ID);
    expect(updates[0]?.values).toContain('hashed:new-pass');
  });

  it('refuses the password the credential already carries, before any write', async () => {
    const { sql, statements } = createRecordingSql([
      { password: 'hashed:same-pass' },
    ]);

    await expect(
      forcedResetCredentialPassword(sql, USER_ID, 'same-pass'),
    ).rejects.toMatchObject({ code: 'password_reused', status: 400 });
    expect(writes(statements)).toHaveLength(0);
  });

  it('answers 404 for a user without a credential row instead of inventing one', async () => {
    const { sql, statements } = createRecordingSql([]);

    await expect(
      forcedResetCredentialPassword(sql, USER_ID, 'new-pass'),
    ).rejects.toMatchObject({ code: 'credential_account_not_found' });
    expect(writes(statements)).toHaveLength(0);
  });
});
