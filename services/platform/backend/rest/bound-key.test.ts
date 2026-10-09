// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { ApiKeyOwner } from '../domains/api_keys/owners.ts';
import { resolveBoundKeyCaller } from './bound-key.ts';

/**
 * The organization and role a key bound to ONE organization acts with: its
 * own organization, never another. Every such key authenticates as an
 * identity of its own; a member's key acts as the member, with their live
 * role, while they stay and its maker still outranks them.
 */

const KEY_USER = 'key-identity-1';

function owner(
  kind: ApiKeyOwner['kind'],
  extra: Partial<ApiKeyOwner> = {},
): ApiKeyOwner {
  return {
    apiKeyId: 'key-1',
    organizationId: 'org-1',
    kind,
    keyUserId: KEY_USER,
    principalUserId: kind === 'member' ? 'mia' : KEY_USER,
    teamId: kind === 'team' ? 'team-1' : null,
    projectId: kind === 'project' ? 'project-1' : null,
    role: kind === 'member' ? null : 'developer',
    name: 'Sync key',
    createdBy: 'ada',
    createdAt: 1,
    revokedAt: null,
    revokedBy: null,
    ...extra,
  };
}

function fakeSql(world: {
  organization?: { slug: string | null; name: string } | null;
  /** Member roles in org-1, by user id. */
  roles?: Record<string, string>;
  /** Whether the key's team or project still exists. */
  targetExists?: boolean;
}): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const roles = world.roles ?? { ada: 'admin', mia: 'member' };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.includes('FROM "organization"')) {
      const org =
        world.organization === undefined
          ? { slug: 'acme', name: 'Acme' }
          : world.organization;
      return Promise.resolve(org === null ? [] : [org]);
    }
    if (text.includes('FROM "member"')) {
      const [organizationId, userId] = values;
      const role =
        organizationId === 'org-1' ? roles[String(userId)] : undefined;
      return Promise.resolve(
        role === undefined
          ? []
          : [{ id: `m-${String(userId)}`, organizationId, userId, role }],
      );
    }
    if (text.startsWith('SELECT "email" FROM "user"')) {
      return Promise.resolve([{ email: `${String(values[0])}@example.test` }]);
    }
    if (text.includes('FROM "team"') || text.includes('FROM app.projects')) {
      return Promise.resolve(
        world.targetExists === false ? [] : [{ id: 'target' }],
      );
    }
    return Promise.reject(new Error(`unexpected statement: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

describe('resolveBoundKeyCaller', () => {
  it('acts in its organization as its own identity, with the role it was made with [APIKEY-R4]', async () => {
    const { sql, statements } = fakeSql({});
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('organization'),
        userId: KEY_USER,
        orgSlugHeader: undefined,
      }),
    ).resolves.toEqual({
      ok: true,
      organizationId: 'org-1',
      orgSlug: 'acme',
      role: 'developer',
      userId: KEY_USER,
      email: '',
    });
    // No membership is read for a key that is no member.
    expect(statements.some((text) => text.includes('FROM "member"'))).toBe(
      false,
    );
  });

  it('acts as the member with their live role, and refuses once they left or were disabled [APIKEY-R2]', async () => {
    const args = {
      owner: owner('member'),
      userId: KEY_USER,
      orgSlugHeader: undefined,
    };
    await expect(
      resolveBoundKeyCaller(
        fakeSql({ roles: { ada: 'admin', mia: 'editor' } }).sql,
        args,
      ),
    ).resolves.toEqual({
      ok: true,
      organizationId: 'org-1',
      orgSlug: 'acme',
      role: 'editor',
      userId: 'mia',
      email: 'mia@example.test',
    });
    const leftOrDisabled: Record<string, string>[] = [
      { ada: 'admin' },
      { ada: 'admin', mia: 'disabled' },
    ];
    for (const roles of leftOrDisabled) {
      await expect(
        resolveBoundKeyCaller(fakeSql({ roles }).sql, args),
      ).resolves.toMatchObject({
        ok: false,
        status: 403,
        code: 'ORG_FORBIDDEN',
        organizations: [],
      });
    }
  });

  it('refuses a member’s key once its maker no longer outranks the member [APIKEY-R2]', async () => {
    const args = {
      owner: owner('member'),
      userId: KEY_USER,
      orgSlugHeader: undefined,
    };
    const outranked: Record<string, string>[] = [
      // The maker left, was demoted, or the member was promoted to them.
      { mia: 'member' },
      { ada: 'developer', mia: 'member' },
      { ada: 'admin', mia: 'admin' },
    ];
    for (const roles of outranked) {
      await expect(
        resolveBoundKeyCaller(fakeSql({ roles }).sql, args),
      ).resolves.toMatchObject({
        ok: false,
        status: 403,
        code: 'ORG_FORBIDDEN',
        message: expect.stringContaining('whoever made it') as string,
      });
    }
    // The owner outranks an admin: an owner's key for an admin works.
    await expect(
      resolveBoundKeyCaller(
        fakeSql({ roles: { ada: 'owner', mia: 'admin' } }).sql,
        args,
      ),
    ).resolves.toMatchObject({ ok: true, role: 'admin', userId: 'mia' });
  });

  it('refuses a header naming another organization, listing its own [APIKEY-R5]', async () => {
    const { sql } = fakeSql({});
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('organization'),
        userId: KEY_USER,
        orgSlugHeader: 'beta',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      message: 'This key works only in organization "acme".',
      code: 'ORG_FORBIDDEN',
      organizations: [{ slug: 'acme', name: 'Acme' }],
    });
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('organization'),
        userId: KEY_USER,
        orgSlugHeader: 'acme',
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('answers 401 for a revoked binding, or one another identity presents [APIKEY-R7]', async () => {
    const { sql, statements } = fakeSql({});
    for (const args of [
      { owner: owner('project', { revokedAt: 5 }), userId: KEY_USER },
      // A member's key is never presented as the member.
      { owner: owner('member'), userId: 'mia' },
      { owner: owner('project'), userId: 'someone-else' },
    ]) {
      await expect(
        resolveBoundKeyCaller(sql, { ...args, orgSlugHeader: undefined }),
      ).resolves.toMatchObject({
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }
    expect(statements).toEqual([]);
  });

  it('answers 401 for a team’s or a project’s key whose team or project is gone [APIKEY-R7]', async () => {
    for (const kind of ['team', 'project'] as const) {
      const { sql } = fakeSql({ targetExists: false });
      await expect(
        resolveBoundKeyCaller(sql, {
          owner: owner(kind),
          userId: KEY_USER,
          orgSlugHeader: undefined,
        }),
      ).resolves.toMatchObject({ ok: false, status: 401 });
    }
  });

  it('refuses a key whose organization is gone', async () => {
    const { sql } = fakeSql({ organization: null });
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('organization'),
        userId: KEY_USER,
        orgSlugHeader: undefined,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      code: 'ORG_FORBIDDEN',
    });
  });

  it('answers 401 for a key that is not a person but carries no role', async () => {
    const { sql } = fakeSql({});
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('team', { role: null }),
        userId: KEY_USER,
        orgSlugHeader: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });
});
