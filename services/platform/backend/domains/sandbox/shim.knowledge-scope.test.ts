// @vitest-environment node

/**
 * Unit lock for the session-binding knowledge scope: an org-wide run of a
 * MULTI-BOUND automation reads its own bound projects' files (plus the hub),
 * an automation with no bindings stays hub-only, a project session reads its
 * one project, and a bound project whose row is gone contributes nothing.
 * The real-Postgres probe (`integration-check.ts`) drives `document_find`
 * through the tool door over two bound projects.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listDocumentsForAgent } from '../documents/agent-list.ts';
import { sandboxToolShimHandlers } from './shim.ts';

vi.mock('../documents/agent-list.ts', () => ({
  listDocumentsForAgent: vi.fn(() =>
    Promise.resolve({
      documents: [],
      totalCount: null,
      hasMore: false,
      cursor: null,
      warning: null,
    }),
  ),
}));

interface Statement {
  text: string;
  values: unknown[];
}

interface ProjectRow {
  id: string;
  teamId: string | null;
  shared: string[];
  archivedAt: number | null;
}

/**
 * Scripted `sql` for the binding resolver's four reads: the session row, the
 * run row, the binding rows, and the project rows. Everything else answers
 * with no rows.
 */
function fakeSql(script: {
  session?: { ownerType: string; ownerId: string };
  run?: { name: string; projectId: string | null };
  agent?: { id: string; projectId: string };
  bindings?: string[];
  projects?: ProjectRow[];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('FROM app.sandbox_sessions')) {
      return Promise.resolve(script.session ? [script.session] : []);
    }
    if (text.includes('FROM app.automation_runs')) {
      return Promise.resolve(script.run ? [script.run] : []);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve(script.agent ? [script.agent] : []);
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      return Promise.resolve(
        (script.bindings ?? []).map((projectId) => ({ projectId })),
      );
    }
    if (text.includes('FROM app.projects')) {
      const wanted = values.find(Array.isArray);
      const rows = script.projects ?? [];
      // The existence probe (`SELECT id … WHERE id = ?`) and the scope read
      // (`WHERE id = ANY(?)`) both answer from the same project set.
      if (Array.isArray(wanted)) {
        return Promise.resolve(rows.filter((row) => wanted.includes(row.id)));
      }
      const single = values[0];
      return Promise.resolve(
        rows.filter((row) => row.id === single).map((row) => ({ id: row.id })),
      );
    }
    return Promise.resolve([]);
  };
  return { sql: fn as unknown as Sql, statements };
}

const ORG = 'org_1';

async function resolveScope(
  sql: Sql,
): Promise<{ allowed: boolean; scope?: Record<string, unknown> }> {
  const handler =
    sandboxToolShimHandlers(sql)[
      'sandbox/workspace_access:resolveKnowledgeToolAccess'
    ];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler's own return shape
  return (await handler?.({
    organizationId: ORG,
    sessionId: 'ses-1',
    subject: 'documents',
  })) as { allowed: boolean; scope?: Record<string, unknown> };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveKnowledgeToolAccess — org-wide run of a multi-bound automation', () => {
  it('reads EVERY bound project (its teams, shared teams, archived labels) plus the hub', async () => {
    const { sql } = fakeSql({
      session: { ownerType: 'workflow_run', ownerId: 'run-1:@workflow' },
      run: { name: 'triage', projectId: null },
      bindings: ['p-alpha', 'p-beta'],
      projects: [
        {
          id: 'p-alpha',
          teamId: 'team-a',
          shared: ['team-s'],
          archivedAt: null,
        },
        {
          id: 'p-beta',
          teamId: null,
          shared: [],
          archivedAt: 1_700_000_000_000,
        },
      ],
    });

    const access = await resolveScope(sql);

    expect(access.allowed).toBe(true);
    expect(access.scope).toEqual({
      teamIds: [`org_${ORG}`, 'team-a', 'team-s'],
      projectIds: ['p-alpha', 'p-beta'],
      includeHub: true,
      archivedProjectIds: ['p-beta'],
    });
  });

  it('a bound project whose row is gone contributes nothing — never a widening', async () => {
    const { sql } = fakeSql({
      session: { ownerType: 'workflow_run', ownerId: 'run-1:@workflow' },
      run: { name: 'triage', projectId: null },
      bindings: ['p-alpha', 'p-gone'],
      projects: [
        { id: 'p-alpha', teamId: 'team-a', shared: [], archivedAt: null },
      ],
    });

    const access = await resolveScope(sql);

    expect(access.scope).toMatchObject({
      projectIds: ['p-alpha'],
      teamIds: [`org_${ORG}`, 'team-a'],
      includeHub: true,
    });
  });

  it('an automation with NO bindings stays hub-only (org-level)', async () => {
    const { sql } = fakeSql({
      session: { ownerType: 'workflow_run', ownerId: 'run-1:@workflow' },
      run: { name: 'digest', projectId: null },
      bindings: [],
    });

    const access = await resolveScope(sql);

    expect(access.scope).toEqual({
      teamIds: [`org_${ORG}`],
      projectIds: [],
      includeHub: true,
      archivedProjectIds: [],
    });
  });

  it('a run PINNED to a project reads that one project (unchanged)', async () => {
    const { sql } = fakeSql({
      session: { ownerType: 'workflow_run', ownerId: 'run-1:agent' },
      run: { name: 'triage', projectId: 'p-alpha' },
      projects: [
        {
          id: 'p-alpha',
          teamId: 'team-a',
          shared: ['team-s'],
          archivedAt: null,
        },
      ],
    });

    const access = await resolveScope(sql);

    expect(access.scope).toEqual({
      teamIds: [`org_${ORG}`, 'team-a', 'team-s'],
      projectIds: ['p-alpha'],
      includeHub: true,
      archivedProjectIds: [],
    });
  });
});

describe('listDocumentsForScope — the binding door', () => {
  it('passes the whole authorized project set through to the listing', async () => {
    const { sql } = fakeSql({});
    const handler =
      sandboxToolShimHandlers(sql)[
        'documents/internal_queries:listDocumentsForScope'
      ];

    await handler?.({
      organizationId: ORG,
      teamIds: [`org_${ORG}`],
      projectIds: ['p-alpha', 'p-beta'],
      limit: 10,
    });

    expect(listDocumentsForAgent).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      teamIds: [`org_${ORG}`],
      projectIds: ['p-alpha', 'p-beta'],
      limit: 10,
    });
  });
});
