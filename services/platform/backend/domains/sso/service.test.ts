// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  createSsoUserSession,
  findOrCreateSsoUser,
  handleSsoLogin,
  shouldSyncMemberRole,
  syncTeamsFromGroupNames,
} from './service.ts';

/**
 * The SSO org-binding contract: an org's IdP may sign in users the org
 * ALREADY has (a member row) and may JIT-create users new to the deployment
 * — but an existing user with no membership in that org is refused, because
 * org admins self-serve their IdP config and a global email match would let
 * a hostile org's IdP mint sessions as any user on the deployment
 * (cross-org account takeover).
 */

interface Captured {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (text: string) => object[] | undefined): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(answer(text) ?? []);
  };
  const begin = async (cb: (tx: unknown) => Promise<unknown>) => cb(tag);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    sql: Object.assign(tag, { begin }) as unknown as Sql,
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

const baseArgs = {
  name: 'Victim User',
  externalId: 'ext-1',
  providerId: 'entra-id',
  accessToken: 'token',
  role: 'member' as const,
};

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-service-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  clearOrgConfigCaches();
});

afterEach(async () => {
  if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = savedConfigDir;
  await rm(configRoot, { recursive: true, force: true });
  clearOrgConfigCaches();
});

/**
 * "Auto-assign roles from the IdP" must keep an EXISTING member's role in sync
 * on every login (a promotion/demotion in the IdP should propagate), not just at
 * first provision — but it must never demote the org owner.
 */
describe('shouldSyncMemberRole', () => {
  it('promotes an existing member when the mapped role differs', () => {
    expect(shouldSyncMemberRole(true, 'member', 'admin')).toBe(true);
  });

  it('demotes an existing member when the mapped role drops', () => {
    expect(shouldSyncMemberRole(true, 'admin', 'member')).toBe(true);
  });

  it('is a no-op when the role is unchanged', () => {
    expect(shouldSyncMemberRole(true, 'admin', 'admin')).toBe(false);
  });

  it('never touches the owner (would orphan the org)', () => {
    expect(shouldSyncMemberRole(true, 'owner', 'admin')).toBe(false);
  });

  it('does nothing when auto-assign is off', () => {
    expect(shouldSyncMemberRole(false, 'member', 'admin')).toBe(false);
    expect(shouldSyncMemberRole(undefined, 'member', 'admin')).toBe(false);
  });
});

describe('findOrCreateSsoUser — org-binding contract', () => {
  it('refuses an existing user with no membership in the connection org, writing nothing', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "user"')) {
        return [{ id: 'victim-user' }];
      }
      if (text.startsWith('SELECT "id", "role" FROM "member"')) return [];
      return [];
    });

    const result = await findOrCreateSsoUser(sql, {
      ...baseArgs,
      email: 'victim@example.com',
      organizationId: 'rogue-org',
    });

    expect(result).toEqual({
      userId: null,
      isNewUser: false,
      refusal: 'existing_user_not_in_org',
    });
    // No account link, no auto-join, nothing for the caller to mint from.
    expect(writes(queries)).toHaveLength(0);
  });

  it('signs in an existing member, attaching the provider account', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "user"')) {
        return [{ id: 'member-user' }];
      }
      if (text.startsWith('SELECT "id", "role" FROM "member"')) {
        return [{ id: 'm1', role: 'member' }];
      }
      if (text.startsWith('SELECT "id" FROM "account"')) return [];
      return [];
    });

    const result = await findOrCreateSsoUser(sql, {
      ...baseArgs,
      email: 'member@example.com',
      organizationId: 'their-org',
    });

    expect(result).toEqual({ userId: 'member-user', isNewUser: false });
    const written = writes(queries);
    expect(written).toHaveLength(1);
    expect(written[0]?.text).toContain('INSERT INTO "account"');
    // The membership was NOT (re)created — it already existed.
    expect(queries.some((q) => q.text.startsWith('INSERT INTO "member"'))).toBe(
      false,
    );
  });

  it('JIT-creates a user new to the deployment, bound to the connection org', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "user"')) return [];
      if (text.startsWith('INSERT INTO "user"')) return [{ id: 'fresh-user' }];
      return [];
    });

    const result = await findOrCreateSsoUser(sql, {
      ...baseArgs,
      email: 'newhire@example.com',
      organizationId: 'their-org',
    });

    expect(result).toEqual({ userId: 'fresh-user', isNewUser: true });
    const memberInsert = queries.find((q) =>
      q.text.startsWith('INSERT INTO "member"'),
    );
    expect(memberInsert).toBeDefined();
    expect(memberInsert?.values).toContain('their-org');
    expect(memberInsert?.values).toContain('fresh-user');
  });
});

describe('handleSsoLogin — refusal surfaces, session binds the org', () => {
  it('answers the actionable error key and mints NO session for a non-member', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "slug" FROM "organization"')) {
        return [{ slug: 'rogue-org-a' }];
      }
      if (text.startsWith('SELECT "id" FROM "user"')) {
        return [{ id: 'victim-user' }];
      }
      if (text.startsWith('SELECT "id", "role" FROM "member"')) return [];
      return [];
    });

    const result = await handleSsoLogin(sql, {
      email: 'victim@example.com',
      name: 'Victim User',
      externalId: 'ext-1',
      providerId: 'entra-id',
      accessToken: 'token',
      organizationId: 'org-rogue-a',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('sso.errors.notOrgMember');
    expect(result.sessionToken).toBeUndefined();
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(false);
  });

  it("mints the member's session with activeOrganizationId bound to the SSO org", async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "slug" FROM "organization"')) {
        return [{ slug: 'member-org-b' }];
      }
      if (text.startsWith('SELECT "id" FROM "user"')) {
        return [{ id: 'member-user' }];
      }
      if (text.startsWith('SELECT "id", "role" FROM "member"')) {
        return [{ id: 'm1', role: 'member' }];
      }
      return [];
    });

    const result = await handleSsoLogin(sql, {
      email: 'member@example.com',
      name: 'Member User',
      externalId: 'ext-2',
      providerId: 'entra-id',
      accessToken: 'token',
      organizationId: 'org-member-b',
    });

    expect(result.success).toBe(true);
    expect(result.sessionToken).toBeDefined();
    const sessionInsert = queries.find((q) =>
      q.text.startsWith('INSERT INTO "session"'),
    );
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert?.text).toContain('"activeOrganizationId"');
    expect(sessionInsert?.values).toContain('org-member-b');
  });
});

describe('createSsoUserSession', () => {
  it('binds the session to the SSO org', async () => {
    const { sql, queries } = fakeSql(() => []);

    const { sessionToken } = await createSsoUserSession(sql, {
      userId: 'user-1',
      organizationId: 'org-1',
    });

    expect(sessionToken).not.toBe('');
    expect(queries[0]?.text).toContain('"activeOrganizationId"');
    expect(queries[0]?.values).toContain('org-1');
    expect(queries[0]?.values).toContain('user-1');
  });
});

/**
 * Provenance-scoped team sync: the sign-in sync may prune ONLY what it
 * created (rows in app.sso_synced_teams / app.sso_synced_team_members). The
 * regression: the prune removed the user from EVERY org team whose name was
 * absent from the IdP claim and deleted the emptied team — admin-built and
 * SCIM-managed teams vanished on a routine login.
 */
describe('syncTeamsFromGroupNames — provenance-scoped reconcile', () => {
  const syncArgs = {
    userId: 'u-1',
    organizationId: 'org-1',
    excludeGroups: ['Everyone'],
  };
  const deletes = (queries: Captured[]): Captured[] =>
    queries.filter((q) => q.text.startsWith('DELETE'));

  it('records provenance for the team and the membership it creates', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "team"')) return [];
      if (text.startsWith('INSERT INTO "team"')) return [{ id: 't-ops' }];
      if (text.startsWith('SELECT "id" FROM "teamMember"')) return [];
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Ops', 'Everyone'],
    });

    expect(result).toEqual({
      teamsCreated: 1,
      membershipsAdded: 1,
      membershipsRemoved: 0,
      errors: [],
    });
    const teamProvenance = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.sso_synced_teams'),
    );
    expect(teamProvenance?.values).toEqual(
      expect.arrayContaining(['org-1', 't-ops']),
    );
    const membershipProvenance = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.sso_synced_team_members'),
    );
    expect(membershipProvenance?.values).toEqual(
      expect.arrayContaining(['org-1', 't-ops', 'u-1']),
    );
    // The excluded group is unmanaged: not even looked up.
    const lookups = queries.filter((q) =>
      q.text.startsWith('SELECT "id" FROM "team"'),
    );
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.values).toContain('ops');
  });

  it('joins an existing admin-built team without claiming the team itself', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "team"'))
        return [{ id: 't-board' }];
      if (text.startsWith('SELECT "id" FROM "teamMember"')) return [];
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Board'],
    });

    expect(result.teamsCreated).toBe(0);
    expect(result.membershipsAdded).toBe(1);
    expect(queries.some((q) => q.text.startsWith('INSERT INTO "team"'))).toBe(
      false,
    );
    expect(
      queries.some((q) =>
        q.text.startsWith('INSERT INTO app.sso_synced_teams'),
      ),
    ).toBe(false);
    // The membership IS the sync's — it may revoke it later.
    expect(
      queries.some((q) =>
        q.text.startsWith('INSERT INTO app.sso_synced_team_members'),
      ),
    ).toBe(true);
  });

  it('does not adopt a membership that already existed (admin- or SCIM-granted)', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "team"'))
        return [{ id: 't-board' }];
      if (text.startsWith('SELECT "id" FROM "teamMember"')) {
        return [{ id: 'tm-board' }];
      }
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Board'],
    });

    expect(result.membershipsAdded).toBe(0);
    expect(writes(queries)).toHaveLength(0);
  });

  it('leaves a membership an admin granted alone when its group is absent (the data-loss regression)', async () => {
    // The user sits in the admin-built team "Board" (no provenance row) and
    // the claim carries only "Finance", where they are already a member.
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "team"')) return [{ id: 't-fin' }];
      if (text.startsWith('SELECT "id" FROM "teamMember"')) {
        return [{ id: 'tm-fin' }];
      }
      // The old prune read EVERY membership of the user in the org's teams —
      // answer it with the admin-granted one so the regression would fire.
      if (text.startsWith('SELECT tm."id", tm."teamId"')) {
        return [{ id: 'tm-board', teamId: 't-board', teamName: 'Board' }];
      }
      // The provenance-scoped reconcile: nothing the sync ever granted.
      if (text.startsWith('SELECT p.team_id')) return [];
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Finance'],
    });

    expect(result.membershipsRemoved).toBe(0);
    expect(deletes(queries)).toHaveLength(0);
  });

  it('revokes only the membership it granted and reaps only the team it created', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT "id" FROM "team"')) return [{ id: 't-fin' }];
      if (text.startsWith('SELECT "id" FROM "teamMember"')) {
        return [{ id: 'tm-fin' }];
      }
      if (text.startsWith('SELECT p.team_id')) {
        return [{ teamId: 't-ops', teamName: 'Ops', membershipId: 'tm-ops' }];
      }
      if (text.startsWith('SELECT NOT EXISTS')) {
        return [{ empty: true, syncCreated: true, scimManaged: false }];
      }
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Finance'],
    });

    expect(result.membershipsRemoved).toBe(1);
    const removed = deletes(queries);
    expect(removed.map((q) => q.text.split(' WHERE')[0])).toEqual([
      'DELETE FROM "teamMember"',
      'DELETE FROM app.sso_synced_team_members',
      'DELETE FROM "team"',
      'DELETE FROM app.sso_synced_teams',
    ]);
    expect(removed[0]?.values).toEqual(['tm-ops']);
    expect(removed[2]?.values).toEqual(['t-ops', 'org-1']);
  });

  it.each([
    [
      'an admin-built team the sync merely joined',
      { empty: true, syncCreated: false, scimManaged: false },
    ],
    [
      'a SCIM-managed team, even one the sync created',
      { empty: true, syncCreated: true, scimManaged: true },
    ],
    [
      'a team that still has members',
      { empty: false, syncCreated: true, scimManaged: false },
    ],
  ])('revokes its membership but never reaps %s', async (_label, verdict) => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT p.team_id')) {
        return [{ teamId: 't-x', teamName: 'X', membershipId: 'tm-x' }];
      }
      if (text.startsWith('SELECT NOT EXISTS')) return [verdict];
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Finance'],
    });

    expect(result.membershipsRemoved).toBe(1);
    expect(
      queries.some((q) => q.text.startsWith('DELETE FROM "teamMember"')),
    ).toBe(true);
    expect(queries.some((q) => q.text.startsWith('DELETE FROM "team"'))).toBe(
      false,
    );
  });

  it('treats an excluded group as unmanaged — its synced membership is not pruned either', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT p.team_id')) {
        return [
          { teamId: 't-everyone', teamName: 'Everyone', membershipId: 'tm-e' },
        ];
      }
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: ['Finance'],
    });

    expect(result.membershipsRemoved).toBe(0);
    expect(deletes(queries)).toHaveLength(0);
  });

  it('sweeps provenance whose team is gone without touching anything else', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT p.team_id')) {
        return [{ teamId: 't-gone', teamName: null, membershipId: null }];
      }
      return [];
    });

    const result = await syncTeamsFromGroupNames(sql, {
      ...syncArgs,
      groupNames: [],
    });

    expect(result.membershipsRemoved).toBe(0);
    expect(deletes(queries).map((q) => q.text.split(' WHERE')[0])).toEqual([
      'DELETE FROM app.sso_synced_team_members',
      'DELETE FROM app.sso_synced_teams',
    ]);
  });
});

/**
 * Org 2FA enforcement on the SSO door: the password path anchors the grace
 * clock in the Better Auth after-hook, which never runs for a session
 * `handleSsoLogin` mints itself — so for SSO users under a policy with
 * exemptSsoUsers=false the anchor was never persisted and the deadline was
 * recomputed as `now + grace` on every read: grace rolled forever.
 */
describe('handleSsoLogin — org 2FA enforcement anchors on the SSO door', () => {
  async function writePolicy(slug: string, lines: string[]): Promise<void> {
    const dir = path.join(configRoot, slug, 'governance');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'two-factor-policy.yml'),
      `${lines.join('\n')}\n`,
    );
  }

  const memberFake = (extra: (text: string) => object[] | undefined) =>
    fakeSql((text) => {
      if (text.startsWith('SELECT "slug" FROM "organization"')) {
        return [{ slug: 'grace-org' }];
      }
      if (text.startsWith('SELECT "id" FROM "user"')) {
        return [{ id: 'grace-user' }];
      }
      if (text.startsWith('SELECT "id", "role" FROM "member"')) {
        return [{ id: 'm1', role: 'member' }];
      }
      if (text.startsWith('SELECT "organizationId" FROM "member"')) {
        return [{ organizationId: 'org-grace' }];
      }
      if (text.startsWith('SELECT "twoFactorEnabled"')) {
        return [{ twoFactorEnabled: false }];
      }
      return extra(text);
    });

  const loginArgs = {
    email: 'grace@example.com',
    name: 'Grace User',
    externalId: 'ext-g',
    providerId: 'entra-id',
    accessToken: 'token',
    organizationId: 'org-grace',
  };

  it('anchors the grace clock once for a user under an enforced policy (the regression)', async () => {
    await writePolicy('grace-org', [
      'enforced: true',
      'gracePeriodDays: 7',
      'exemptSsoUsers: false',
    ]);
    const { sql, queries } = memberFake(() => []);
    const before = Date.now();

    const result = await handleSsoLogin(sql, loginArgs);

    expect(result.success).toBe(true);
    const anchorIndex = queries.findIndex((q) =>
      q.text.startsWith('INSERT INTO app.two_factor_grace'),
    );
    expect(anchorIndex).toBeGreaterThan(-1);
    const anchor = queries[anchorIndex];
    expect(anchor?.values[0]).toBe('grace-user');
    const graceUntil = anchor?.values[1];
    expect(typeof graceUntil).toBe('number');
    expect(graceUntil).toBeGreaterThan(before);
    expect(graceUntil).toBeLessThanOrEqual(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    );
    // Anchored BEFORE the session mint: a failing anchor leaves no orphan
    // session, and the session is still minted under 'grace'.
    const sessionIndex = queries.findIndex((q) =>
      q.text.startsWith('INSERT INTO "session"'),
    );
    expect(sessionIndex).toBeGreaterThan(anchorIndex);
  });

  it('never restarts a running clock — an existing anchor is left as is', async () => {
    await writePolicy('grace-org', [
      'enforced: true',
      'gracePeriodDays: 7',
      'exemptSsoUsers: false',
    ]);
    const { sql, queries } = memberFake((text) => {
      if (text.startsWith('SELECT grace_until_ms')) {
        return [{ graceUntil: Date.now() + 60_000 }];
      }
      return [];
    });

    const result = await handleSsoLogin(sql, loginArgs);

    expect(result.success).toBe(true);
    expect(
      queries.some((q) =>
        q.text.startsWith('INSERT INTO app.two_factor_grace'),
      ),
    ).toBe(false);
  });

  it('leaves an SSO-only user alone when the policy exempts them', async () => {
    await writePolicy('grace-org', [
      'enforced: true',
      'gracePeriodDays: 7',
      'exemptSsoUsers: true',
    ]);
    const { sql, queries } = memberFake((text) => {
      if (text.startsWith('SELECT "providerId" FROM "account"')) {
        return [{ providerId: 'entra-id' }];
      }
      return [];
    });

    const result = await handleSsoLogin(sql, loginArgs);

    expect(result.success).toBe(true);
    expect(
      queries.some((q) =>
        q.text.startsWith('INSERT INTO app.two_factor_grace'),
      ),
    ).toBe(false);
  });
});
