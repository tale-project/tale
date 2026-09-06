import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  MemberServiceError,
  resetTwoFactorForMember,
  revokePasskeyForMember,
} from './service.ts';

/**
 * The admin factor-removal doors (passkey revocation, 2FA reset) run as ONE
 * transaction: every table mutation and the audit row go through the
 * caller's `tx`, so a failure anywhere — including the audit insert — rolls
 * the whole action back. Pinned against a recording transaction: no
 * statement ever leaves the tx (no `begin`, no bare pool), the guard reads
 * precede the first write, and an audit failure surfaces after the writes
 * were issued on that same tx (which is what makes the rollback cover them).
 */

const ORG_ID = 'org-under-test';
const ADMIN_ID = 'user-admin';
const TARGET_USER_ID = 'user-target';
const TARGET_MEMBER_ID = 'member-target';

interface Statement {
  text: string;
  values: unknown[];
}

interface Scenario {
  /** The caller's role in the org, or null when not a member. */
  callerRole: string | null;
  targetRole?: string;
  /** Rows the passkey DELETE … RETURNING answers. */
  passkeyDeleteReturns?: { id: string }[];
  /** Make the audit insert fail (a ledger write error). */
  auditFails?: boolean;
}

function createRecordingTx(scenario: Scenario): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const answer = (text: string): unknown[] => {
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role", "createdAt"',
      )
    ) {
      return [
        {
          id: TARGET_MEMBER_ID,
          organizationId: ORG_ID,
          userId: TARGET_USER_ID,
          role: scenario.targetRole ?? 'member',
          createdAt: '2026-01-01',
        },
      ];
    }
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role" FROM "member"',
      )
    ) {
      return scenario.callerRole === null
        ? []
        : [
            {
              id: 'member-admin',
              organizationId: ORG_ID,
              userId: ADMIN_ID,
              role: scenario.callerRole,
            },
          ];
    }
    if (text.startsWith('DELETE FROM "passkey"')) {
      return scenario.passkeyDeleteReturns ?? [{ id: 'pk-1' }];
    }
    if (
      text.startsWith('SELECT pg_advisory_xact_lock(') ||
      text.startsWith('INSERT INTO app.audit_chain_heads')
    ) {
      return [];
    }
    if (text.includes('FROM app.audit_chain_heads')) {
      return [{ lastHash: '', lastTs: 0 }];
    }
    if (text.startsWith('INSERT INTO app.audit_logs')) {
      if (scenario.auditFails) {
        throw new Error('audit ledger unavailable');
      }
      return [{ id: 'audit-1' }];
    }
    if (/^(DELETE|UPDATE)\b/.test(text)) {
      return [];
    }
    throw new Error(`unexpected SQL in recording tx: ${text}`);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    try {
      return Promise.resolve(answer(text));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  Object.assign(tag, {
    json: (value: unknown) => value,
    begin: () => {
      throw new Error('a nested transaction must never be opened');
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { tx: tag as unknown as TransactionSql, statements };
}

const isWrite = (statement: Statement): boolean =>
  /^(DELETE|UPDATE|INSERT)\b/.test(statement.text);

/** `DELETE FROM x` / `INSERT INTO x` / `UPDATE x` — the write and its table. */
const writeHead = (text: string): string | undefined =>
  /^((?:DELETE FROM|INSERT INTO|UPDATE) [\w."]+)/.exec(text)?.[1];

/** The audit writer's own three statements, in order. */
const AUDIT_WRITES = [
  'INSERT INTO app.audit_chain_heads',
  'INSERT INTO app.audit_logs',
  'UPDATE app.audit_chain_heads',
];

describe('revokePasskeyForMember', () => {
  it('deletes the passkey, the sessions and writes the audit row on the one tx', async () => {
    const { tx, statements } = createRecordingTx({ callerRole: 'admin' });
    await revokePasskeyForMember(
      tx,
      { userId: ADMIN_ID, email: 'admin@acme.test' },
      { memberId: TARGET_MEMBER_ID, passkeyId: 'pk-1' },
    );
    const writes = statements.filter(isWrite).map((s) => s.text);
    expect(writes.map(writeHead)).toEqual([
      'DELETE FROM "passkey"',
      'DELETE FROM "session"',
      ...AUDIT_WRITES,
    ]);
    // Every guard read precedes the first write.
    const firstWrite = statements.findIndex(isWrite);
    expect(firstWrite).toBeGreaterThan(1);
    // The passkey delete is bound to the TARGET's user id (IDOR guard).
    const passkeyDelete = statements.find((s) =>
      s.text.startsWith('DELETE FROM "passkey"'),
    );
    expect(passkeyDelete?.values).toEqual(['pk-1', TARGET_USER_ID]);
  });

  it('surfaces an audit failure AFTER the deletes were issued on the same tx (rollback covers them)', async () => {
    const { tx, statements } = createRecordingTx({
      callerRole: 'admin',
      auditFails: true,
    });
    await expect(
      revokePasskeyForMember(
        tx,
        { userId: ADMIN_ID },
        { memberId: TARGET_MEMBER_ID, passkeyId: 'pk-1' },
      ),
    ).rejects.toThrow(/audit ledger unavailable/);
    const writes = statements.filter(isWrite).map((s) => s.text);
    expect(writes.some((t) => t.startsWith('DELETE FROM "passkey"'))).toBe(
      true,
    );
    expect(writes.some((t) => t.startsWith('DELETE FROM "session"'))).toBe(
      true,
    );
  });

  it('refuses a non-admin caller and an unknown passkey before any write', async () => {
    const stranger = createRecordingTx({ callerRole: 'member' });
    await expect(
      revokePasskeyForMember(
        stranger.tx,
        { userId: ADMIN_ID },
        { memberId: TARGET_MEMBER_ID, passkeyId: 'pk-1' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(stranger.statements.filter(isWrite)).toEqual([]);

    const missing = createRecordingTx({
      callerRole: 'admin',
      passkeyDeleteReturns: [],
    });
    await expect(
      revokePasskeyForMember(
        missing.tx,
        { userId: ADMIN_ID },
        { memberId: TARGET_MEMBER_ID, passkeyId: 'pk-other' },
      ),
    ).rejects.toBeInstanceOf(MemberServiceError);
    // The only write attempted is the (no-row) passkey delete; no session
    // sweep, no audit row.
    expect(missing.statements.filter(isWrite).map((s) => s.text)).toEqual([
      expect.stringMatching(/^DELETE FROM "passkey"/),
    ]);
  });
});

describe('resetTwoFactorForMember', () => {
  it('clears enrolment, flag, counters and sessions, then audits — all on the one tx', async () => {
    const { tx, statements } = createRecordingTx({ callerRole: 'owner' });
    await resetTwoFactorForMember(
      tx,
      { userId: ADMIN_ID, email: 'owner@acme.test' },
      TARGET_MEMBER_ID,
    );
    const writes = statements.filter(isWrite).map((s) => s.text);
    expect(writes.map(writeHead)).toEqual([
      'DELETE FROM "twoFactor"',
      'UPDATE "user"',
      'DELETE FROM app.two_factor_grace',
      'DELETE FROM app.two_factor_attempts',
      'DELETE FROM "session"',
      ...AUDIT_WRITES,
    ]);
    // Every mutation is bound to the target user.
    for (const statement of statements.filter(isWrite)) {
      if (/app\.audit_/.test(statement.text)) continue;
      expect(statement.values).toContain(TARGET_USER_ID);
    }
  });

  it('surfaces an audit failure after the reset statements were issued on the same tx', async () => {
    const { tx, statements } = createRecordingTx({
      callerRole: 'admin',
      auditFails: true,
    });
    await expect(
      resetTwoFactorForMember(tx, { userId: ADMIN_ID }, TARGET_MEMBER_ID),
    ).rejects.toThrow(/audit ledger unavailable/);
    const writes = statements.filter(isWrite).map((s) => s.text);
    expect(writes.some((t) => t.startsWith('DELETE FROM "twoFactor"'))).toBe(
      true,
    );
    expect(writes.some((t) => t.startsWith('UPDATE "user"'))).toBe(true);
  });

  it('lets only a DIFFERENT owner reset an owner, and never a self-target', async () => {
    const adminOnOwner = createRecordingTx({
      callerRole: 'admin',
      targetRole: 'owner',
    });
    await expect(
      resetTwoFactorForMember(
        adminOnOwner.tx,
        { userId: ADMIN_ID },
        TARGET_MEMBER_ID,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(adminOnOwner.statements.filter(isWrite)).toEqual([]);
  });
});
