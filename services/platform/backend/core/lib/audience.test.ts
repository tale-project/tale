// @vitest-environment node

/**
 * The ONE audience rule (`core/lib/audience.ts`), pinned on both of its
 * forms — the point read (`canSeeAudience`) and its SQL twin
 * (`audienceClause`) — and on the assignment rule every door that stamps an
 * audience runs (`assertTeamsAssignable`). Documents, folders, projects and
 * skills all answer to these; a divergence here would be a divergence
 * everywhere.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  assertTeamsAssignable,
  audienceClause,
  audienceMirror,
  canSeeAudience,
  grantOf,
  isAudienceAdmin,
  normalizeTeamIds,
  PROJECT_TEAM_IDS_SQL,
  sameAudience,
  TeamAssignmentError,
} from './audience.ts';

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}
interface Statement {
  text: string;
  values: unknown[];
}
const isFragment = (value: unknown): value is Fragment =>
  typeof value === 'object' &&
  value !== null &&
  (value as { [FRAGMENT]?: true })[FRAGMENT] === true;

/** A postgres.js stand-in that inlines nested fragments the way the driver
 * does and answers every statement from `answer`. */
function fakeSql(answer: (statement: Statement) => unknown[] = () => []): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
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
    const statement = { text, values: flat };
    statements.push(statement);
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(answer(statement)), fragment);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

describe('isAudienceAdmin', () => {
  it('is true for an owner or admin and nobody else', () => {
    expect(isAudienceAdmin('owner')).toBe(true);
    expect(isAudienceAdmin('admin')).toBe(true);
    for (const role of ['member', 'editor', 'developer', 'disabled', '']) {
      expect(isAudienceAdmin(role), role).toBe(false);
    }
    expect(isAudienceAdmin(null)).toBe(false);
    expect(isAudienceAdmin(undefined)).toBe(false);
  });
});

describe('canSeeAudience', () => {
  const orgWide = { teamIds: [] };
  const finance = { teamIds: ['t-fin'] };
  const both = { teamIds: ['t-fin', 't-ops'] };

  it('shows an organization-wide resource to every member', () => {
    expect(canSeeAudience(orgWide, { role: 'member', teamIds: [] })).toBe(true);
    expect(canSeeAudience(orgWide, { isAdmin: false, teamIds: [] })).toBe(true);
  });

  it('shows a team resource to a member of ANY of its teams', () => {
    expect(canSeeAudience(both, { role: 'member', teamIds: ['t-ops'] })).toBe(
      true,
    );
    expect(
      canSeeAudience(finance, { role: 'editor', teamIds: ['t-fin'] }),
    ).toBe(true);
  });

  it('hides a team resource from a member of none of its teams', () => {
    expect(canSeeAudience(finance, { role: 'member', teamIds: [] })).toBe(
      false,
    );
    expect(
      canSeeAudience(finance, { role: 'developer', teamIds: ['t-ops'] }),
    ).toBe(false);
  });

  it('shows everything to an owner or admin — a team is never a way to hide work from them', () => {
    expect(canSeeAudience(finance, { role: 'admin', teamIds: [] })).toBe(true);
    expect(canSeeAudience(both, { role: 'owner', teamIds: [] })).toBe(true);
    expect(canSeeAudience(finance, { isAdmin: true, teamIds: [] })).toBe(true);
  });

  it('reduces a viewer to the grant a scope carries', () => {
    expect(grantOf({ role: 'admin', teamIds: ['t-fin'] })).toEqual({
      isAdmin: true,
      teamIds: ['t-fin'],
    });
    const grant = { isAdmin: false, teamIds: ['t-ops'] };
    expect(grantOf(grant)).toBe(grant);
  });
});

describe('normalizeTeamIds / sameAudience / audienceMirror', () => {
  it('trims, drops blanks, collapses duplicates and keeps first-seen order', () => {
    expect(normalizeTeamIds([' t-b ', '', 't-a', 't-b', '  '])).toEqual([
      't-b',
      't-a',
    ]);
  });

  it('compares audiences as sets', () => {
    expect(sameAudience(['t-a', 't-b'], ['t-b', 't-a'])).toBe(true);
    expect(sameAudience(['t-a', 't-a'], ['t-a'])).toBe(true);
    expect(sameAudience(['t-a'], ['t-a', 't-b'])).toBe(false);
    expect(sameAudience([], [])).toBe(true);
  });

  it('derives the legacy columns from the array: first team, then the rest', () => {
    expect(audienceMirror([])).toEqual({ teamId: null, sharedWithTeamIds: [] });
    expect(audienceMirror(['t-a'])).toEqual({
      teamId: 't-a',
      sharedWithTeamIds: [],
    });
    expect(audienceMirror(['t-a', 't-b', 't-c'])).toEqual({
      teamId: 't-a',
      sharedWithTeamIds: ['t-b', 't-c'],
    });
  });
});

describe('audienceClause', () => {
  const member = { role: 'member', teamIds: ['t-fin'] };

  it.each([
    ['team_tags', 'team_tags'],
    ['d.team_tags', 'd.team_tags'],
    ['f.team_tags', 'f.team_tags'],
    ['team_ids', 'team_ids'],
    ['p.team_ids', 'p.team_ids'],
  ] as const)('spells the rule over %s', (column, expected) => {
    const { sql } = fakeSql();
    const fragment = audienceClause(sql, column, member);
    expect(fragment).toMatchObject({
      text: `(? OR cardinality(${expected}) = 0 OR ${expected} && ?::text[])`,
      values: [false, ['t-fin']],
    });
  });

  it('reads a project through the rollout-safe expression', () => {
    const { sql } = fakeSql();
    const fragment = audienceClause(sql, 'project_team_ids', member);
    expect(fragment).toMatchObject({
      text: `(? OR cardinality(${PROJECT_TEAM_IDS_SQL}) = 0 OR ${PROJECT_TEAM_IDS_SQL} && ?::text[])`,
      values: [false, ['t-fin']],
    });
  });

  it('binds true for an admin, so the predicate short-circuits in SQL', () => {
    const { sql } = fakeSql();
    const fragment = audienceClause(sql, 'team_tags', {
      role: 'owner',
      teamIds: [],
    });
    expect(fragment).toMatchObject({ values: [true, []] });
    expect(
      audienceClause(sql, 'team_tags', { isAdmin: true, teamIds: ['x'] }),
    ).toMatchObject({ values: [true, ['x']] });
  });

  it('embeds in a statement as one fragment, values in place', () => {
    const { sql, statements } = fakeSql();
    void sql`SELECT id FROM app.documents WHERE org_id = ${'org_1'} AND ${audienceClause(sql, 'team_tags', member)}`;
    expect(statements.at(-1)).toEqual({
      text: 'SELECT id FROM app.documents WHERE org_id = ? AND (? OR cardinality(team_tags) = 0 OR team_tags && ?::text[])',
      values: ['org_1', false, ['t-fin']],
    });
  });
});

describe('assertTeamsAssignable', () => {
  const org = 'org_1';
  const teamsOfOrg = (ids: string[]) => (statement: Statement) =>
    statement.text.startsWith('SELECT "id" FROM "team"')
      ? ids
          .filter((id) => {
            const wanted = statement.values[1];
            return Array.isArray(wanted) && wanted.includes(id);
          })
          .map((id) => ({ id }))
      : [];

  it('answers organization-wide without a read', async () => {
    const { sql, statements } = fakeSql();
    await expect(
      assertTeamsAssignable(
        sql,
        { organizationId: org, role: 'member', teamIds: [] },
        [' ', ''],
      ),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(0);
  });

  it('reads the teams of THIS organization only', async () => {
    const { sql, statements } = fakeSql(teamsOfOrg(['t-fin']));
    await assertTeamsAssignable(
      sql,
      { organizationId: org, role: 'admin', teamIds: [] },
      ['t-fin'],
    );
    expect(statements[0]?.text).toContain(
      '"organizationId" = ? AND "id" = ANY(?)',
    );
    expect(statements[0]?.values).toEqual([org, ['t-fin']]);
  });

  it('refuses an id that is not one of the organization’s teams (400), naming it', async () => {
    const { sql } = fakeSql(teamsOfOrg(['t-fin']));
    const attempt = assertTeamsAssignable(
      sql,
      { organizationId: org, role: 'admin', teamIds: [] },
      ['t-fin', 't-other-org'],
    );
    await expect(attempt).rejects.toBeInstanceOf(TeamAssignmentError);
    await expect(attempt).rejects.toMatchObject({
      code: 'TEAM_NOT_IN_ORG',
      status: 400,
      data: { teamIds: ['t-other-org'] },
    });
  });

  it('lets an admin file into any team of the organization', async () => {
    const { sql } = fakeSql(teamsOfOrg(['t-fin', 't-ops']));
    await expect(
      assertTeamsAssignable(
        sql,
        { organizationId: org, role: 'admin', teamIds: [] },
        ['t-ops', 't-fin', 't-ops'],
      ),
    ).resolves.toEqual(['t-ops', 't-fin']);
  });

  it('lets a member file only into teams they belong to (403 names the others)', async () => {
    const { sql } = fakeSql(teamsOfOrg(['t-fin', 't-ops', 't-hr']));
    const viewer = { organizationId: org, role: 'member', teamIds: ['t-fin'] };
    await expect(
      assertTeamsAssignable(sql, viewer, ['t-fin']),
    ).resolves.toEqual(['t-fin']);
    await expect(
      assertTeamsAssignable(sql, viewer, ['t-fin', 't-ops', 't-hr']),
    ).rejects.toMatchObject({
      code: 'TEAM_ACCESS_DENIED',
      status: 403,
      data: { teamIds: ['t-ops', 't-hr'] },
    });
  });

  it('checks the organization before the membership — an unknown id is 400 even for a member', async () => {
    const { sql } = fakeSql(teamsOfOrg(['t-fin']));
    await expect(
      assertTeamsAssignable(
        sql,
        { organizationId: org, role: 'member', teamIds: ['t-fin'] },
        ['t-ghost'],
      ),
    ).rejects.toMatchObject({ code: 'TEAM_NOT_IN_ORG', status: 400 });
  });
});
