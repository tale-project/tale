// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  createSsoUserSession,
  findOrCreateSsoUser,
  handleSsoLogin,
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
