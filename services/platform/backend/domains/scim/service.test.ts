// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  MEMBER_HINT_ENTITY,
  TEAM_HINT_ENTITY,
} from '../../../lib/shared/hint-entities.ts';
import {
  deleteGroup,
  deprovisionUser,
  listGroupRecords,
  listUserRecords,
  patchGroup,
  patchUser,
  provisionGroup,
  provisionUser,
  replaceGroup,
} from './service.ts';

/**
 * The SCIM authorization and identity guards: the org owner is protected on
 * PATCH exactly as on DELETE; a `userName` rewrite honours uniqueness and
 * never rewrites an identity other orgs rely on; a Group write accepts only
 * this org's members.
 */

interface Captured {
  text: string;
  values: unknown[];
}

/** What `createAuditLog` needs back from an empty chain (genesis head, one
 * inserted row) — every successful SCIM write audits. */
function auditChainAnswers(text: string): object[] | undefined {
  if (text.startsWith('SELECT last_hash AS "lastHash"')) {
    return [{ lastHash: '', lastTs: 0 }];
  }
  if (text.startsWith('INSERT INTO app.audit_logs')) return [{ id: 'audit-1' }];
  return undefined;
}

function fakeSql(answer: (text: string) => object[] | undefined): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    try {
      return Promise.resolve(auditChainAnswers(text) ?? answer(text) ?? []);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const begin = async (cb: (tx: unknown) => Promise<unknown>) => cb(tag);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double (createAuditLog needs tx.json)
    sql: Object.assign(tag, {
      begin,
      json: (value: unknown) => value,
    }) as unknown as Sql,
    queries,
  };
}

const writes = (queries: Captured[]): Captured[] =>
  queries.filter(
    (q) =>
      q.text.startsWith('INSERT') ||
      q.text.startsWith('UPDATE') ||
      q.text.startsWith('DELETE'),
  );

/** The invalidation hints a call wrote, as `[orgId, userId, entity, id]`. */
const hints = (queries: Captured[]): unknown[][] =>
  queries
    .filter((q) => q.text.startsWith('INSERT INTO app_realtime.outbox'))
    .map((q) => q.values);

const MEMBER = 'SELECT "id", "role" FROM "member"';
const USER_BY_ID =
  'SELECT "id", "email", "name", "createdAt", "updatedAt" FROM "user" WHERE "id"';
const USER_BY_EMAIL =
  'SELECT "id", "email", "name", "createdAt", "updatedAt" FROM "user" WHERE "email"';
const MEMBERSHIPS = 'SELECT "organizationId" FROM "member"';
const ORG_MEMBERS = 'SELECT "userId" FROM "member"';
const TEAM_BY_ID =
  'SELECT "id", "name", "organizationId", "createdAt", "updatedAt" FROM "team" WHERE "id"';

const userRow = (id: string, email: string) => ({
  id,
  email,
  name: 'Some One',
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('patchUser — the owner is protected on PATCH exactly as on DELETE', () => {
  it('refuses active:false on the owner before any write', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-owner', role: 'owner' }];
      return [];
    });

    await expect(
      patchUser(sql, {
        organizationId: 'org-1',
        userId: 'owner-1',
        defaultRole: 'member',
        active: false,
        externalId: 'idp-1',
        name: 'Still Owner',
      }),
    ).rejects.toThrow(/scim_owner_protected/);
    // Atomic refusal: not the externalId link, not the rename, not the role.
    expect(writes(queries)).toHaveLength(0);
  });

  it('still soft-deactivates a non-owner', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-1', role: 'developer' }];
      return [];
    });

    const result = await patchUser(sql, {
      organizationId: 'org-1',
      userId: 'u-1',
      defaultRole: 'member',
      active: false,
    });

    expect(result?.active).toBe(false);
    const roleWrite = queries.find((q) =>
      q.text.startsWith('UPDATE "member" SET "role"'),
    );
    expect(roleWrite?.values).toEqual(['disabled', 'm-1']);
  });

  it('lets the owner keep receiving other attribute updates', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-owner', role: 'owner' }];
      return [];
    });

    const result = await patchUser(sql, {
      organizationId: 'org-1',
      userId: 'owner-1',
      defaultRole: 'member',
      active: true,
      name: 'Renamed Owner',
    });

    expect(result?.active).toBe(true);
    const rename = queries.find((q) => q.text.startsWith('UPDATE "user"'));
    expect(rename?.values).toContain('Renamed Owner');
  });
});

describe('patchUser — the userName rewrite contract', () => {
  const singleOrgUser =
    (extra: (text: string) => object[] | undefined) => (text: string) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-1', role: 'member' }];
      if (text.startsWith(USER_BY_ID)) {
        return [userRow('u-1', 'old@example.com')];
      }
      const answered = extra(text);
      if (answered !== undefined) return answered;
      if (text.startsWith(MEMBERSHIPS)) return [{ organizationId: 'org-1' }];
      return [];
    };
  const patchEmail = (sql: Sql, email: string) =>
    patchUser(sql, {
      organizationId: 'org-1',
      userId: 'u-1',
      defaultRole: 'member',
      email,
    });

  it('refuses a collision with the SCIM uniqueness code instead of a unique-index 500', async () => {
    const { sql, queries } = fakeSql(
      singleOrgUser((text) => {
        if (text.startsWith(USER_BY_EMAIL)) {
          return [userRow('u-2', 'taken@example.com')];
        }
        return undefined;
      }),
    );

    await expect(patchEmail(sql, 'taken@example.com')).rejects.toThrow(
      /scim_user_conflict/,
    );
    expect(writes(queries)).toHaveLength(0);
  });

  it('refuses to rewrite the identity of an account that also belongs to another org', async () => {
    const { sql, queries } = fakeSql(
      singleOrgUser((text) => {
        if (text.startsWith(MEMBERSHIPS)) {
          return [{ organizationId: 'org-1' }, { organizationId: 'org-2' }];
        }
        return undefined;
      }),
    );

    await expect(patchEmail(sql, 'new@example.com')).rejects.toThrow(
      /scim_identity_shared/,
    );
    expect(writes(queries)).toHaveLength(0);
  });

  it("rewrites a single-org account's userName, normalized", async () => {
    const { sql, queries } = fakeSql(singleOrgUser(() => undefined));

    const result = await patchEmail(sql, ' New@Example.com ');

    expect(result).not.toBeNull();
    const rewrite = queries.find((q) => q.text.startsWith('UPDATE "user"'));
    expect(rewrite?.values).toContain('new@example.com');
  });

  it('is a no-op when the userName is unchanged after normalization', async () => {
    const { sql, queries } = fakeSql(singleOrgUser(() => undefined));

    await patchEmail(sql, 'OLD@example.com');

    expect(writes(queries)).toHaveLength(0);
    expect(queries.some((q) => q.text.startsWith(USER_BY_EMAIL))).toBe(false);
  });

  it('maps a lost uniqueness race to the same 409 code', async () => {
    const { sql } = fakeSql(
      singleOrgUser((text) => {
        if (text.startsWith('UPDATE "user"')) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        return undefined;
      }),
    );

    await expect(patchEmail(sql, 'new@example.com')).rejects.toThrow(
      /scim_user_conflict/,
    );
  });
});

describe('group writes — every member must belong to the org', () => {
  const team = {
    id: 't-1',
    name: 'Squad',
    organizationId: 'org-1',
    createdAt: new Date(0),
    updatedAt: null,
  };

  it('provisionGroup refuses a foreign or unknown member id before inserting anything', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('INSERT INTO "team"')) return [{ id: 't-1' }];
      if (text.startsWith(ORG_MEMBERS)) return [{ userId: 'u-in' }];
      return [];
    });

    await expect(
      provisionGroup(sql, {
        organizationId: 'org-1',
        displayName: 'Squad',
        memberIds: ['u-in', 'u-foreign'],
      }),
    ).rejects.toThrow(/u-foreign/);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "teamMember"')),
    ).toBe(false);
    const gate = queries.find((q) => q.text.startsWith(ORG_MEMBERS));
    expect(gate?.values[0]).toBe('org-1');
  });

  it('replaceGroup applies the same gate', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(TEAM_BY_ID)) return [team];
      if (text.startsWith(ORG_MEMBERS)) return [];
      return [];
    });

    await expect(
      replaceGroup(sql, {
        organizationId: 'org-1',
        teamId: 't-1',
        displayName: 'Squad',
        memberIds: ['u-foreign'],
      }),
    ).rejects.toThrow(/scim_invalid_member/);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "teamMember"')),
    ).toBe(false);
  });

  it('patchGroup refuses to add a foreign member id', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(TEAM_BY_ID)) return [team];
      if (text.startsWith(ORG_MEMBERS)) return [];
      return [];
    });

    await expect(
      patchGroup(sql, {
        organizationId: 'org-1',
        teamId: 't-1',
        addMembers: ['u-foreign'],
        removeMembers: [],
      }),
    ).rejects.toThrow(/scim_invalid_member/);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "teamMember"')),
    ).toBe(false);
  });

  it('patchGroup adds members of the org', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(TEAM_BY_ID)) return [team];
      if (text.startsWith(ORG_MEMBERS)) return [{ userId: 'u-in' }];
      return [];
    });

    const result = await patchGroup(sql, {
      organizationId: 'org-1',
      teamId: 't-1',
      addMembers: ['u-in'],
      removeMembers: [],
    });

    expect(result).not.toBeNull();
    const added = queries.find((q) =>
      q.text.startsWith('INSERT INTO "teamMember"'),
    );
    expect(added?.values).toEqual(expect.arrayContaining(['t-1', 'u-in']));
  });
});

describe('deleteGroup', () => {
  it('retires the scopes the group carried in the same transaction and audits the counts', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (
        text.startsWith('SELECT "id", "name", "organizationId", "createdAt"')
      ) {
        return [{ id: 't-fin', name: 'Finance', organizationId: 'org-1' }];
      }
      if (text.startsWith('UPDATE app.projects SET team_id')) {
        return [{ id: 'p1' }];
      }
      return undefined;
    });

    await expect(deleteGroup(sql, 'org-1', 't-fin')).resolves.toBe(true);

    const order = writes(queries).map((q) =>
      q.text.split(' ').slice(0, 3).join(' '),
    );
    expect(order.indexOf('DELETE FROM "team"')).toBeLessThan(
      order.indexOf('UPDATE app.projects SET'),
    );
    const audit = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.audit_logs'),
    );
    expect(audit?.values).toContain('scim_delete_group');
    expect(JSON.stringify(audit?.values)).toContain('"projectsUnscoped":1');
  });

  it('answers false and writes nothing for a team of another org', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (
        text.startsWith('SELECT "id", "name", "organizationId", "createdAt"')
      ) {
        return [{ id: 't-x', name: 'X', organizationId: 'org-other' }];
      }
      return undefined;
    });
    await expect(deleteGroup(sql, 'org-1', 't-x')).resolves.toBe(false);
    expect(writes(queries)).toEqual([]);
  });
});

/**
 * SCIM DELETE removes the whole per-org footprint, not just the member row:
 * Better Auth's own deleteMember drops the user's teamMember rows when
 * teams are enabled, and a later POST re-attaches the existing user, so a
 * stranded team membership would come straight back into force.
 */
describe('deprovisionUser — the membership cascade', () => {
  it('removes team memberships, sync provenance and preferences with the member row', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-1', role: 'member' }];
      if (text.startsWith(USER_BY_ID)) return [userRow('u-1', 'u1@x.test')];
      return [];
    });

    const verdict = await deprovisionUser(sql, 'org-1', 'u-1');

    expect(verdict).toBe('deprovisioned');
    const deleted = writes(queries).filter((q) => q.text.startsWith('DELETE'));
    const memberAt = deleted.findIndex((q) =>
      q.text.startsWith('DELETE FROM "member"'),
    );
    const teamsAt = deleted.findIndex((q) =>
      q.text.startsWith('DELETE FROM "teamMember"'),
    );
    const teams = deleted[teamsAt];
    expect(teams?.text).toContain('WHERE "organizationId" = $?');
    expect(teams?.values).toEqual(['u-1', 'org-1']);
    // The cascade reports the teams it left, for the callers that emit hints.
    expect(teams?.text).toContain('RETURNING "teamId"');
    expect(
      deleted.find((q) =>
        q.text.startsWith('DELETE FROM app.sso_synced_team_members'),
      )?.values,
    ).toEqual(['org-1', 'u-1']);
    expect(
      deleted.find((q) => q.text.startsWith('DELETE FROM app.user_preferences'))
        ?.values,
    ).toEqual(['org-1', 'u-1']);
    // The cascade rides the same transaction, after the member row.
    expect(memberAt).toBeGreaterThanOrEqual(0);
    expect(teamsAt).toBeGreaterThan(memberAt);
    // The member's platform-capability grants end with it — stamped revoked,
    // never deleted — so the IdP's next POST re-attaching the user brings no
    // delegated right back.
    const all = writes(queries);
    const revokeAt = all.findIndex((q) =>
      q.text.startsWith('UPDATE app.competence_records'),
    );
    expect(all[revokeAt]?.values).toEqual([expect.any(Number), 'org-1', 'u-1']);
    expect(revokeAt).toBeGreaterThan(
      all.findIndex((q) => q.text.startsWith('DELETE FROM "member"')),
    );
  });

  it('cascades nothing for a member it refuses to remove', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-owner', role: 'owner' }];
      return [];
    });

    const verdict = await deprovisionUser(sql, 'org-1', 'u-owner');

    expect(verdict).toBe('owner-protected');
    expect(writes(queries)).toEqual([]);
  });
});

/**
 * The listings an IdP polls are paged IN SQL: one ordered page plus the
 * collection total, never the whole org sorted and sliced in memory — and
 * the groups page aggregates members in the same query instead of two
 * queries per team.
 */
describe('listings page in SQL', () => {
  it('listUserRecords asks for one ordered page and the collection total', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT count(*)::int AS total FROM "member"')) {
        return [{ total: 7 }];
      }
      if (text.startsWith('SELECT u."id"')) {
        return [
          {
            ...userRow('u-3', 'c@x.test'),
            memberId: 'm-3',
            role: 'member',
            externalId: 'ext-3',
          },
        ];
      }
      return [];
    });

    const page = await listUserRecords(sql, 'org-1', { offset: 2, limit: 2 });

    expect(page.total).toBe(7);
    expect(page.records.map((r) => r.userId)).toEqual(['u-3']);
    expect(page.records[0]?.externalId).toBe('ext-3');
    const listing = queries.find((q) => q.text.startsWith('SELECT u."id"'));
    expect(listing?.text).toContain('ORDER BY u."id" LIMIT $? OFFSET $?');
    expect(listing?.values).toEqual(['org-1', 2, 2]);
    // The total counts exactly the rows the page walks — same user join.
    const total = queries.find((q) =>
      q.text.startsWith('SELECT count(*)::int AS total FROM "member"'),
    );
    expect(total?.text).toContain('JOIN "user" u ON u."id" = m."userId"');
    expect(total?.values).toEqual(['org-1']);
  });

  it('listGroupRecords aggregates members in the page query', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT count(*)::int AS total FROM "team"')) {
        return [{ total: 1 }];
      }
      if (text.startsWith('SELECT t."id"')) {
        return [
          {
            id: 't-1',
            name: 'Crew',
            organizationId: 'org-1',
            createdAt: new Date(0),
            updatedAt: null,
            memberUserIds: ['u-1', 'u-2'],
            externalId: null,
          },
        ];
      }
      return [];
    });

    const page = await listGroupRecords(sql, 'org-1', { offset: 0, limit: 5 });

    expect(page.total).toBe(1);
    expect(page.records[0]?.memberUserIds).toEqual(['u-1', 'u-2']);
    const listing = queries.find((q) => q.text.startsWith('SELECT t."id"'));
    expect(listing?.text).toContain('array_agg(tm."userId"');
    expect(listing?.text).toContain('ORDER BY t."id" LIMIT $? OFFSET $?');
    expect(listing?.values).toEqual(['org-1', 5, 0]);
    // No per-team member or link lookups ride the page.
    expect(
      queries.some((q) =>
        q.text.startsWith('SELECT "id", "userId" FROM "teamMember"'),
      ),
    ).toBe(false);
  });
});

/**
 * An IdP push is the one write nobody in the app is watching for: no dialog
 * ran, no tab invalidated anything. Without a hint in the same transaction,
 * an open Members or Teams page kept the pre-sync list until someone
 * reloaded it — the whole SCIM lane emitted none.
 */
describe('SCIM writes emit their invalidation hints', () => {
  const team = {
    id: 't-1',
    name: 'Squad',
    organizationId: 'org-1',
    createdAt: new Date(0),
    updatedAt: null,
  };

  it('provisionUser hints the new membership', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(USER_BY_EMAIL)) return [];
      if (text.startsWith('INSERT INTO "user"')) return [{ id: 'u-new' }];
      return [];
    });

    await provisionUser(sql, {
      organizationId: 'org-1',
      defaultRole: 'member',
      email: 'new@x.test',
      name: 'New One',
      active: true,
    });

    expect(hints(queries)).toEqual([
      ['org-1', null, MEMBER_HINT_ENTITY, 'u-new'],
    ]);
  });

  it('patchUser hints once for the whole patch', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-1', role: 'member' }];
      return [];
    });

    await patchUser(sql, {
      organizationId: 'org-1',
      userId: 'u-1',
      defaultRole: 'member',
      active: false,
      name: 'Renamed',
    });

    expect(hints(queries)).toEqual([
      ['org-1', null, MEMBER_HINT_ENTITY, 'u-1'],
    ]);
  });

  // The cascade shrinks every team the member sat in, so each one's counts
  // are stale until it is hinted — the members door already does this.
  it('deprovisionUser hints the membership and every team the cascade shrank', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-1', role: 'member' }];
      if (text.startsWith(USER_BY_ID)) return [userRow('u-1', 'u1@x.test')];
      if (text.startsWith('DELETE FROM "teamMember"')) {
        return [{ teamId: 't-a' }, { teamId: 't-b' }];
      }
      return [];
    });

    await expect(deprovisionUser(sql, 'org-1', 'u-1')).resolves.toBe(
      'deprovisioned',
    );

    expect(hints(queries)).toEqual([
      ['org-1', null, MEMBER_HINT_ENTITY, 'u-1'],
      ['org-1', null, TEAM_HINT_ENTITY, 't-a'],
      ['org-1', null, TEAM_HINT_ENTITY, 't-b'],
    ]);
  });

  it('a refused write emits nothing', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-owner', role: 'owner' }];
      return [];
    });

    await expect(deprovisionUser(sql, 'org-1', 'u-owner')).resolves.toBe(
      'owner-protected',
    );

    expect(hints(queries)).toEqual([]);
  });

  it('provisionGroup hints the new team', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('INSERT INTO "team"')) return [{ id: 't-new' }];
      return [];
    });

    await provisionGroup(sql, {
      organizationId: 'org-1',
      displayName: 'Squad',
      memberIds: [],
    });

    expect(hints(queries)).toEqual([
      ['org-1', null, TEAM_HINT_ENTITY, 't-new'],
    ]);
  });

  // An IdP re-pushes its whole directory on a schedule. Hinting those calls
  // would invalidate every connected client's reads once per synced record,
  // per cycle, for nothing.
  it('a re-push that moves nothing emits no hint', async () => {
    const unchanged = fakeSql((text) => {
      if (text.startsWith(MEMBER)) return [{ id: 'm-1', role: 'member' }];
      return [];
    });
    await patchUser(unchanged.sql, {
      organizationId: 'org-1',
      userId: 'u-1',
      defaultRole: 'member',
      externalId: 'ext-1',
    });
    expect(hints(unchanged.queries)).toEqual([]);

    const sameRoster = fakeSql((text) => {
      if (text.startsWith(TEAM_BY_ID)) return [team];
      if (text.startsWith('SELECT "id", "userId" FROM "teamMember"')) {
        return [{ id: 'tm-1', userId: 'u-1' }];
      }
      if (text.startsWith(ORG_MEMBERS)) return [{ userId: 'u-1' }];
      return [];
    });
    await replaceGroup(sameRoster.sql, {
      organizationId: 'org-1',
      teamId: 't-1',
      displayName: team.name,
      memberIds: ['u-1'],
    });
    expect(hints(sameRoster.queries)).toEqual([]);
  });

  it('replaceGroup and patchGroup hint the team they rewrote', async () => {
    const answer = (text: string) =>
      text.startsWith(TEAM_BY_ID) ? [team] : [];

    const replaced = fakeSql(answer);
    await replaceGroup(replaced.sql, {
      organizationId: 'org-1',
      teamId: 't-1',
      displayName: 'Renamed',
      memberIds: [],
    });
    expect(hints(replaced.queries)).toEqual([
      ['org-1', null, TEAM_HINT_ENTITY, 't-1'],
    ]);

    const patched = fakeSql(answer);
    await patchGroup(patched.sql, {
      organizationId: 'org-1',
      teamId: 't-1',
      displayName: 'Renamed again',
      addMembers: [],
      removeMembers: [],
    });
    expect(hints(patched.queries)).toEqual([
      ['org-1', null, TEAM_HINT_ENTITY, 't-1'],
    ]);
  });

  it('deleteGroup hints the team it removed', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith(TEAM_BY_ID) ? [team] : [],
    );

    await expect(deleteGroup(sql, 'org-1', 't-1')).resolves.toBe(true);

    expect(hints(queries)).toEqual([['org-1', null, TEAM_HINT_ENTITY, 't-1']]);
  });

  it('a group of another org is refused without a hint', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith(TEAM_BY_ID)
        ? [{ ...team, organizationId: 'org-other' }]
        : [],
    );

    await expect(deleteGroup(sql, 'org-1', 't-1')).resolves.toBe(false);

    expect(hints(queries)).toEqual([]);
  });
});
