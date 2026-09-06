import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createMember } from './service.ts';

/**
 * The member-creation door the settings UI uses (`POST /users/members`) must
 * carry the same governance side-effects as `POST /members`: the member row,
 * the `add_member` audit row and the `member` realtime hint commit in ONE
 * transaction — for an existing user and for a freshly signed-up one (whose
 * rotation anchor rides the same transaction). Pinned against a recording
 * `Sql` whose `begin` hands the recording tag back as the tx.
 */

const ORG_ID = 'org-under-test';
const ADMIN_ID = 'user-admin';
const EXISTING_USER_ID = 'user-existing';
const NEW_USER_ID = 'user-new';

interface Statement {
  text: string;
  values: unknown[];
}

interface Scenario {
  callerRole: string | null;
  /** The email already belongs to a user. */
  existingUser: boolean;
  /** …who is already a member of the org. */
  alreadyMember?: boolean;
}

function createRecordingSql(scenario: Scenario): {
  sql: Sql;
  statements: Statement[];
  transactions: number;
} {
  const statements: Statement[] = [];
  const state = { transactions: 0 };
  const answer = (text: string, values: unknown[]): unknown[] => {
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role" FROM "member"',
      )
    ) {
      const userId = values[1];
      if (userId === ADMIN_ID) {
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
      return scenario.alreadyMember
        ? [
            {
              id: 'member-existing',
              organizationId: ORG_ID,
              userId,
              role: 'member',
            },
          ]
        : [];
    }
    if (text.startsWith('SELECT "id" FROM "user" WHERE lower("email")')) {
      return scenario.existingUser ? [{ id: EXISTING_USER_ID }] : [];
    }
    if (text.startsWith('SELECT "email" FROM "user"')) {
      return [{ email: 'target@acme.test' }];
    }
    if (text.startsWith('INSERT INTO "member"')) {
      return [{ id: 'member-new' }];
    }
    if (text.startsWith('INSERT INTO app.audit_chain_heads')) {
      return [];
    }
    if (text.includes('FROM app.audit_chain_heads')) {
      return [{ lastHash: '', lastTs: 0 }];
    }
    if (text.startsWith('INSERT INTO app.audit_logs')) {
      return [{ id: 'audit-1' }];
    }
    if (/^(INSERT|UPDATE|DELETE)\b/.test(text)) {
      return [];
    }
    throw new Error(`unexpected SQL in recording sql: ${text}`);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (
      _options: string,
      callback: (tx: TransactionSql) => Promise<unknown>,
    ) => {
      state.transactions += 1;
      statements.push({ text: 'BEGIN', values: [] });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the recording tag doubles as the tx
      return callback(tag as unknown as TransactionSql).then((result) => {
        statements.push({ text: 'COMMIT', values: [] });
        return result;
      });
    },
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
    sql: tag as unknown as Sql,
    statements,
    get transactions() {
      return state.transactions;
    },
  };
}

function createAuthStub(): {
  auth: Auth;
  signUpEmail: ReturnType<typeof vi.fn>;
} {
  const signUpEmail = vi.fn().mockResolvedValue({ user: { id: NEW_USER_ID } });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only signUpEmail is reached
  const auth = { api: { signUpEmail } } as unknown as Auth;
  return { auth, signUpEmail };
}

const isWrite = (statement: Statement): boolean =>
  /^(DELETE|UPDATE|INSERT)\b/.test(statement.text);

/** `DELETE FROM x` / `INSERT INTO x` / `UPDATE x` — the write and its table. */
const writeHead = (text: string): string | undefined =>
  /^((?:DELETE FROM|INSERT INTO|UPDATE) [\w."]+)/.exec(text)?.[1];

const AUDIT_WRITES = [
  'INSERT INTO app.audit_chain_heads',
  'INSERT INTO app.audit_logs',
  'UPDATE app.audit_chain_heads',
];

/** The writes issued between BEGIN and COMMIT, in order. */
function transactionWrites(statements: Statement[]): string[] {
  const begin = statements.findIndex((s) => s.text === 'BEGIN');
  const commit = statements.findIndex((s) => s.text === 'COMMIT');
  return statements
    .slice(begin + 1, commit)
    .filter(isWrite)
    .map((s) => s.text);
}

describe('createMember', () => {
  it('adds an existing user through addMember: member row, add_member audit and member hint in one tx', async () => {
    const { sql, statements } = createRecordingSql({
      callerRole: 'admin',
      existingUser: true,
    });
    const { auth, signUpEmail } = createAuthStub();

    await expect(
      createMember(
        { sql, auth },
        { userId: ADMIN_ID, email: 'admin@acme.test' },
        { organizationId: ORG_ID, email: 'Target@Acme.test', role: 'editor' },
      ),
    ).resolves.toEqual({
      userId: EXISTING_USER_ID,
      memberId: 'member-new',
      isExistingUser: true,
    });
    expect(signUpEmail).not.toHaveBeenCalled();

    const writes = transactionWrites(statements);
    expect(writes.map(writeHead)).toEqual([
      'INSERT INTO "member"',
      ...AUDIT_WRITES,
      'INSERT INTO app_realtime.outbox',
    ]);
    // Nothing is written outside the transaction.
    expect(statements.filter(isWrite)).toHaveLength(writes.length);
    // The member row carries the requested role; the hint names the org.
    const memberInsert = statements.find((s) =>
      s.text.startsWith('INSERT INTO "member"'),
    );
    expect(memberInsert?.values).toEqual(
      expect.arrayContaining([ORG_ID, EXISTING_USER_ID, 'editor']),
    );
    const hint = statements.find((s) =>
      s.text.startsWith('INSERT INTO app_realtime.outbox'),
    );
    expect(hint?.values).toEqual([ORG_ID, null, 'member', EXISTING_USER_ID]);
  });

  it('signs a new user up, then adds them and anchors the forced password change in one tx', async () => {
    const { sql, statements } = createRecordingSql({
      callerRole: 'owner',
      existingUser: false,
    });
    const { auth, signUpEmail } = createAuthStub();

    await expect(
      createMember(
        { sql, auth },
        { userId: ADMIN_ID },
        {
          organizationId: ORG_ID,
          email: 'New@Acme.test',
          password: 'Temp-Password-123!',
          displayName: 'New Person',
        },
      ),
    ).resolves.toEqual({
      userId: NEW_USER_ID,
      memberId: 'member-new',
      isExistingUser: false,
    });
    expect(signUpEmail).toHaveBeenCalledWith({
      body: {
        email: 'new@acme.test',
        password: 'Temp-Password-123!',
        name: 'New Person',
      },
    });

    const writes = transactionWrites(statements);
    expect(writes.map(writeHead)).toEqual([
      'INSERT INTO "member"',
      ...AUDIT_WRITES,
      'INSERT INTO app_realtime.outbox',
      'INSERT INTO app.user_password_metadata',
    ]);
    expect(statements.filter(isWrite)).toHaveLength(writes.length);
    const anchor = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.user_password_metadata'),
    );
    // force_change_on_next_login = true for an admin-chosen password.
    expect(anchor?.values).toEqual(expect.arrayContaining([NEW_USER_ID, true]));
  });

  it('refuses a duplicate membership with the members domain code and writes nothing', async () => {
    const { sql, statements } = createRecordingSql({
      callerRole: 'admin',
      existingUser: true,
      alreadyMember: true,
    });
    const { auth } = createAuthStub();

    await expect(
      createMember(
        { sql, auth },
        { userId: ADMIN_ID },
        { organizationId: ORG_ID, email: 'target@acme.test' },
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_MEMBER', status: 400 });
    expect(statements.filter(isWrite)).toEqual([]);
  });

  it('refuses a non-admin caller before any sign-up or write', async () => {
    const { sql, statements } = createRecordingSql({
      callerRole: 'member',
      existingUser: false,
    });
    const { auth, signUpEmail } = createAuthStub();

    await expect(
      createMember(
        { sql, auth },
        { userId: ADMIN_ID },
        { organizationId: ORG_ID, email: 'x@acme.test', password: 'pw' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(statements.filter(isWrite)).toEqual([]);
  });
});
