// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { ApiKeyOwner } from '../domains/api_keys/owners.ts';
import { resolveBoundKeyCaller } from './bound-key.ts';

/**
 * The organization and role a key bound to ONE organization acts with: its
 * own organization, never another, and — for a member's key — the
 * member's live role, for as long as they stay.
 */

function owner(
  kind: ApiKeyOwner['kind'],
  extra: Partial<ApiKeyOwner> = {},
): ApiKeyOwner {
  return {
    apiKeyId: 'key-1',
    organizationId: 'org-1',
    kind,
    principalUserId: 'user-1',
    teamId: kind === 'team' ? 'team-1' : null,
    projectId: kind === 'project' ? 'project-1' : null,
    role: kind === 'member' ? null : 'developer',
    name: 'Sync key',
    createdBy: 'admin-1',
    createdAt: 1,
    revokedAt: null,
    revokedBy: null,
    ...extra,
  };
}

function fakeSql(world: {
  organization?: { slug: string | null; name: string } | null;
  memberRole?: string | null;
}): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
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
      const role = world.memberRole === undefined ? 'member' : world.memberRole;
      return Promise.resolve(
        role === null
          ? []
          : [{ id: 'm-1', organizationId: 'org-1', userId: 'user-1', role }],
      );
    }
    return Promise.reject(new Error(`unexpected statement: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

describe('resolveBoundKeyCaller', () => {
  it('acts in its organization with the role a key that is not a person was made with [APIKEY-R4]', async () => {
    const { sql, statements } = fakeSql({});
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('team'),
        userId: 'user-1',
        orgSlugHeader: undefined,
      }),
    ).resolves.toEqual({
      ok: true,
      organizationId: 'org-1',
      orgSlug: 'acme',
      role: 'developer',
    });
    // No membership is read for a key that is no member.
    expect(statements.some((text) => text.includes('FROM "member"'))).toBe(
      false,
    );
  });

  it('acts with a member’s live role, and refuses once they left or were disabled [APIKEY-R2]', async () => {
    const args = {
      owner: owner('member'),
      userId: 'user-1',
      orgSlugHeader: undefined,
    };
    await expect(
      resolveBoundKeyCaller(fakeSql({ memberRole: 'editor' }).sql, args),
    ).resolves.toMatchObject({ ok: true, role: 'editor' });
    for (const memberRole of [null, 'disabled']) {
      await expect(
        resolveBoundKeyCaller(fakeSql({ memberRole }).sql, args),
      ).resolves.toMatchObject({
        ok: false,
        status: 403,
        code: 'ORG_FORBIDDEN',
        organizations: [],
      });
    }
  });

  it('refuses a header naming another organization, listing its own [APIKEY-R5]', async () => {
    const { sql } = fakeSql({});
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('organization'),
        userId: 'user-1',
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
        userId: 'user-1',
        orgSlugHeader: 'acme',
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('answers 401 for a revoked binding, or one another identity presents [APIKEY-R7]', async () => {
    const { sql, statements } = fakeSql({});
    for (const args of [
      { owner: owner('project', { revokedAt: 5 }), userId: 'user-1' },
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

  it('refuses a key whose organization is gone', async () => {
    const { sql } = fakeSql({ organization: null });
    await expect(
      resolveBoundKeyCaller(sql, {
        owner: owner('organization'),
        userId: 'user-1',
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
        userId: 'user-1',
        orgSlugHeader: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });
});
