import type { Sql } from 'postgres';

import { findOrganizationMember } from '../auth/membership.ts';
import type { ApiKeyOwner } from '../domains/api_keys/owners.ts';

/**
 * The organization and role a key bound to ONE organization acts with on
 * `/api/v1` — a key an Owner or Admin made for a member, or a team's, a
 * project's or the organization's own key (`domains/api_keys/owners.ts`).
 *
 * Such a key needs no `X-Organization-Slug`: it works in its organization
 * and nowhere else, so a header naming another one is refused with its own
 * organization listed. A member's key acts with the member's live role and
 * stops when they leave; a key that is not a person acts with the role it
 * was made with.
 */
export type BoundKeyCaller =
  | { ok: true; organizationId: string; orgSlug: string; role: string }
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
    /** The verified session's user: the member, or the key's identity. */
    userId: string;
    /** `X-Organization-Slug`, lowercased, when the caller sent one. */
    orgSlugHeader: string | undefined;
  },
): Promise<BoundKeyCaller> {
  const { owner } = args;
  if (owner.revokedAt !== null || owner.principalUserId !== args.userId) {
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
  if (owner.kind === 'member') {
    const member = await findOrganizationMember(
      sql,
      owner.organizationId,
      args.userId,
    );
    if (member === null || member.role === 'disabled') {
      return {
        ok: false,
        status: 403,
        message: `Not a member of organization "${org.slug}".`,
        code: 'ORG_FORBIDDEN',
        organizations: [],
      };
    }
    role = member.role;
  } else if (owner.role !== null) {
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
  };
}
