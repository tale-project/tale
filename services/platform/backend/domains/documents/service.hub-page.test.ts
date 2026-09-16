// @vitest-environment node

/**
 * The REST hub page (`GET /v1/documents`) must scope inside its query, the
 * way its in-app twin `listHubDocumentsPaginated` already does.
 *
 * Both read the same rows through the same team rules, and the rules have a
 * SQL form — `hubAccessClause`. The REST page did not use it: it cut the page
 * at `LIMIT` and dropped the rows the caller's teams miss afterwards, so
 * another team's documents consumed the caller's page slots. A page ran
 * short, and a page's worth of other teams' documents in front of the
 * caller's made it empty.
 *
 * So these tests pin WHERE the scope is applied, not just that it is.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listHubDocumentsPage } from './service.ts';

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
 *  recorded text is the statement Postgres would run — the access clause
 *  included. */
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

/** The statement that reads the page, not the fragment it embeds. */
function pageStatement(statements: Statement[]): Statement {
  const found = statements.find((s) => s.text.startsWith('SELECT'));
  if (!found) throw new Error('no page statement was issued');
  return found;
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'member',
  teamIds: ['team-mine'],
};

/** A hub row scoped to a team the caller is NOT in — the row a post-page
 *  filter used to drop after it had already taken a slot. */
function otherTeamRow(i: number) {
  return {
    id: `doc-${i}`,
    createdAt: 1_000 - i,
    projectId: null,
    teamId: 'team-theirs',
    teamTags: ['team-theirs'],
  };
}

describe('listHubDocumentsPage', () => {
  it('scopes in the statement that pages, so the cut is over rows the caller can see', async () => {
    const { sql, statements } = fakeSql([]);
    await listHubDocumentsPage(sql, auth, { cursor: null, limit: 25 });

    const { text, values } = pageStatement(statements);
    // The same clause the in-app twin embeds — hub rows, team rules.
    expect(text).toContain('team_tags && ?');
    expect(text).toContain('team_id = ANY(?)');
    expect(values).toContainEqual(auth.teamIds);
    // …and it is in the statement that carries the LIMIT, not applied after.
    expect(text).toMatch(/ORDER BY .* LIMIT \?$/);
  });

  it('answers the page the query returned, without a second filter behind it', async () => {
    const rows = [otherTeamRow(0), otherTeamRow(1)];
    const { sql } = fakeSql(rows);

    const page = await listHubDocumentsPage(sql, auth, {
      cursor: null,
      limit: 25,
    });

    // The query decides visibility; the code after it must not re-decide.
    // Filtering here is what emptied a page whose slots were already spent.
    expect(page.page.map((row) => row.id)).toEqual(['doc-0', 'doc-1']);
    expect(page.isDone).toBe(true);
  });

  it('fills the page and points the cursor at its last row', async () => {
    const rows = [otherTeamRow(0), otherTeamRow(1), otherTeamRow(2)];
    const { sql, statements } = fakeSql(rows);

    const page = await listHubDocumentsPage(sql, auth, {
      cursor: null,
      limit: 2,
    });

    expect(pageStatement(statements).values.at(-1)).toBe(3);
    expect(page.page.map((row) => row.id)).toEqual(['doc-0', 'doc-1']);
    expect(page.isDone).toBe(false);
    expect(page.continueCursor).toBe('999:doc-1');
  });
});
