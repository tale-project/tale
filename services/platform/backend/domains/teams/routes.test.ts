// @vitest-environment node

/**
 * The teams door's ACCESS rules and its two new lanes: the directory every
 * member may read (names only), the delete preview and the atomic delete
 * (admins only, audited, corpus re-stamped after commit), a roster visible
 * to the team's own members and admins, and the last-member refusal both
 * removal doors share (`TEAM_LAST_MEMBER`, 409).
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEAM_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import type { OrgEnv } from '../../auth/org.ts';

const {
  caller,
  createAuditLog,
  deleteTeamInTx,
  emitHintInTx,
  resyncRetiredDocumentScopes,
  teamDeletionImpact,
} = vi.hoisted(() => ({
  caller: { role: 'admin', userId: 'u1' },
  createAuditLog: vi.fn(),
  deleteTeamInTx: vi.fn(),
  emitHintInTx: vi.fn(),
  resyncRetiredDocumentScopes: vi.fn(),
  teamDeletionImpact: vi.fn(),
}));

vi.mock('./service.ts', () => ({
  deleteTeamInTx,
  resyncRetiredDocumentScopes,
  teamDeletionImpact,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (sql: unknown, fn: (tx: unknown) => unknown) => fn(sql),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: caller.userId, email: 'u@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: caller.role } as never);
        await next();
      },
  };
});

import { createTeamRoutes } from './routes.ts';

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

const TEAM_ROW = (statement: Statement) =>
  statement.text.startsWith('SELECT "id" FROM "team" WHERE "id" = ?')
    ? [{ id: 't1' }]
    : undefined;

function mount(sql: Sql) {
  return createTeamRoutes({ sql, auth: {} as never });
}

const writes = (statements: Statement[]) =>
  statements.filter(
    (s) =>
      s.text.startsWith('INSERT') ||
      s.text.startsWith('UPDATE') ||
      s.text.startsWith('DELETE'),
  );

beforeEach(() => {
  vi.clearAllMocks();
  caller.role = 'admin';
  caller.userId = 'u1';
});

describe('GET /directory', () => {
  it('lists every team’s id and name of the organization for any member', async () => {
    caller.role = 'member';
    const { sql, statements } = fakeSql((s) =>
      s.text.startsWith('SELECT "id", "name" FROM "team"')
        ? [
            { id: 't-fin', name: 'Finance' },
            { id: 't-ops', name: 'Ops' },
          ]
        : undefined,
    );
    const res = await mount(sql).request('/directory');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      teams: [
        { id: 't-fin', name: 'Finance' },
        { id: 't-ops', name: 'Ops' },
      ],
    });
    // Scoped to the caller's organization, not the caller's memberships.
    expect(statements[0]?.text).toContain('WHERE "organizationId" = ?');
    expect(statements[0]?.values).toEqual(['o1']);
  });
});

describe('GET /:teamId/impact', () => {
  it('is an admin door', async () => {
    caller.role = 'member';
    const res = await mount(fakeSql(() => undefined).sql).request('/t1/impact');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'TEAM_FORBIDDEN' });
    expect(teamDeletionImpact).not.toHaveBeenCalled();
  });

  it('answers the preview, or 404 for a team that is not the organization’s', async () => {
    const impact = { teamId: 't1', name: 'Finance', memberCount: 2 };
    teamDeletionImpact.mockResolvedValueOnce(impact);
    const { sql } = fakeSql(() => undefined);
    const app = mount(sql);
    const res = await app.request('/t1/impact');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ impact });
    expect(teamDeletionImpact).toHaveBeenCalledWith(sql, 'o1', 't1');

    teamDeletionImpact.mockResolvedValueOnce(null);
    const missing = await app.request('/t-gone/impact');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'TEAM_NOT_FOUND' });
  });
});

describe('DELETE /:teamId', () => {
  const retirement = {
    projectsRetagged: 2,
    foldersRetagged: 0,
    documentsRetagged: 3,
    conversationsUnassigned: 1,
    syncConfigsUnscoped: 0,
    nowOrgWide: { projects: 1, folders: 0, documents: 3 },
    touchedFileDocumentIds: ['d1', 'd2'],
  };

  it('is an admin door', async () => {
    caller.role = 'member';
    const res = await mount(fakeSql(() => undefined).sql).request('/t1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(403);
    expect(deleteTeamInTx).not.toHaveBeenCalled();
  });

  it('deletes atomically, audits the counts, and re-stamps the corpus after the commit', async () => {
    deleteTeamInTx.mockResolvedValueOnce({ name: 'Finance', retirement });
    const { sql } = fakeSql(() => undefined);
    const res = await mount(sql).request('/t1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const { touchedFileDocumentIds: _touched, ...counts } = retirement;
    expect(await res.json()).toEqual({ deleted: true, retirement: counts });

    expect(deleteTeamInTx).toHaveBeenCalledWith(sql, 'o1', 't1');
    expect(createAuditLog).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        organizationId: 'o1',
        actorId: 'u1',
        actorRole: 'admin',
        action: 'team.deleted',
        resourceType: 'team',
        resourceId: 't1',
        resourceName: 'Finance',
        metadata: counts,
        status: 'success',
      }),
    );
    // The audit row lands INSIDE the transaction; the corpus re-stamp runs
    // after it, over the documents the retirement re-tagged.
    expect(createAuditLog.mock.invocationCallOrder[0]).toBeLessThan(
      resyncRetiredDocumentScopes.mock.invocationCallOrder[0] ?? 0,
    );
    expect(resyncRetiredDocumentScopes).toHaveBeenCalledWith(
      sql,
      'o1',
      retirement,
    );
  });

  it('answers 404 without an audit row or a re-stamp for a team that is not the organization’s', async () => {
    deleteTeamInTx.mockResolvedValueOnce(null);
    const res = await mount(fakeSql(() => undefined).sql).request('/t-gone', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'TEAM_NOT_FOUND' });
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(resyncRetiredDocumentScopes).not.toHaveBeenCalled();
  });
});

describe('GET /:teamId/members', () => {
  const roster = (statement: Statement) =>
    statement.text.startsWith('SELECT tm."id", tm."teamId", tm."userId"')
      ? [
          {
            id: 'tm1',
            teamId: 't1',
            userId: 'u1',
            joinedAt: '2026-09-01T00:00:00.000Z',
            displayName: 'Ada',
            email: 'ada@example.test',
          },
        ]
      : undefined;

  it('hides the roster from a member outside the team', async () => {
    caller.role = 'member';
    const { sql, statements } = fakeSql(
      (s) => TEAM_ROW(s) ?? roster(s) ?? undefined,
    );
    const res = await mount(sql).request('/t1/members');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'TEAM_FORBIDDEN' });
    // The membership probe ran; the roster read did not.
    expect(
      statements.some((s) =>
        s.text.startsWith('SELECT "id" FROM "teamMember"'),
      ),
    ).toBe(true);
    expect(statements.some((s) => s.text.startsWith('SELECT tm."id"'))).toBe(
      false,
    );
  });

  it('shows the roster to the team’s own members', async () => {
    caller.role = 'member';
    const { sql } = fakeSql(
      (s) =>
        TEAM_ROW(s) ??
        (s.text.startsWith('SELECT "id" FROM "teamMember"')
          ? [{ id: 'tm1' }]
          : roster(s)),
    );
    const res = await mount(sql).request('/t1/members');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [
        {
          id: 'tm1',
          teamId: 't1',
          userId: 'u1',
          joinedAt: Date.UTC(2026, 8, 1),
          displayName: 'Ada',
          email: 'ada@example.test',
        },
      ],
    });
  });

  it('shows every roster to an admin without a membership read', async () => {
    const { sql, statements } = fakeSql((s) => TEAM_ROW(s) ?? roster(s));
    const res = await mount(sql).request('/t1/members');
    expect(res.status).toBe(200);
    expect(
      statements.some((s) =>
        s.text.startsWith('SELECT "id" FROM "teamMember"'),
      ),
    ).toBe(false);
  });
});

describe('the last-member rule', () => {
  const membership = (count: number) => (statement: Statement) => {
    if (statement.text.startsWith('SELECT "id", "teamId" FROM "teamMember"')) {
      return [{ id: 'tm1', teamId: 't1' }];
    }
    if (statement.text.startsWith('SELECT tm."id", tm."teamId" FROM')) {
      return [{ id: 'tm1', teamId: 't1' }];
    }
    if (statement.text.startsWith('SELECT count(*)::text AS count')) {
      return [{ count: String(count) }];
    }
    return TEAM_ROW(statement);
  };

  it.each([
    ['/t1/members/u1', 'by team and user'],
    ['/members/by-id/tm1', 'by membership row'],
  ])('refuses to remove the last member (%s) with 409', async (route) => {
    const { sql, statements } = fakeSql(membership(1));
    const res = await mount(sql).request(route, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'TEAM_LAST_MEMBER' });
    expect(writes(statements)).toEqual([]);
    expect(emitHintInTx).not.toHaveBeenCalled();
    // The count is read under the team's row lock, so two concurrent
    // removals cannot both see "two members".
    const lock = statements.find((s) => s.text.includes('FOR UPDATE'));
    expect(lock?.text).toContain('FROM "team" WHERE "id" = ?');
  });

  it.each(['/t1/members/u1', '/members/by-id/tm1'])(
    'removes one of several members (%s) and hints the team',
    async (route) => {
      const { sql, statements } = fakeSql(membership(2));
      const res = await mount(sql).request(route, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ removed: true });
      expect(writes(statements).map((s) => s.text)).toEqual([
        'DELETE FROM "teamMember" WHERE "id" = ?',
      ]);
      expect(emitHintInTx).toHaveBeenCalledWith(sql, {
        orgId: 'o1',
        entity: TEAM_HINT_ENTITY,
        entityId: 't1',
      });
    },
  );

  it('is an admin door', async () => {
    caller.role = 'member';
    const { sql, statements } = fakeSql(membership(2));
    const res = await mount(sql).request('/t1/members/u1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(403);
    expect(statements).toEqual([]);
  });
});
