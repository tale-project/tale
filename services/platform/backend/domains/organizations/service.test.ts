import type { PgBoss } from 'pg-boss';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { MembershipError } from '../../auth/membership.ts';
import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import { MEMBER_ROLES } from '../members/service.ts';
import {
  deleteOrganization,
  describeOrganizationHoldBlock,
  listUserOrganizations,
  orderChildrenFirst,
  OrganizationError,
} from './service.ts';

/**
 * The deletion door's contract, proven against a recording transaction:
 * every guard runs before the first write (a refusal writes NOTHING and
 * enqueues nothing), the teardown order is audit → cascade over every
 * org-keyed app table the catalog lists (child before parent) → Better
 * Auth rows → org row → slug tombstone → cleanup job, every write is keyed
 * by the organization id, and the `"user"` table is never deleted from (a
 * shared user keeps their account). The real-Postgres commit/rollback proof lives in
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
  /** What `information_schema.columns` lists as org_id-bearing app tables. */
  orgTables?: string[];
  /** The app schema's foreign keys among them (child → parent). */
  fkEdges?: { child: string; parent: string }[];
}

/** A catalog slice with a two-level reference chain (tasks and bindings
 * reference projects), the ledger tables and the tombstone table — the
 * survivors — and the four tables the 0.5 deletion used to list by hand. */
const DEFAULT_ORG_TABLES = [
  'audit_logs',
  'automation_project_bindings',
  'memories',
  'organization_tombstones',
  'projects',
  'sso_synced_team_members',
  'sso_synced_teams',
  'tasks',
  'user_preferences',
];
const DEFAULT_FK_EDGES = [
  { child: 'tasks', parent: 'projects' },
  { child: 'automation_project_bindings', parent: 'projects' },
];

interface Identifier {
  identifier: string;
}
const isIdentifier = (value: unknown): value is Identifier =>
  typeof value === 'object' && value !== null && 'identifier' in value;

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
    if (text.includes('FROM information_schema.columns')) {
      return (scenario.orgTables ?? DEFAULT_ORG_TABLES).map((tableName) => ({
        tableName,
      }));
    }
    if (text.includes('FROM pg_constraint')) {
      return scenario.fkEdges ?? DEFAULT_FK_EDGES;
    }
    if (text.startsWith('INSERT INTO app.organization_tombstones')) {
      return [];
    }
    if (text.startsWith('DELETE FROM "organization"')) {
      return scenario.orgDeleteReturns ?? [{ id: ORG_ID }];
    }
    if (/^(DELETE|UPDATE)\b/.test(text)) {
      return [];
    }
    throw new Error(`unexpected SQL in recording tx: ${text}`);
  };
  const tag = (
    strings: TemplateStringsArray | string,
    ...values: unknown[]
  ) => {
    if (typeof strings === 'string') {
      // `tx('app.table')` — postgres.js's identifier helper; spliced into
      // the statement text below so the pin reads the table name.
      const identifier: Identifier = { identifier: strings };
      return identifier;
    }
    const text = strings.raw
      .map((part, index) => {
        const value = values[index];
        if (index === values.length) return part;
        return `${part}${isIdentifier(value) ? value.identifier : '$'}`;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    statements.push({ text, values: values.filter((v) => !isIdentifier(v)) });
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

describe('listUserOrganizations', () => {
  function sqlAnswering(
    rows: {
      organizationId: string;
      role: string;
      name: string;
      slug: string | null;
    }[],
  ): Sql {
    const tag = () => Promise.resolve(rows);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- read-only stub for an unconstructable third-party branded type
    return tag as unknown as Sql;
  }

  it('answers every assignable role verbatim — one membership, one role everywhere', async () => {
    const roles = MEMBER_ROLES.filter((role) => role !== 'disabled');
    const listed = await listUserOrganizations(
      sqlAnswering(
        roles.map((role, index) => ({
          organizationId: `org-${index}`,
          role,
          name: `Org ${index}`,
          slug: `org-${index}`,
        })),
      ),
      OWNER_ID,
    );
    // The regression: an 'editor' membership used to be listed as 'member'
    // here while /members/me answered 'editor' for the same row.
    expect(listed.map((o) => o.role)).toEqual(roles);
    expect(listed.map((o) => o.role)).toContain('editor');
  });

  it('drops disabled memberships and normalizes an off-vocabulary role to member', async () => {
    const listed = await listUserOrganizations(
      sqlAnswering([
        { organizationId: 'a', role: 'Disabled', name: 'A', slug: 'a' },
        { organizationId: 'b', role: 'viewer', name: 'B', slug: null },
        { organizationId: 'c', role: 'EDITOR', name: 'C', slug: 'c' },
      ]),
      OWNER_ID,
    );
    expect(listed).toEqual([
      { organizationId: 'b', role: 'member', name: 'B' },
      { organizationId: 'c', role: 'editor', name: 'C', slug: 'c' },
    ]);
  });
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

  it('tears down in order — guards, audit, cascade, Better Auth rows, org row, tombstone, cleanup job', async () => {
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

    // Every org-keyed app table the catalog lists, child before parent
    // (tasks and bindings reference projects) and alphabetical otherwise;
    // the governance ledger and the tombstone table are the deliberate
    // survivors — never a hand-kept list that a new table would miss.
    const deletes = writes.filter((t) => t.startsWith('DELETE FROM'));
    expect(deletes.map((t) => /^DELETE FROM ([\w."]+)/.exec(t)?.[1])).toEqual([
      'app.automation_project_bindings',
      'app.memories',
      'app.sso_synced_team_members',
      'app.sso_synced_teams',
      'app.tasks',
      'app.user_preferences',
      'app.projects',
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
    // …and only after the org row is gone. The slug tombstone is the last
    // write: the slug is reserved exactly when the row is, and stays so
    // until the job has removed what the slug keys outside this database.
    expect(writes.at(-2)).toMatch(/^DELETE FROM "organization"/);
    expect(writes.at(-1)).toMatch(/^INSERT INTO app.organization_tombstones/);
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

describe('orderChildrenFirst', () => {
  it('puts every referencing table before the table it references', () => {
    expect(
      orderChildrenFirst(
        ['projects', 'tasks', 'task_comments'],
        [
          { child: 'tasks', parent: 'projects' },
          { child: 'task_comments', parent: 'tasks' },
        ],
      ),
    ).toEqual(['task_comments', 'tasks', 'projects']);
  });

  it('is alphabetical among unreferenced tables and ignores edges outside the set and self-references', () => {
    expect(
      orderChildrenFirst(
        ['b', 'a', 'c'],
        [
          { child: 'a', parent: 'not-in-the-set' },
          { child: 'c', parent: 'c' },
        ],
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('appends a reference cycle deterministically instead of looping', () => {
    expect(
      orderChildrenFirst(
        ['y', 'x', 'leaf'],
        [
          { child: 'x', parent: 'y' },
          { child: 'y', parent: 'x' },
          { child: 'leaf', parent: 'x' },
        ],
      ),
    ).toEqual(['leaf', 'x', 'y']);
  });
});
