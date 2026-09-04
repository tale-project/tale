import type { PgBoss } from 'pg-boss';
import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { MembershipError } from '../../auth/membership.ts';
import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  deleteOrganization,
  describeOrganizationHoldBlock,
  OrganizationError,
} from './service.ts';

/**
 * The deletion door's contract, proven against a recording transaction:
 * every guard runs before the first write (a refusal writes NOTHING and
 * enqueues nothing), the teardown order is audit → cascade → Better Auth
 * rows → org row → cleanup job, every write is keyed by the organization
 * id, and the `"user"` table is never deleted from (a shared user keeps
 * their account). The real-Postgres commit/rollback proof lives in
 * `backend/integration-check.ts` (`checkOrganizationLifecycle`).
 */

const ORG_ID = 'org-under-test';
const OWNER_ID = 'user-owner';

interface Statement {
  text: string;
  values: unknown[];
}

interface Scenario {
  memberRole: string | null;
  slug: string | null;
  holds: { targetType: string; targetId: string }[];
  /** Rows the final `DELETE FROM "organization" … RETURNING` answers. */
  orgDeleteReturns?: { id: string }[];
}

function createRecordingTx(scenario: Scenario): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const answer = (text: string): unknown[] => {
    if (
      text.startsWith(
        'SELECT "id", "organizationId", "userId", "role" FROM "member"',
      )
    ) {
      return scenario.memberRole === null
        ? []
        : [
            {
              id: 'member-1',
              organizationId: ORG_ID,
              userId: OWNER_ID,
              role: scenario.memberRole,
            },
          ];
    }
    if (text.startsWith('SELECT "slug" FROM "organization"')) {
      return scenario.slug === null ? [] : [{ slug: scenario.slug }];
    }
    if (text.includes('FROM app.legal_holds')) {
      return scenario.holds;
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
    if (text.startsWith('DELETE FROM "organization"')) {
      return scenario.orgDeleteReturns ?? [{ id: ORG_ID }];
    }
    if (/^(DELETE|UPDATE)\b/.test(text)) {
      return [];
    }
    throw new Error(`unexpected SQL in recording tx: ${text}`);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
  };
  // The audit writer serializes JSON columns through `tx.json`; the value
  // itself is irrelevant here.
  Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { tx: tag as unknown as TransactionSql, statements };
}

function installFakeBoss(): {
  name: string;
  data: unknown;
  options: unknown;
}[] {
  const sends: { name: string; data: unknown; options: unknown }[] = [];
  const fake = {
    send: (name: string, data: unknown, options: unknown) => {
      sends.push({ name, data, options });
      return Promise.resolve('job-id');
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture stub; addJobInTx only calls send()
  setEnqueueBoss(fake as unknown as PgBoss);
  return sends;
}

const isWrite = (statement: Statement): boolean =>
  /^(DELETE|UPDATE|INSERT)\b/.test(statement.text);

afterEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reset the module-level boss between tests
  setEnqueueBoss(null as unknown as PgBoss);
});

describe('describeOrganizationHoldBlock', () => {
  it('lets an organization without active holds through', () => {
    expect(
      describeOrganizationHoldBlock({
        orgHeld: false,
        userMembershipIds: new Set(),
      }),
    ).toBeNull();
  });

  it('blocks on an org-wide hold', () => {
    const block = describeOrganizationHoldBlock({
      orgHeld: true,
      userMembershipIds: new Set(),
    });
    expect(block).toBeInstanceOf(LegalHoldError);
    expect(block?.code).toBe('LEGAL_HOLD_ACTIVE');
    expect(block?.status).toBe(409);
    expect(block?.message).toMatch(
      /organization is under an active legal hold/,
    );
  });

  it('blocks on any custodian hold, naming how many members are held', () => {
    const one = describeOrganizationHoldBlock({
      orgHeld: false,
      userMembershipIds: new Set(['u1']),
    });
    expect(one?.code).toBe('LEGAL_HOLD_ACTIVE');
    expect(one?.message).toMatch(/^1 member of this organization is under/);

    const two = describeOrganizationHoldBlock({
      orgHeld: false,
      userMembershipIds: new Set(['u1', 'u2']),
    });
    expect(two?.status).toBe(409);
    expect(two?.message).toMatch(/^2 members of this organization are under/);
  });
});

describe('deleteOrganization', () => {
  it('refuses under an org-wide hold without writing or enqueuing anything', async () => {
    const sends = installFakeBoss();
    const { tx, statements } = createRecordingTx({
      memberRole: 'owner',
      slug: 'acme',
      holds: [{ targetType: 'org', targetId: ORG_ID }],
    });

    await expect(
      deleteOrganization(tx, { userId: OWNER_ID }, ORG_ID),
    ).rejects.toMatchObject({ code: 'LEGAL_HOLD_ACTIVE', status: 409 });

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter(isWrite)).toEqual([]);
    expect(sends).toEqual([]);
  });

  it('refuses under a custodian hold on any member — nothing is written', async () => {
    const sends = installFakeBoss();
    const { tx, statements } = createRecordingTx({
      memberRole: 'owner',
      slug: 'acme',
      holds: [{ targetType: 'userMembership', targetId: 'some-other-member' }],
    });

    await expect(
      deleteOrganization(tx, { userId: OWNER_ID }, ORG_ID),
    ).rejects.toBeInstanceOf(LegalHoldError);
    expect(statements.filter(isWrite)).toEqual([]);
    expect(sends).toEqual([]);
  });

  it('refuses non-owners and the default organization before any write', async () => {
    const sends = installFakeBoss();
    const admin = createRecordingTx({
      memberRole: 'admin',
      slug: 'acme',
      holds: [],
    });
    await expect(
      deleteOrganization(admin.tx, { userId: OWNER_ID }, ORG_ID),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(admin.statements.filter(isWrite)).toEqual([]);

    const stranger = createRecordingTx({
      memberRole: null,
      slug: 'acme',
      holds: [],
    });
    await expect(
      deleteOrganization(stranger.tx, { userId: OWNER_ID }, ORG_ID),
    ).rejects.toBeInstanceOf(MembershipError);
    expect(stranger.statements.filter(isWrite)).toEqual([]);

    const defaultOrg = createRecordingTx({
      memberRole: 'owner',
      slug: 'default',
      holds: [],
    });
    await expect(
      deleteOrganization(defaultOrg.tx, { userId: OWNER_ID }, ORG_ID),
    ).rejects.toMatchObject({ code: 'DEFAULT_ORG_PROTECTED', status: 400 });
    expect(defaultOrg.statements.filter(isWrite)).toEqual([]);

    expect(sends).toEqual([]);
  });

  it('tears down in order — guards, audit, cascade, Better Auth rows, org row, cleanup job', async () => {
    const sends = installFakeBoss();
    const { tx, statements } = createRecordingTx({
      memberRole: 'owner',
      slug: 'acme',
      holds: [],
    });

    await expect(
      deleteOrganization(
        tx,
        { userId: OWNER_ID, email: 'o@acme.test' },
        ORG_ID,
      ),
    ).resolves.toEqual({ orgSlug: 'acme' });

    // Every guard read precedes the first write; the hold read is the last
    // guard.
    const firstWrite = statements.findIndex(isWrite);
    const holdRead = statements.findIndex((s) =>
      /FROM app\.legal_holds/.test(s.text),
    );
    expect(holdRead).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(holdRead);

    const writes = statements.filter(isWrite).map((s) => s.text);
    const auditInsert = writes.findIndex((t) =>
      t.startsWith('INSERT INTO app.audit_logs'),
    );
    const firstDelete = writes.findIndex((t) => t.startsWith('DELETE FROM'));
    expect(auditInsert).toBeGreaterThanOrEqual(0);
    expect(auditInsert).toBeLessThan(firstDelete);

    const deletes = writes.filter((t) => t.startsWith('DELETE FROM'));
    expect(deletes.map((t) => /^DELETE FROM ([\w."]+)/.exec(t)?.[1])).toEqual([
      'app.user_preferences',
      'app.memories',
      'app.sso_synced_team_members',
      'app.sso_synced_teams',
      '"teamMember"',
      '"team"',
      '"invitation"',
      '"member"',
      '"organization"',
    ]);

    // Tenant isolation: every cascade/teardown statement is bound to THIS
    // organization's id; the user table is only ever pointer-reset.
    for (const statement of statements.filter(isWrite)) {
      if (statement.text.startsWith('INSERT INTO app.audit')) continue;
      expect(statement.values).toContain(ORG_ID);
    }
    expect(writes.some((t) => t.startsWith('DELETE FROM "user"'))).toBe(false);
    expect(
      writes.some((t) =>
        t.startsWith('UPDATE "user" SET "lastActiveOrganizationId" = NULL'),
      ),
    ).toBe(true);

    // The cleanup job rides the same transaction, keyed by the slug.
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      name: 'org.cleanup_files',
      data: { orgSlug: 'acme' },
      options: { singletonKey: 'org-cleanup:acme' },
    });
    // …and only after the org row is gone.
    expect(writes.at(-1)).toMatch(/^DELETE FROM "organization"/);
  });

  it('fails (so the transaction rolls back) when a concurrent deletion won', async () => {
    installFakeBoss();
    const { tx } = createRecordingTx({
      memberRole: 'owner',
      slug: 'acme',
      holds: [],
      orgDeleteReturns: [],
    });
    await expect(
      deleteOrganization(tx, { userId: OWNER_ID }, ORG_ID),
    ).rejects.toMatchObject({ code: 'ORG_NOT_FOUND', status: 404 });
    // (An OrganizationError, not a silent success.)
    await expect(
      deleteOrganization(
        createRecordingTx({
          memberRole: 'owner',
          slug: 'acme',
          holds: [],
          orgDeleteReturns: [],
        }).tx,
        { userId: OWNER_ID },
        ORG_ID,
      ),
    ).rejects.toBeInstanceOf(OrganizationError);
  });
});
