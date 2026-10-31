// @vitest-environment node

/**
 * The palette search over documents (`searchDocumentsView`) joins the
 * projects the caller may read (`readableProjectsSql`) in the statement that
 * reads the documents (#5193). It used to read the caller's whole project
 * list first and send it back as `ANY(<ids>)`, twice: once to reach project
 * documents, once to sort an archived project's documents last.
 *
 * A hub document is reached through its team rule (`hubAccessClause`), a
 * project document through the relation, archived projects included: their
 * files stay searchable, sort last and say so (#2999). Postgres proves who
 * finds what (`project-reads.integration.ts`); these tests pin the statement.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { ProjectAuthContext } from '../projects/service.ts';
import { searchDocumentsView } from './service.ts';

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
 *  recorded text is the statement Postgres would run — the relation and the
 *  access clause included. */
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
  return { sql, statements };
}

/** The one statement the search ran, not a fragment it embeds: no project
 *  list is read before it. */
function searchStatement(statements: Statement[]): Statement {
  const reads = statements.filter((s) => s.text.startsWith('SELECT'));
  expect(reads).toHaveLength(1);
  const found = reads[0];
  if (!found) throw new Error('no search statement was issued');
  return found;
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
/** The readable projects, archived ones included (`readableProjectsSql`). */
const RELATION = `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) )`;

/** A document row as the search answers it. */
function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    title: 'Supplier contract',
    folderPath: null,
    folderId: null,
    projectId: null,
    projectArchived: false,
    sourceModifiedAt: null,
    createdAt: 1_000,
    ...overrides,
  };
}

describe('searchDocumentsView joins the readable projects (#5193)', () => {
  it('reaches every project document of the organization for an owner, in one statement [PROJ-R1]', async () => {
    const { sql, statements } = fakeSql([]);
    await searchDocumentsView(sql, owner, '  contract ');

    const { text, values } = searchStatement(statements);
    expect(text).toContain(
      `FROM app.documents LEFT JOIN ${RELATION} rp USING (project_id)`,
    );
    // A hub document by its team rule, a project document by the relation.
    expect(text).toContain(
      'AND (project_id IS NULL AND (? OR cardinality(team_tags) = 0 OR team_tags && ?::text[]) OR rp.project_id IS NOT NULL)',
    );
    expect(text).not.toContain('ANY(');
    // Columns · relation: org, not a disabled seat, archived projects kept,
    // admin, no teams · org · title · hub rule: admin, no teams · bound.
    expect(values.slice(1)).toEqual([
      'org-a',
      true,
      true,
      true,
      [],
      'org-a',
      '%contract%',
      true,
      [],
      25,
    ]);
  });

  it('reaches only the project documents a member reaches through their teams [PROJ-R2]', async () => {
    const { sql, statements } = fakeSql([]);
    await searchDocumentsView(sql, member, 'contract');

    const { text, values } = searchStatement(statements);
    expect(text).toContain(`LEFT JOIN ${RELATION} rp USING (project_id)`);
    expect(values.slice(1, 6)).toEqual([
      'org-a',
      true,
      true,
      false,
      ['team-finance'],
    ]);
  });

  it('reaches no project document for a disabled seat [PROJ-R2]', async () => {
    const { sql, statements } = fakeSql([]);
    await searchDocumentsView(sql, { ...member, role: 'disabled' }, 'contract');

    expect(searchStatement(statements).values.slice(1, 3)).toEqual([
      'org-a',
      false,
    ]);
  });

  it("sorts an archived project's documents last and labels them from the joined row", async () => {
    const { sql, statements } = fakeSql([
      documentRow({ id: 'doc-hub' }),
      documentRow({ id: 'doc-live', projectId: 'p-live' }),
      documentRow({
        id: 'doc-old',
        projectId: 'p-old',
        projectArchived: true,
      }),
    ]);
    const hits = await searchDocumentsView(sql, member, 'contract');

    const { text } = searchStatement(statements);
    expect(text).toContain(
      'rp.project_archived_at_ms IS NOT NULL AS "projectArchived"',
    );
    expect(text).toMatch(
      /ORDER BY rp\.project_archived_at_ms IS NOT NULL, coalesce\(source_modified_at_ms, created_at_ms\) DESC LIMIT \?$/,
    );
    expect(
      hits.map((hit) => [hit.documentId, hit.projectArchived ?? false]),
    ).toEqual([
      ['doc-hub', false],
      ['doc-live', false],
      ['doc-old', true],
    ]);
    expect(hits[1]?.snippet).toBe('Project file');
  });

  it('reads nothing for a blank query', async () => {
    const { sql, statements } = fakeSql([]);
    expect(await searchDocumentsView(sql, owner, '   ')).toEqual([]);
    expect(statements).toHaveLength(0);
  });
});
