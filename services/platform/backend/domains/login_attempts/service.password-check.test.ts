// @vitest-environment node

/**
 * A password typed somewhere other than the sign-in form — re-authentication,
 * or confirming an account change — counts like a sign-in and writes the same
 * audit rows, stamped `passwordCheck`, so a reader of the log can tell where
 * the password was typed. A real sign-in's rows stay as they were.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: h.createAuditLog,
}));
vi.mock('../notifications/service.ts', () => ({
  writeNotificationForOrgs: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
}));

import { clearFailures, clearOnSuccess, recordFailure } from './service.ts';

/** One account, a member of one organization, with no failures yet; the
 * statements it was asked. */
function accountTx(): {
  tx: TransactionSql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT "id" FROM "user"')) {
      return Promise.resolve([{ id: 'user-1' }]);
    }
    if (text.startsWith('SELECT "organizationId", "role" FROM "member"')) {
      return Promise.resolve([{ organizationId: 'org-1', role: 'member' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { tx: tag as unknown as TransactionSql & Sql, statements };
}

const auditRows = () =>
  h.createAuditLog.mock.calls.map(
    (call) => call[1] as { action: string; metadata?: unknown },
  );

describe('the lockout audit rows of a password check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps a re-authentication, and leaves a sign-in unstamped', async () => {
    await clearOnSuccess(accountTx().tx, {
      email: 'ada@example.test',
      passwordCheck: 'reauthenticate',
    });
    await clearOnSuccess(accountTx().tx, { email: 'ada@example.test' });

    expect(auditRows()).toEqual([
      expect.objectContaining({
        action: 'login_success',
        metadata: { passwordCheck: 'reauthenticate' },
      }),
      expect.not.objectContaining({ metadata: expect.anything() }),
    ]);
  });

  it('stamps a wrong password with where it was typed, beside the failure count', async () => {
    await recordFailure(accountTx().tx, {
      email: 'ada@example.test',
      passwordCheck: 'two_factor_disable',
    });
    await recordFailure(accountTx().tx, { email: 'ada@example.test' });

    const [confirmation, signIn] = auditRows();
    expect(confirmation).toMatchObject({
      action: 'login_attempt',
      metadata: { consecutiveFailures: 1, passwordCheck: 'two_factor_disable' },
    });
    expect(signIn).toMatchObject({ action: 'login_attempt' });
    expect(signIn?.metadata).not.toHaveProperty('passwordCheck');
  });

  it('clears only the counter for a confirmed account change', async () => {
    const { tx, statements } = accountTx();

    await clearFailures(tx, '  Ada@Example.test ');

    expect(statements).toEqual([
      {
        text: 'DELETE FROM app.login_attempts WHERE email = ?',
        values: ['ada@example.test'],
      },
    ]);
    expect(auditRows()).toEqual([]);
  });
});
