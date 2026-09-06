// @vitest-environment node

/**
 * `getUserTeamIds` is the team half of every access prime (projects,
 * folders, documents, conversations, budgets). It once read `"teamMember"`
 * alone — every team the user belonged to in ANY organization — so an
 * org-A project shared with an org-B team id opened to org-A members who
 * happened to sit in that org-B team: access derived from another tenant's
 * membership. This pins the read to the caller's organization through the
 * team's own row.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { getUserTeamIds } from './membership.ts';

function fakeSql(rows: { teamId: string }[]): {
  sql: Sql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

describe('getUserTeamIds', () => {
  it('reads only the memberships whose team belongs to the given org', async () => {
    const { sql, statements } = fakeSql([{ teamId: 'team-a' }]);
    await expect(getUserTeamIds(sql, 'org_1', 'user_1')).resolves.toEqual([
      'team-a',
    ]);
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement?.text).toContain('JOIN "team" t ON t."id" = tm."teamId"');
    expect(statement?.text).toContain('t."organizationId" = ?');
    expect(statement?.values).toEqual(['user_1', 'org_1']);
  });
});
