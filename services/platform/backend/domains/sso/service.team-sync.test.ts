// @vitest-environment node

/**
 * The SSO group→team sync's AUDIT trail. The sync creates teams, grants and
 * revokes memberships and reaps the teams it created, and before this it did
 * so with no row in the organization's audit log — a membership an identity
 * provider composed was indistinguishable from one nobody could explain.
 * Each write now rides one transaction with its `team.*` row under the
 * sync's own identity (`actorId: 'sso'`, the SCIM posture).
 *
 * Driven against a statement-answering `sql` stand-in; the audit writer and
 * the scope retirement are spies.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog, retireTeamScopes, resyncRetiredDocumentScopes } =
  vi.hoisted(() => ({
    createAuditLog: vi.fn(),
    retireTeamScopes: vi.fn(),
    resyncRetiredDocumentScopes: vi.fn(),
  }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../teams/service.ts', () => ({
  retireTeamScopes,
  resyncRetiredDocumentScopes,
}));

import { syncTeamsFromGroupNames } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

const RETIREMENT = {
  projectsRetagged: 1,
  foldersRetagged: 0,
  documentsRetagged: 0,
  conversationsUnassigned: 0,
  syncConfigsUnscoped: 0,
  nowOrgWide: { projects: 1, folders: 0, documents: 0 },
  touchedFileDocumentIds: [],
};

const ARGS = {
  userId: 'user-1',
  userEmail: 'ada@example.test',
  organizationId: 'org-1',
  excludeGroups: [],
};

const audited = () => createAuditLog.mock.calls.map((call) => call[1]);

beforeEach(() => {
  vi.clearAllMocks();
  retireTeamScopes.mockResolvedValue(RETIREMENT);
});

describe('syncTeamsFromGroupNames — audit rows', () => {
  it('records the team it creates and the membership it grants, as the sync', async () => {
    const { sql, statements } = fakeSql((s) => {
      if (s.text.startsWith('INSERT INTO "team" (')) return [{ id: 'team-1' }];
      if (s.text.startsWith('INSERT INTO "teamMember"'))
        return [{ id: 'tm-1' }];
      return undefined;
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...ARGS,
      groupNames: ['Finance'],
    });

    expect(result).toEqual({
      teamsCreated: 1,
      membershipsAdded: 1,
      membershipsRemoved: 0,
      errors: [],
    });
    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'sso',
        actorType: 'system',
        action: 'team.created',
        category: 'member',
        resourceType: 'team',
        resourceId: 'team-1',
        resourceName: 'Finance',
        newState: { name: 'Finance' },
        metadata: { door: 'sso' },
        status: 'success',
      }),
      expect.objectContaining({
        actorId: 'sso',
        actorType: 'system',
        action: 'team.member_added',
        resourceId: 'team-1',
        resourceName: 'Finance',
        metadata: {
          userId: 'user-1',
          teamMemberId: 'tm-1',
          targetEmail: 'ada@example.test',
          door: 'sso',
        },
      }),
    ]);
    // Both rows were written on the transaction the group's writes ride.
    expect(createAuditLog).toHaveBeenCalledWith(sql, expect.anything());
    expect(
      statements.some((s) => s.text.startsWith('INSERT INTO "teamMember"')),
    ).toBe(true);
  });

  it('records nothing for a group whose team and membership already exist', async () => {
    const { sql } = fakeSql((s) => {
      if (s.text.startsWith('SELECT "id", "name" FROM "team"')) {
        return [{ id: 'team-1', name: 'Finance' }];
      }
      if (s.text.startsWith('SELECT "id" FROM "teamMember"')) {
        return [{ id: 'tm-1' }];
      }
      return undefined;
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...ARGS,
      groupNames: ['finance'],
    });

    expect(result.teamsCreated).toBe(0);
    expect(result.membershipsAdded).toBe(0);
    expect(audited()).toEqual([]);
  });

  it('records the membership it revokes and the empty team it reaps', async () => {
    const { sql } = fakeSql((s) => {
      // The reconcile read: one provenance row whose group left the claim.
      if (s.text.includes('FROM app.sso_synced_team_members p')) {
        return [{ teamId: 'team-9', teamName: 'Legacy', membershipId: 'tm-9' }];
      }
      // The reap verdict: the sync created it, it is empty, SCIM owns nothing.
      if (s.text.includes('AS "syncCreated"')) {
        return [
          {
            name: 'Legacy',
            empty: true,
            syncCreated: true,
            scimManaged: false,
          },
        ];
      }
      return undefined;
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...ARGS,
      groupNames: [],
    });

    expect(result.membershipsRemoved).toBe(1);
    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'sso',
        action: 'team.member_removed',
        resourceId: 'team-9',
        resourceName: 'Legacy',
        metadata: {
          userId: 'user-1',
          teamMemberId: 'tm-9',
          targetEmail: 'ada@example.test',
          door: 'sso',
        },
      }),
      expect.objectContaining({
        actorId: 'sso',
        action: 'team.deleted',
        resourceId: 'team-9',
        resourceName: 'Legacy',
        metadata: expect.objectContaining({
          door: 'sso',
          projectsRetagged: 1,
        }),
      }),
    ]);
    expect(resyncRetiredDocumentScopes).toHaveBeenCalledWith(
      sql,
      'org-1',
      RETIREMENT,
    );
  });

  // A failed group is reported and the next one still runs — the audit row
  // rolls back with the group's writes, so no row describes a membership
  // that never landed.
  it('reports a group whose transaction failed and keeps going', async () => {
    createAuditLog.mockRejectedValueOnce(new Error('chain locked'));
    const { sql } = fakeSql((s) => {
      if (s.text.startsWith('INSERT INTO "team" (')) {
        return [{ id: `team-${s.values[0] as string}` }];
      }
      if (s.text.startsWith('INSERT INTO "teamMember"')) return [{ id: 'tm' }];
      return undefined;
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...ARGS,
      groupNames: ['Alpha', 'Beta'],
    });

    expect(result.errors).toEqual(['Failed to sync group Alpha: chain locked']);
    expect(result.teamsCreated).toBe(1);
    expect(result.membershipsAdded).toBe(1);
  });
});
