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
    expect(statement?.values).toEqual(['user_1', 'org_1', 'user_1', 'org_1']);
  });

  // A key that is not a person has no `teamMember` row: a team's key sees
  // with its team, a project's key with its project's own teams, and only
  // while the key is live and bound to this organization.
  it('gives a team key its team and a project key its project’s teams [APIKEY-R6]', async () => {
    const statements: string[] = [];
    const tag = Object.assign(
      (strings: TemplateStringsArray) => {
        const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
        statements.push(text);
        if (text.includes('FROM "teamMember" tm')) {
          return Promise.resolve([
            { teamId: 'team-sales', projectId: null },
            { teamId: null, projectId: 'project-alpha' },
          ]);
        }
        if (text.includes('FROM app.projects')) {
          return Promise.resolve([{ teamIds: ['team-sales', 'team-ops'] }]);
        }
        return Promise.resolve([]);
      },
      { unsafe: (fragment: string) => fragment },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
    const sql = tag as unknown as Sql;

    await expect(getUserTeamIds(sql, 'org_1', 'key_identity')).resolves.toEqual(
      ['team-sales', 'team-ops'],
    );
    expect(statements[0]).toContain("o.owner_kind = 'team'");
    expect(statements[0]).toContain('o.revoked_at_ms IS NULL');
    expect(statements[1]).toContain('FROM app.projects');
  });
});
