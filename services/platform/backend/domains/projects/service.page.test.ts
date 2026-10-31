// @vitest-environment node
/**
 * The project lists read one page, and "every project I can read" is one
 * relation the readers join (#5156). Postgres proves who reads what
 * (`project-reads.integration.ts`); these tests pin the statements: the
 * rule each one carries, its order, its cursor and its bound.
 */
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  checkedProjectSql,
  fallbackProjectId,
  listProjectsOverview,
  listProjectsPage,
  listReadableProjectAgentsPage,
  listSidebarProjects,
  PROJECT_PAGE_LIMITS,
  readableProjectsSql,
  readProjectAgentCoverage,
  type ProjectAuthContext,
} from './service.ts';

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

/** A `sql` stand-in that inlines nested fragments the way postgres.js does,
 *  so a recorded statement is the one Postgres would see; `answer` gives a
 *  statement's rows (none by default). */
function recordingSql(answer: (text: string) => unknown[] = () => []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
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
    return Object.assign(Promise.resolve(answer(text)), fragment);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

/** What a fragment built on the stand-in reads as. */
function fragmentOf(value: unknown): Fragment {
  if (!isFragment(value)) throw new Error('not a recorded fragment');
  return value;
}

const owner: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-owner',
  role: 'owner',
  teamIds: [],
};
const member: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-member',
  role: 'member',
  teamIds: ['team-finance'],
};

/** The project audience: its teams, with the legacy pair's fallback. */
const TEAMS =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';
const RELATION = `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) )`;

describe('the projects a caller may read, as one relation (#5156)', () => {
  it('lets an owner read every project of the organization [PROJ-R1]', () => {
    const { sql } = recordingSql();
    const relation = fragmentOf(readableProjectsSql(sql, owner));
    expect(relation.text).toBe(RELATION);
    // Org · not a disabled seat · archived projects left out · admin.
    expect(relation.values).toEqual(['org-a', true, false, true, []]);
  });

  it('lets a member read a project with no teams and one shared with a team of theirs [PROJ-R2]', () => {
    const { sql } = recordingSql();
    const relation = fragmentOf(readableProjectsSql(sql, member));
    // `cardinality(…) = 0` is a project open to the organization; `&&`
    // overlaps the project's teams with the member's.
    expect(relation.text).toBe(RELATION);
    expect(relation.values).toEqual([
      'org-a',
      true,
      false,
      false,
      ['team-finance'],
    ]);
  });

  it('gives a disabled seat nothing to read [PROJ-R2]', () => {
    const { sql } = recordingSql();
    const relation = fragmentOf(
      readableProjectsSql(sql, { ...member, role: 'disabled' }),
    );
    expect(relation.values.slice(0, 2)).toEqual(['org-a', false]);
  });

  it('keeps archived projects when asked to', () => {
    const { sql } = recordingSql();
    const relation = fragmentOf(
      readableProjectsSql(sql, member, { includeArchived: true }),
    );
    expect(relation.values.slice(0, 3)).toEqual(['org-a', true, true]);
  });

  it('narrows a project API key to its own project', () => {
    const { sql } = recordingSql();
    const relation = fragmentOf(
      readableProjectsSql(sql, { ...owner, projectScope: 'p-scoped' }),
    );
    expect(relation.text).toContain(
      'AND (? OR archived_at_ms IS NULL) AND (id = ? AND (? OR cardinality(',
    );
    expect(relation.values).toEqual([
      'org-a',
      true,
      false,
      'p-scoped',
      true,
      [],
    ]);
  });

  it('reads one checked project in the same shape, archived or not', () => {
    const { sql } = recordingSql();
    const relation = fragmentOf(checkedProjectSql(sql, member, 'p1'));
    expect(relation.text).toBe(
      '( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND id = ? )',
    );
    expect(relation.values).toEqual(['org-a', 'p1']);
  });
});

/** Project rows as the page read answers them: `count` of them. */
function projectRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${count - index}`,
    organizationId: 'org-a',
    teamIds: [],
    teamId: null,
    sharedWithTeamIds: [],
    createdAt: (count - index) * 10,
  }));
}

describe('the projects list reads one page', () => {
  it('reads a page newest first, one row past it to tell a next page', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.projects') ? projectRows(3) : [],
    );
    const page = await listProjectsOverview(sql, member, {
      limit: 2,
      asOf: 1_000,
    });
    expect(page.projects.map((project) => project.id)).toEqual(['p3', 'p2']);
    expect(page.hasMore).toBe(true);
    const read = statements.find((s) =>
      s.text.startsWith('SELECT ? FROM app.projects'),
    );
    expect(read?.text).toMatch(
      /ORDER BY created_at_ms DESC, id DESC LIMIT \?$/,
    );
    expect(read?.values.at(-1)).toBe(3);
    // The visibility rule of the relation: the member's teams.
    expect(read?.values).toContainEqual(['team-finance']);
    // The overdue counts are read for the page's projects alone.
    const overdue = statements.find((s) =>
      s.text.includes('GROUP BY project_id'),
    );
    expect(overdue?.values).toContainEqual(['p3', 'p2']);
  });

  it('continues after the cursor, and says when the list is done', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.projects') ? projectRows(1) : [],
    );
    const page = await listProjectsOverview(sql, member, {
      limit: 2,
      cursor: { at: 20, id: 'p2' },
    });
    expect(page.hasMore).toBe(false);
    expect(page.projects).toHaveLength(1);
    const read = statements.find((s) =>
      s.text.startsWith('SELECT ? FROM app.projects'),
    );
    expect(read?.text).toContain(
      'AND (?::bigint IS NULL OR created_at_ms < ? OR (created_at_ms = ? AND id < ?))',
    );
    expect(read?.values.slice(-5)).toEqual([20, 20, 20, 'p2', 3]);
  });

  it('reads the default page, and no overdue counts for an empty one', async () => {
    const { sql, statements } = recordingSql();
    const page = await listProjectsOverview(sql, owner);
    expect(page).toEqual({
      projects: [],
      overdueTruncated: false,
      hasMore: false,
    });
    const read = statements.find((s) =>
      s.text.startsWith('SELECT ? FROM app.projects'),
    );
    expect(read?.values.at(-1)).toBe(PROJECT_PAGE_LIMITS.fallback + 1);
    expect(statements.some((s) => s.text.includes('FROM app.tasks'))).toBe(
      false,
    );
  });
});

describe("Home's navigator reads one page", () => {
  it('reads pinned projects first, then the most recent, one row past the page', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.projects') ? projectRows(3) : [],
    );
    const page = await listSidebarProjects(sql, member, 2);
    expect(page.projects.map((project) => project.id)).toEqual(['p3', 'p2']);
    expect(page.hasMore).toBe(true);
    const read = statements.find((s) => s.text.startsWith('SELECT ?'));
    expect(read?.text).toMatch(
      /ORDER BY pinned_at_ms DESC NULLS LAST, updated_at_ms DESC, id DESC LIMIT \?$/,
    );
    expect(read?.text).toContain('AND archived_at_ms IS NULL');
    expect(read?.values.at(-1)).toBe(3);
  });

  it('never reads more than the largest page', async () => {
    const { sql, statements } = recordingSql();
    const page = await listSidebarProjects(sql, owner, 10_000);
    expect(page).toEqual({ projects: [], hasMore: false });
    expect(statements.at(-1)?.values.at(-1)).toBe(PROJECT_PAGE_LIMITS.max + 1);
  });
});

describe('the readers that pick or count projects join the relation (#5193)', () => {
  const JOINED = `JOIN ${RELATION} rp ON rp.project_id = p.id`;
  /** The statements run, not the fragments they embed. */
  const readsOf = (statements: { text: string; values: unknown[] }[]) =>
    statements.filter((s) => s.text.startsWith('SELECT'));

  it('falls back to the newest organization-wide project an owner reads, one row [PROJ-R1]', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.startsWith('SELECT p.id') ? [{ id: 'p-open' }] : [],
    );
    expect(await fallbackProjectId(sql, owner)).toBe('p-open');
    const reads = readsOf(statements);
    expect(reads).toHaveLength(1);
    const read = reads[0];
    expect(read?.text).toBe(
      `SELECT p.id FROM app.projects p ${JOINED} ORDER BY cardinality(?) = 0 DESC, p.updated_at_ms DESC, p.id DESC LIMIT 1`,
    );
    // Org · not a disabled seat · archived projects left out · admin.
    expect(read?.values).toEqual(['org-a', true, false, true, [], TEAMS]);
  });

  it('falls back only to a project a member reaches [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    expect(await fallbackProjectId(sql, member)).toBeNull();
    const [read] = readsOf(statements);
    expect(read?.text).toContain(JOINED);
    expect(read?.values).toEqual([
      'org-a',
      true,
      false,
      false,
      ['team-finance'],
      TEAMS,
    ]);
  });

  it('has no project to fall back to for a disabled seat [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    expect(
      await fallbackProjectId(sql, { ...member, role: 'disabled' }),
    ).toBeNull();
    expect(readsOf(statements)[0]?.values.slice(0, 2)).toEqual([
      'org-a',
      false,
    ]);
  });

  it('counts the projects an owner reads by agents and names a bounded few [PROJ-R1]', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.startsWith('SELECT ARRAY(')
        ? [{ named: ['Website relaunch'], withAgents: 7, withoutAgents: 2 }]
        : [],
    );
    expect(await readProjectAgentCoverage(sql, owner, 5)).toEqual({
      named: ['Website relaunch'],
      withAgents: 7,
      withoutAgents: 2,
    });
    const reads = readsOf(statements);
    expect(reads).toHaveLength(1);
    const read = reads[0];
    expect(read?.text).toBe(
      `SELECT ARRAY( SELECT p.name FROM app.projects p ${JOINED} WHERE p.project_agent_count > 0 ORDER BY p.updated_at_ms DESC, p.id DESC LIMIT ? ) AS named, (count(*) FILTER (WHERE p.project_agent_count > 0))::int AS "withAgents", (count(*) FILTER (WHERE p.project_agent_count = 0))::int AS "withoutAgents" FROM app.projects p ${JOINED}`,
    );
    // The names' relation and bound, then the counts' relation: active
    // projects only, the owner's admin grant in both.
    expect(read?.values).toEqual([
      'org-a',
      true,
      false,
      true,
      [],
      5,
      'org-a',
      true,
      false,
      true,
      [],
    ]);
  });

  it('counts only the projects a member reaches, and nothing for a disabled seat [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    expect(await readProjectAgentCoverage(sql, member, 5)).toEqual({
      named: [],
      withAgents: 0,
      withoutAgents: 0,
    });
    expect(readsOf(statements)[0]?.values).toEqual([
      'org-a',
      true,
      false,
      false,
      ['team-finance'],
      5,
      'org-a',
      true,
      false,
      false,
      ['team-finance'],
    ]);
    await readProjectAgentCoverage(sql, { ...member, role: 'disabled' }, 5);
    const disabled = readsOf(statements)[1];
    expect(disabled?.values.slice(0, 2)).toEqual(['org-a', false]);
    expect(disabled?.values.slice(6, 8)).toEqual(['org-a', false]);
  });
});

describe('the MCP project list and the settings lists read one page through the relation (#5203)', () => {
  const PROJECT_PAGE = `SELECT ? FROM app.projects JOIN ${RELATION} rp ON rp.project_id = app.projects.id WHERE org_id = ? AND (? OR (? AND archived_at_ms IS NOT NULL) OR (? AND archived_at_ms IS NULL)) AND (?::text IS NULL OR name ILIKE ?) AND (?::bigint IS NULL OR created_at_ms < ? OR (created_at_ms = ? AND id < ?)) ORDER BY created_at_ms DESC, id DESC LIMIT ?`;
  const AGENT_PAGE = `SELECT a.id, a.project_id AS "projectId", a.instructions, a.tools, a.harness, a.model, a.model_provider AS "modelProvider", a.created_at_ms::float8 AS "createdAt" FROM app.project_agents a JOIN ${RELATION} rp ON rp.project_id = a.project_id WHERE a.org_id = ? AND (?::bigint IS NULL OR a.created_at_ms < ? OR (a.created_at_ms = ? AND a.id < ?)) ORDER BY a.created_at_ms DESC, a.id DESC LIMIT ?`;
  /** The statement a page read runs, not the fragments it embeds. */
  const readOf = (
    statements: { text: string; values: unknown[] }[],
    start: string,
  ) => {
    const reads = statements.filter((s) => s.text.startsWith(start));
    expect(reads).toHaveLength(1);
    return reads[0];
  };

  it('pages the projects an owner reads, the archived ones left out, in one statement [PROJ-R1]', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.startsWith('SELECT ? FROM app.projects') ? projectRows(3) : [],
    );
    const page = await listProjectsPage(sql, owner, {
      archived: 'exclude',
      limit: 2,
      cursor: null,
      summary: true,
    });
    expect(page.projects.map((project) => project.id)).toEqual(['p3', 'p2']);
    expect(page.hasMore).toBe(true);
    const read = readOf(statements, 'SELECT ? FROM app.projects');
    expect(read?.text).toBe(PROJECT_PAGE);
    expect(read?.text).not.toContain('ANY(');
    expect(String(read?.values[0])).toContain('NULL AS instructions');
    expect(read?.values.slice(1)).toEqual([
      // The relation: org · not a disabled seat · archived projects left
      // out · admin.
      'org-a',
      true,
      false,
      true,
      [],
      // The page: org · include · only · exclude · no name · no cursor.
      'org-a',
      false,
      false,
      true,
      null,
      null,
      null,
      null,
      null,
      null,
      3,
    ]);
  });

  it('pages only the projects a member reaches [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    const page = await listProjectsPage(sql, member, {
      archived: 'exclude',
      limit: 50,
      cursor: null,
    });
    expect(page).toEqual({ projects: [], hasMore: false });
    const read = readOf(statements, 'SELECT ? FROM app.projects');
    expect(read?.text).toBe(PROJECT_PAGE);
    expect(read?.values.slice(1, 6)).toEqual([
      'org-a',
      true,
      false,
      false,
      ['team-finance'],
    ]);
    // The full row, instructions included, for the settings listing.
    expect(String(read?.values[0])).not.toContain('NULL AS instructions');
  });

  it('pages nothing for a disabled seat [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    await listProjectsPage(
      sql,
      { ...member, role: 'disabled' },
      { archived: 'include', limit: 50, cursor: null },
    );
    const read = readOf(statements, 'SELECT ? FROM app.projects');
    expect(read?.values.slice(1, 3)).toEqual(['org-a', false]);
  });

  it.each([
    ['include', [true, true, false, false]],
    ['only', [true, false, true, false]],
    ['exclude', [false, false, false, true]],
  ] as const)(
    'keeps the archived rule of %s in the relation and the page',
    async (archived, [relationArchived, include, only, exclude]) => {
      const { sql, statements } = recordingSql();
      await listProjectsPage(sql, member, {
        archived,
        limit: 50,
        cursor: null,
      });
      const read = readOf(statements, 'SELECT ? FROM app.projects');
      expect(read?.values[3]).toBe(relationArchived);
      expect(read?.values.slice(7, 10)).toEqual([include, only, exclude]);
    },
  );

  it('searches the name in the statement, its LIKE characters escaped, and goes on after the cursor', async () => {
    const { sql, statements } = recordingSql();
    await listProjectsPage(sql, member, {
      archived: 'exclude',
      limit: 50,
      cursor: { at: 20, id: 'p2' },
      name: '  50%_off ',
    });
    const read = readOf(statements, 'SELECT ? FROM app.projects');
    expect(read?.values.slice(-7)).toEqual([
      '%50\\%\\_off%',
      '%50\\%\\_off%',
      20,
      20,
      20,
      'p2',
      51,
    ]);
  });

  it('pages the agents of the projects an owner reads, newest first [PROJ-R1]', async () => {
    const agents = [3, 2, 1].map((n) => ({
      id: `a${n}`,
      projectId: 'p1',
      createdAt: n * 10,
    }));
    const { sql, statements } = recordingSql((text) =>
      text.startsWith('SELECT a.id') ? agents : [],
    );
    const page = await listReadableProjectAgentsPage(sql, owner, {
      limit: 2,
      cursor: null,
    });
    expect(page.agents.map((agent) => agent.id)).toEqual(['a3', 'a2']);
    expect(page.hasMore).toBe(true);
    const read = readOf(statements, 'SELECT a.id');
    expect(read?.text).toBe(AGENT_PAGE);
    expect(read?.text).not.toContain('ANY(');
    expect(read?.values).toEqual([
      // The relation: archived projects left out, the owner's admin grant.
      'org-a',
      true,
      false,
      true,
      [],
      'org-a',
      null,
      null,
      null,
      null,
      3,
    ]);
  });

  it('pages only the agents of the projects a member reaches, after the cursor [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    const page = await listReadableProjectAgentsPage(sql, member, {
      limit: 50,
      cursor: { at: 30, id: 'a3' },
    });
    expect(page).toEqual({ agents: [], hasMore: false });
    const read = readOf(statements, 'SELECT a.id');
    expect(read?.text).toBe(AGENT_PAGE);
    expect(read?.values).toEqual([
      'org-a',
      true,
      false,
      false,
      ['team-finance'],
      'org-a',
      30,
      30,
      30,
      'a3',
      51,
    ]);
  });

  it('pages no agent for a disabled seat [PROJ-R2]', async () => {
    const { sql, statements } = recordingSql();
    await listReadableProjectAgentsPage(
      sql,
      { ...member, role: 'disabled' },
      { limit: 50, cursor: null },
    );
    expect(readOf(statements, 'SELECT a.id')?.values.slice(0, 2)).toEqual([
      'org-a',
      false,
    ]);
  });
});
