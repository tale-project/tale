// @vitest-environment node

/**
 * The hub listing behind `GET /documents` is bounded (200 rows by default,
 * 500 at most). Before this test it applied the bound silently: a hub with
 * more documents than the cap answered a complete-looking prefix, and the
 * comparison picker — its one product consumer — offered the newest 200
 * with no hint that older files existed. This pins the honest shape: one
 * row past the bound is read, `truncated` tells the truth, and the
 * per-caller visibility filter runs on the capped rows so a hidden row can
 * never mask the cut.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listDocuments } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function hubRow(i: number, teamId: string | null = null) {
  return {
    id: `doc-${i}`,
    organizationId: 'org_1',
    title: `file-${i}.txt`,
    projectId: null,
    teamId,
    teamTags: teamId === null ? [] : [teamId],
    record: null,
  };
}

function fakeSql(rows: ReturnType<typeof hubRow>[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    // Honour the LIMIT the lane asked for, as Postgres would.
    const limit = values[values.length - 1];
    return Promise.resolve(
      typeof limit === 'number' ? rows.slice(0, limit) : rows,
    );
  };
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
  return { sql, statements };
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'member',
  teamIds: [] as string[],
};

describe('listDocuments', () => {
  it('reads one row past the bound and reports a cut honestly', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => hubRow(i));
    const { sql, statements } = fakeSql(rows);
    const listing = await listDocuments(sql, auth, { limit: 5 });
    expect(statements[0]?.values.at(-1)).toBe(6);
    expect(listing.truncated).toBe(true);
    expect(listing.documents.map((doc) => doc.id)).toEqual([
      'doc-0',
      'doc-1',
      'doc-2',
      'doc-3',
      'doc-4',
    ]);
  });

  it('answers untruncated when the hub fits the bound exactly', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => hubRow(i));
    const { sql } = fakeSql(rows);
    const listing = await listDocuments(sql, auth, { limit: 5 });
    expect(listing.truncated).toBe(false);
    expect(listing.documents).toHaveLength(5);
  });

  it('judges the cut on stored rows, so a hidden row never masks it', async () => {
    // Six stored rows, bound five: the sixth proves the cut even though the
    // caller (no teams) cannot see the team-scoped rows among the first five.
    const rows = [
      hubRow(0),
      hubRow(1, 'team-x'),
      hubRow(2, 'team-x'),
      hubRow(3),
      hubRow(4, 'team-x'),
      hubRow(5),
    ];
    const { sql } = fakeSql(rows);
    const listing = await listDocuments(sql, auth, { limit: 5 });
    expect(listing.truncated).toBe(true);
    expect(listing.documents.map((doc) => doc.id)).toEqual(['doc-0', 'doc-3']);
  });

  it('caps the bound at the hub read maximum', async () => {
    const { sql, statements } = fakeSql([]);
    await listDocuments(sql, auth, { limit: 10_000 });
    expect(statements[0]?.values.at(-1)).toBe(501);
  });
});
