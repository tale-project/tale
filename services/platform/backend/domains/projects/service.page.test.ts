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
  listProjectsOverview,
  listSidebarProjects,
  PROJECT_PAGE_LIMITS,
  readableProjectsSql,
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
