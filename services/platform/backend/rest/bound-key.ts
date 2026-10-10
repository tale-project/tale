import type { Sql } from 'postgres';

import {
  findOrganizationMember,
  isAdminRole,
  roleRank,
} from '../auth/membership.ts';
import type { ApiKeyOwner } from '../domains/api_keys/owners.ts';

/**
 * The organization and role a key bound to ONE organization acts with on
 * `/api/v1` — a key an Owner or Admin made for a member, or a team's, a
 * project's or the organization's own key (`domains/api_keys/owners.ts`).
 *
 * Such a key needs no `X-Organization-Slug`: it works in its organization
 * and nowhere else, so a header naming another one is refused with its own
 * organization listed. Every such key authenticates as an identity of its
 * own; a member's key then acts as the member, with their live role, for as
 * long as they stay and its maker is still an Owner or Admin above them —
 * a key never carries more authority than the person who made it could
 * hand out today. A key that is not a person acts as its identity, with the
 * role it was made with.
 */
export type BoundKeyCaller =
  | {
      ok: true;
      organizationId: string;
      orgSlug: string;
      role: string;
      /** Who the request acts as: the member, or the key's identity. */
      userId: string;
      /** The member's address; empty for a key that is not a person. */
      email: string;
    }
  | {
      ok: false;
      status: 401 | 403;
      message: string;
      code: 'UNAUTHORIZED' | 'ORG_FORBIDDEN';
      organizations: { slug: string; name: string }[];
    };

export async function resolveBoundKeyCaller(
  sql: Sql,
  args: {
    owner: ApiKeyOwner;
    /** The verified session's user: the key's own identity. */
    userId: string;
    /** `X-Organization-Slug`, lowercased, when the caller sent one. */
    orgSlugHeader: string | undefined;
  },
): Promise<BoundKeyCaller> {
  const { owner } = args;
  if (owner.revokedAt !== null || owner.keyUserId !== args.userId) {
    return {
      ok: false,
      status: 401,
      message: 'Invalid API key',
      code: 'UNAUTHORIZED',
      organizations: [],
    };
  }
  const orgs = await sql<{ slug: string | null; name: string }[]>`
    SELECT "slug", "name" FROM "organization"
    WHERE "id" = ${owner.organizationId} LIMIT 1
  `;
  const org = orgs[0];
  if (org?.slug == null) {
    return {
      ok: false,
      status: 403,
      message: 'The organization this key belongs to no longer exists.',
      code: 'ORG_FORBIDDEN',
      organizations: [],
    };
  }
  const listed = [{ slug: org.slug, name: org.name }];
  let role: string;
  let actingUserId = owner.principalUserId;
  let email = '';
  if (owner.kind === 'member') {
    const [member, maker] = await Promise.all([
      findOrganizationMember(sql, owner.organizationId, owner.principalUserId),
      findOrganizationMember(sql, owner.organizationId, owner.createdBy),
    ]);
    if (member === null || member.role === 'disabled') {
      return {
        ok: false,
        status: 403,
        message: `Not a member of organization "${org.slug}".`,
        code: 'ORG_FORBIDDEN',
        organizations: [],
      };
    }
    // The maker must still be able to hand this authority out: an Owner or
    // Admin above the member's role today. A key made before a demotion, or
    // for a member since promoted to the maker's rank, acts for nobody.
    if (
      maker === null ||
      !isAdminRole(maker.role) ||
      roleRank(maker.role) <= roleRank(member.role)
    ) {
      return {
        ok: false,
        status: 403,
        message:
          'This key no longer works: whoever made it is no longer an Owner or Admin above the member it acts as.',
        code: 'ORG_FORBIDDEN',
        organizations: [],
      };
    }
    role = member.role;
    actingUserId = member.userId;
    const users = await sql<{ email: string | null }[]>`
      SELECT "email" FROM "user" WHERE "id" = ${member.userId} LIMIT 1
    `;
    email = users[0]?.email ?? '';
  } else if (owner.role !== null) {
    // A team's or a project's key ends with its team or project. Their
    // deletion revokes it; this holds even where a deletion could not (the
    // plugin's own team door retires after its commit).
    if (owner.kind === 'team' || owner.kind === 'project') {
      const targets =
        owner.kind === 'team'
          ? await sql<{ id: string }[]>`
              SELECT "id" FROM "team"
              WHERE "id" = ${owner.teamId}
                AND "organizationId" = ${owner.organizationId}
            `
          : await sql<{ id: string }[]>`
              SELECT id FROM app.projects
              WHERE id = ${owner.projectId} AND org_id = ${owner.organizationId}
            `;
      if (targets.length === 0) {
        return {
          ok: false,
          status: 401,
          message: 'Invalid API key',
          code: 'UNAUTHORIZED',
          organizations: [],
        };
      }
    }
    role = owner.role;
  } else {
    // The table's CHECK gives every key that is not a person a role.
    return {
      ok: false,
      status: 401,
      message: 'Invalid API key',
      code: 'UNAUTHORIZED',
      organizations: [],
    };
  }
  if (args.orgSlugHeader !== undefined && args.orgSlugHeader !== org.slug) {
    return {
      ok: false,
      status: 403,
      message: `This key works only in organization "${org.slug}".`,
      code: 'ORG_FORBIDDEN',
      organizations: listed,
    };
  }
  return {
    ok: true,
    organizationId: owner.organizationId,
    orgSlug: org.slug,
    role,
    userId: actingUserId,
    email,
  };
}
