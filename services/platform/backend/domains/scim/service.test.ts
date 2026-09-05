// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  deleteGroup,
  patchGroup,
  patchUser,
  provisionGroup,
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
