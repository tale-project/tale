// @vitest-environment node

/**
 * A password confirmed by a signed-in person (`auth/reauthenticate.ts`)
 * counts like a sign-in and writes the same audit rows — stamped, so a
 * reader of the log can tell "confirmed the password to add a passkey" from
 * "signed in". A real sign-in's rows stay as they were.
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

import { clearOnSuccess, recordFailure } from './service.ts';

/** One account, a member of one organization, with no failures yet. */
function accountTx(): TransactionSql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT "id" FROM "user"')) {
      return Promise.resolve([{ id: 'user-1' }]);
    }
    if (text.startsWith('SELECT "organizationId", "role" FROM "member"')) {
      return Promise.resolve([{ organizationId: 'org-1', role: 'member' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return tag as unknown as TransactionSql & Sql;
}

const auditRows = () =>
  h.createAuditLog.mock.calls.map(
    (call) => call[1] as { action: string; metadata?: unknown },
  );

describe('the lockout audit rows of a re-authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps a confirmed password, and leaves a sign-in unstamped', async () => {
    await clearOnSuccess(accountTx(), {
      email: 'ada@example.test',
      reauthentication: true,
    });
    await clearOnSuccess(accountTx(), { email: 'ada@example.test' });

    expect(auditRows()).toEqual([
      expect.objectContaining({
        action: 'login_success',
        metadata: { reauthentication: true },
      }),
      expect.not.objectContaining({ metadata: expect.anything() }),
    ]);
  });

  it('stamps a wrong password beside the failure count', async () => {
    await recordFailure(accountTx(), {
      email: 'ada@example.test',
      reauthentication: true,
    });
    await recordFailure(accountTx(), { email: 'ada@example.test' });

    const [confirmation, signIn] = auditRows();
    expect(confirmation).toMatchObject({
      action: 'login_attempt',
      metadata: { consecutiveFailures: 1, reauthentication: true },
    });
    expect(signIn).toMatchObject({ action: 'login_attempt' });
    expect(signIn?.metadata).not.toHaveProperty('reauthentication');
  });
});
