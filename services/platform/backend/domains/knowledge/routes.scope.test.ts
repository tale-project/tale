// @vitest-environment node
/**
 * The scope the knowledge routes search and fetch with (`callerScope`)
 * carries the caller's readable ACTIVE projects that hold a document, read
 * in ONE statement through the readable relation
 * (`readableProjectsWithDocuments`, #5202). It used to read every project
 * the caller may read (`listProjects`) and send the whole id list to the
 * knowledge database as `ANY(<ids>)`. Postgres proves who finds what
 * (`project-reads.integration.ts`); these tests pin the statement and what
 * crosses.
 */
import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { searchKnowledgeForOrg, fetchKnowledgeDocument, orgMember } = vi.hoisted(
  () => ({
    searchKnowledgeForOrg: vi.fn(),
    fetchKnowledgeDocument: vi.fn(),
    // The role the mocked org gate grants.
    orgMember: { role: 'member' },
  }),
);

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return { ...actual, searchKnowledgeForOrg, fetchKnowledgeDocument };
});

vi.mock('../projects/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../projects/service.ts')>();
  return {
    ...actual,
    // A member is in Finance; an owner or admin in no team at all.
    getProjectAuthContext: vi.fn(
      (
        _sql: unknown,
        args: { organizationId: string; userId: string; role: string },
      ) =>
        Promise.resolve({
          organizationId: args.organizationId,
          userId: args.userId,
          role: args.role,
          teamIds: args.role === 'member' ? ['team-finance'] : [],
        }),
    ),
  };
});

vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
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
        c.set('orgMember', { role: orgMember.role } as never);
        await next();
      },
  };
});

import { createKnowledgeRoutes } from './routes.ts';

const FRAGMENT = Symbol('fragment');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

interface Statement {
  text: string;
  values: unknown[];
}

/** Inlines nested `sql\`…\`` fragments the way postgres.js does, so the
 *  recorded text is the statement Postgres would run. */
function fakeSql(rows: unknown[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(rows), fragment);
  };
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
  return { sql, statements };
}

/** The statements sent, not the fragments they embed. */
function reads(statements: Statement[]): Statement[] {
  return statements.filter((s) => s.text.startsWith('SELECT'));
}

/** The project audience: its teams, with the legacy pair's fallback. */
const TEAMS =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';
/** The readable projects that hold a document. */
const HOLDING_DOCUMENTS = `SELECT rp.project_id AS id, rp.project_archived_at_ms IS NOT NULL AS archived FROM ( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) ) rp WHERE EXISTS ( SELECT 1 FROM app.documents d WHERE d.org_id = ? AND d.project_id = rp.project_id )`;

async function post(sql: Sql, route: string, body: unknown) {
  return await createKnowledgeRoutes({ sql, auth: {} as never }).request(
    route,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/** The access the knowledge service was handed. */
function sentAccess(fn: typeof searchKnowledgeForOrg): Record<string, unknown> {
  const call = fn.mock.calls[0] as [unknown, { access: unknown }] | undefined;
  if (call === undefined)
    throw new Error('the knowledge service was not called');
  return call[1].access as Record<string, unknown>;
}

describe('the knowledge routes scope sends the readable projects that hold a document (#5202)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMember.role = 'member';
    searchKnowledgeForOrg.mockResolvedValue({ hits: [] });
    fetchKnowledgeDocument.mockResolvedValue(null);
  });

  it.each(['owner', 'admin'])(
    'searches every active project an %s reads that holds a document, in one statement [PROJ-R1]',
    async (role) => {
      orgMember.role = role;
      const { sql, statements } = fakeSql([{ id: 'p-live', archived: false }]);
      const response = await post(sql, '/search?orgId=o1', { query: 'q' });

      expect(response.status).toBe(200);
      const sent = reads(statements);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toBe(HOLDING_DOCUMENTS);
      expect(sent[0]?.text).not.toContain('ANY(');
      // Relation: org, not a disabled seat, archived projects OUT, admin, no
      // teams · the documents' org.
      expect(sent[0]?.values).toEqual(['o1', true, false, true, [], 'o1']);
      expect(sentAccess(searchKnowledgeForOrg)).toMatchObject({
        isAdmin: true,
        projectIds: ['p-live'],
        includeHub: true,
      });
    },
  );

  it('searches only the projects a member reaches through their teams [PROJ-R2]', async () => {
    const { sql, statements } = fakeSql([{ id: 'p-finance', archived: false }]);
    const response = await post(sql, '/search?orgId=o1', { query: 'q' });

    expect(response.status).toBe(200);
    expect(reads(statements)[0]?.values).toEqual([
      'o1',
      true,
      false,
      false,
      ['team-finance'],
      'o1',
    ]);
    expect(sentAccess(searchKnowledgeForOrg)).toMatchObject({
      isAdmin: false,
      teamIds: ['team-finance'],
      projectIds: ['p-finance'],
    });
  });

  it('fetches with no project and reads none for a disabled seat [PROJ-R2]', async () => {
    orgMember.role = 'disabled';
    const { sql, statements } = fakeSql([{ id: 'p-live', archived: false }]);
    const response = await post(sql, '/fetch?orgId=o1', { fileId: 'f-1' });

    expect(response.status).toBe(200);
    expect(reads(statements)).toEqual([]);
    expect(sentAccess(fetchKnowledgeDocument)).toMatchObject({
      isAdmin: false,
      projectIds: [],
    });
  });
});
