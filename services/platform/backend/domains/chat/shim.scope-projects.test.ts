// @vitest-environment node
/**
 * The chat knowledge scope (`resolveAccessScope`) — what the chat tools, the
 * MCP door and a user-keyed sandbox session hand the knowledge database —
 * carries the readable projects that hold a document, read in ONE statement
 * through the readable relation (`readableProjectsWithDocuments`), archived
 * projects included and labelled (#5202). It used to read every project the
 * caller may read (`listProjects`) and send the whole id list across as
 * `ANY(<ids>)`. A check of one project (`assertProjectAccessForChat`) asks
 * about that project alone. Postgres proves who finds what
 * (`project-reads.integration.ts`); these tests pin the statements.
 */
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatShimHandlers, resolveAccessScope } from './shim.ts';

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
  // `u-<role>` acts with that role; `u-project-key` is a project's own API
  // key; `u-gone` is no member at all.
  findActingMember: vi.fn(
    (_sql: unknown, organizationId: string, userId: string) =>
      Promise.resolve(
        userId === 'u-gone'
          ? null
          : userId === 'u-project-key'
            ? {
                id: 'api-key:key-1',
                organizationId,
                userId,
                role: 'developer',
                apiKeyOwner: { kind: 'project', projectId: 'p-key' },
              }
            : { id: 'm-1', organizationId, userId, role: userId.slice(2) },
      ),
  ),
}));

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
        _email?: string,
        options: { projectScope?: string } = {},
      ) =>
        Promise.resolve({
          organizationId: args.organizationId,
          userId: args.userId,
          role: args.role,
          teamIds: args.role === 'member' ? ['team-finance'] : [],
          ...(options.projectScope !== undefined
            ? { projectScope: options.projectScope }
            : {}),
        }),
    ),
  };
});

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
const AUDIENCE = `(? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[])`;
/** The readable projects (`readableProjectsSql`) under a visibility rule. */
const relation = (visibility: string) =>
  `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND ${visibility} )`;
/** The readable projects that hold a document. */
const holdingDocuments = (visibility: string) =>
  `SELECT rp.project_id AS id, rp.project_archived_at_ms IS NOT NULL AS archived FROM ${relation(visibility)} rp WHERE EXISTS ( SELECT 1 FROM app.documents d WHERE d.org_id = ? AND d.project_id = rp.project_id )`;

const ROWS = [
  { id: 'p-live', archived: false },
  { id: 'p-old', archived: true },
];

describe('the chat knowledge scope sends the readable projects that hold a document (#5202)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['owner', 'admin'])(
    'carries every project of the organization an %s reads, archived ones labelled, in one statement [PROJ-R1]',
    async (role) => {
      const { sql, statements } = fakeSql(ROWS);
      const scope = await resolveAccessScope(sql, 'org-a', `u-${role}`);

      const sent = reads(statements);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toBe(holdingDocuments(AUDIENCE));
      expect(sent[0]?.text).not.toContain('ANY(');
      // Relation: org, not a disabled seat, archived projects kept, admin,
      // no teams · the documents' org.
      expect(sent[0]?.values).toEqual(['org-a', true, true, true, [], 'org-a']);
      expect(scope).toMatchObject({
        isAdmin: true,
        projectIds: ['p-live', 'p-old'],
        archivedProjectIds: ['p-old'],
        includeHub: true,
      });
    },
  );

  it('carries only the projects a member reaches through their teams [PROJ-R2]', async () => {
    const { sql, statements } = fakeSql([{ id: 'p-live', archived: false }]);
    const scope = await resolveAccessScope(sql, 'org-a', 'u-member');

    const sent = reads(statements);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(holdingDocuments(AUDIENCE));
    expect(sent[0]?.values).toEqual([
      'org-a',
      true,
      true,
      false,
      ['team-finance'],
      'org-a',
    ]);
    expect(scope).toMatchObject({
      isAdmin: false,
      teamIds: ['team-finance'],
      projectIds: ['p-live'],
      archivedProjectIds: [],
    });
  });

  it.each(['u-disabled', 'u-gone'])(
    'carries no project and reads none for %s [PROJ-R2]',
    async (userId) => {
      const { sql, statements } = fakeSql(ROWS);
      const scope = await resolveAccessScope(sql, 'org-a', userId);

      expect(reads(statements)).toEqual([]);
      expect(scope).toEqual({
        teamIds: [],
        isAdmin: false,
        projectIds: [],
        includeHub: false,
        includeConversationScoped: false,
        archivedProjectIds: [],
      });
    },
  );

  it("narrows a project's own API key to its project, and to no hub", async () => {
    const { sql, statements } = fakeSql([{ id: 'p-key', archived: false }]);
    const scope = await resolveAccessScope(sql, 'org-a', 'u-project-key');

    const sent = reads(statements);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(holdingDocuments(`(id = ? AND ${AUDIENCE})`));
    expect(sent[0]?.values).toEqual([
      'org-a',
      true,
      true,
      'p-key',
      false,
      [],
      'org-a',
    ]);
    expect(scope).toMatchObject({ projectIds: ['p-key'], includeHub: false });
  });
});

describe('a chat check of one project reads that project alone (#5202)', () => {
  const ASSERT = 'projects/internal_queries:assertProjectAccessForChat';

  async function check(
    sql: Sql,
    userId: string,
  ): Promise<Record<string, unknown>> {
    const handler = chatShimHandlers(sql)[ASSERT];
    if (handler === undefined) throw new Error('project check missing');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler answers the check's verdict
    return (await handler({
      projectId: 'p-1',
      organizationId: 'org-a',
      userId,
    })) as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admits an owner by that project alone, archived or not [PROJ-R1]', async () => {
    const { sql, statements } = fakeSql([{ id: 'p-1' }]);
    expect(await check(sql, 'u-owner')).toEqual({ allowed: true });

    const sent = reads(statements);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(
      `SELECT id FROM app.projects WHERE org_id = ? AND id = ANY(?) AND ${AUDIENCE}`,
    );
    expect(sent[0]?.values).toEqual(['org-a', ['p-1'], true, []]);
  });

  it("asks about a member's teams for that project alone [PROJ-R2]", async () => {
    const { sql, statements } = fakeSql([{ id: 'p-1' }]);
    expect(await check(sql, 'u-member')).toEqual({ allowed: true });

    expect(reads(statements)[0]?.values).toEqual([
      'org-a',
      ['p-1'],
      false,
      ['team-finance'],
    ]);
  });

  it('refuses a disabled seat without asking which projects it reads [PROJ-R2]', async () => {
    const { sql, statements } = fakeSql([{ orgId: 'org-a' }]);
    expect(await check(sql, 'u-disabled')).toEqual({
      allowed: false,
      reason: 'forbidden',
    });

    // Only the not-found / other-organization lookup runs.
    const sent = reads(statements);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(
      'SELECT org_id AS "orgId" FROM app.projects WHERE id = ? LIMIT 1',
    );
  });
});
