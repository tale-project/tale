import type { Sql, TransactionSql } from 'postgres';

import {
  findOrganizationMember,
  getUserOrganizations,
  MembershipError,
} from '../../auth/membership.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { logSuccess } from '../audit_logs/service.ts';

/**
 * Organizations domain — reads, the org-switch record, and the deletion
 * door. Better Auth's org plugin owns create/update/delete + invitations
 * (served on /api/auth/organization/*); this module carries the app-side
 * semantics around them. Ledger notes: the legal-hold guard on deletion and
 * the user_memories half of the personalization cascade land with the
 * governance domain.
 */

export class OrganizationError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 401 | 403 | 404) {
    super(message);
    this.name = 'OrganizationError';
    this.code = code;
    this.status = status;
  }
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: string;
  metadata: string | null;
}

/** One org, for a caller whose membership the route has already verified. */
const VALID_MEMBER_ROLES = new Set(['owner', 'admin', 'developer', 'member']);

/** The 0.4 `members/queries:getUserOrganizationsWithDetails` shape — every
 * organization the user belongs to, with the display fields the picker
 * needs (its List sibling is a projection of this). Disabled memberships
 * are excluded; an off-vocabulary role reads as `member` (the 0.4
 * normalization). */
export async function listUserOrganizations(
  sql: Sql,
  userId: string,
): Promise<
  { organizationId: string; role: string; name: string; slug?: string }[]
> {
  const rows = await sql<
    {
      organizationId: string;
      role: string;
      name: string;
      slug: string | null;
    }[]
  >`
    SELECT m."organizationId" AS "organizationId", m."role" AS "role",
           o."name" AS "name", o."slug" AS "slug"
    FROM "member" m
    JOIN "organization" o ON o."id" = m."organizationId"
    WHERE m."userId" = ${userId}
    ORDER BY o."createdAt" ASC
  `;
  const organizations: {
    organizationId: string;
    role: string;
    name: string;
    slug?: string;
  }[] = [];
  for (const row of rows) {
    const role = row.role.toLowerCase();
    if (role === 'disabled') continue;
    organizations.push({
      organizationId: row.organizationId,
      role: VALID_MEMBER_ROLES.has(role) ? role : 'member',
      name: row.name,
      ...(row.slug !== null ? { slug: row.slug } : {}),
    });
  }
  return organizations;
}

export async function getOrganization(
  sql: Sql,
  organizationId: string,
): Promise<OrganizationRow | null> {
  const rows = await sql<OrganizationRow[]>`
    SELECT "id", "name", "slug", "logo", "createdAt"::text AS "createdAt",
           "metadata"
    FROM "organization" WHERE "id" = ${organizationId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Whether the instance has any organization at all (auth-gated). */
export async function hasAnyOrganization(sql: Sql): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" LIMIT 1
  `;
  return rows.length > 0;
}

const ORG_SWITCH_DEDUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Record that the user activated an org this session: an auditable
 * `signed_in_to_organization` entry (deduped per 30min window) + the
 * `lastActiveOrganizationId` pointer that survives logout.
 */
export async function recordOrgSwitch(
  tx: TransactionSql,
  actor: { userId: string; email?: string; role: string },
  organizationId: string,
): Promise<void> {
  const cutoff = Date.now() - ORG_SWITCH_DEDUP_WINDOW_MS;
  const recent = await tx<{ id: string }[]>`
    SELECT id FROM app.audit_logs
    WHERE org_id = ${organizationId}
      AND actor_id = ${actor.userId}
      AND category = 'auth'
      AND action = 'signed_in_to_organization'
      AND ts >= ${cutoff}
    LIMIT 1
  `;
  if (recent.length === 0) {
    await logSuccess(tx, {
      auditCtx: {
        organizationId,
        actor: {
          id: actor.userId,
          ...(actor.email !== undefined ? { email: actor.email } : {}),
          role: actor.role,
          type: 'user',
        },
      },
      action: 'signed_in_to_organization',
      category: 'auth',
      resourceType: 'organization',
      resourceId: organizationId,
    });
  }
  await tx`
    UPDATE "user" SET "lastActiveOrganizationId" = ${organizationId}
    WHERE "id" = ${actor.userId}
  `;
}

export interface ResolvedUserOrganization {
  organizationId: string;
  orgSlug: string;
}

/**
 * Resolve which org an API-key caller is operating on (see the 0.4 module
 * doc): an explicit slug requires a non-disabled membership; without one, a
 * single-org user resolves directly and a multi-org user follows
 * `lastActiveOrganizationId` unless `requireExplicitOrgSlug` demands the
 * header (write-capable machine keys must not follow dashboard clicks).
 */
export async function resolveUserOrganization(
  sql: Sql,
  args: {
    userId: string;
    orgSlug?: string;
    requireExplicitOrgSlug?: boolean;
  },
): Promise<ResolvedUserOrganization> {
  if (args.orgSlug) {
    const orgs = await sql<{ id: string; slug: string | null }[]>`
      SELECT "id", "slug" FROM "organization"
      WHERE "slug" = ${args.orgSlug} LIMIT 1
    `;
    const org = orgs[0];
    if (!org?.slug) {
      throw new OrganizationError(
        'ORG_SLUG_INVALID',
        `Organization not found: ${args.orgSlug}`,
        404,
      );
    }
    const member = await findOrganizationMember(sql, org.id, args.userId);
    if (!member || member.role === 'disabled') {
      throw new OrganizationError(
        'ORG_FORBIDDEN',
        `Not a member of organization ${org.slug}`,
        403,
      );
    }
    return { organizationId: org.id, orgSlug: org.slug };
  }

  const memberships = (await getUserOrganizations(sql, args.userId)).filter(
    (m) => m.role !== 'disabled',
  );
  if (memberships.length === 0) {
    throw new OrganizationError(
      'ORG_FORBIDDEN',
      'User has no organization memberships',
      403,
    );
  }

  let pickedOrgId: string | undefined;
  if (memberships.length === 1) {
    pickedOrgId = memberships[0]?.organizationId;
  } else {
    if (!args.requireExplicitOrgSlug) {
      const users = await sql<{ lastActiveOrganizationId: string | null }[]>`
        SELECT "lastActiveOrganizationId" FROM "user"
        WHERE "id" = ${args.userId} LIMIT 1
      `;
      const lastActive = users[0]?.lastActiveOrganizationId;
      if (
        lastActive &&
        memberships.some((m) => m.organizationId === lastActive)
      ) {
        pickedOrgId = lastActive;
      }
    }
    if (!pickedOrgId) {
      throw new OrganizationError(
        'ORG_SLUG_REQUIRED',
        'User belongs to multiple organizations. Provide X-Organization-Slug header.',
        400,
      );
    }
  }

  const orgs = await sql<{ slug: string | null }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${pickedOrgId} LIMIT 1
  `;
  const slug = orgs[0]?.slug;
  if (!slug) {
    throw new OrganizationError(
      'ORG_SLUG_INVALID',
      'Organization slug not found',
      404,
    );
  }
  return { organizationId: pickedOrgId, orgSlug: slug };
}

/**
 * Owner-only pre-deletion door, invoked right before the client calls
 * Better Auth's `organization.delete`: audit while membership still exists,
 * cascade app-side per-user state, and enqueue the filesystem cleanup.
 * TODO(governance): re-add the legal-hold guard (`assertNotHeld`) when the
 * governance domain lands.
 */
export async function prepareOrganizationDeletion(
  tx: TransactionSql,
  actor: { userId: string; email?: string },
  organizationId: string,
): Promise<{ orgSlug: string }> {
  const member = await findOrganizationMember(tx, organizationId, actor.userId);
  if (!member || member.role === 'disabled') {
    throw new MembershipError(
      `Not a member of organization ${organizationId}`,
      'ORG_FORBIDDEN',
    );
  }
  if (member.role !== 'owner') {
    throw new OrganizationError(
      'FORBIDDEN',
      'Only owners can delete organizations',
      403,
    );
  }

  const orgs = await tx<{ slug: string | null }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${organizationId} LIMIT 1
  `;
  const slug = orgs[0]?.slug;
  if (!slug) {
    throw new OrganizationError('ORG_NOT_FOUND', 'Organization not found', 404);
  }
  if (slug === 'default') {
    throw new OrganizationError(
      'DEFAULT_ORG_PROTECTED',
      'The default organization cannot be deleted',
      400,
    );
  }

  await logSuccess(tx, {
    auditCtx: {
      organizationId,
      actor: {
        id: actor.userId,
        ...(actor.email !== undefined ? { email: actor.email } : {}),
        role: member.role,
        type: 'user',
      },
    },
    action: 'organization_deleted',
    category: 'auth',
    resourceType: 'organization',
    resourceId: organizationId,
    metadata: { slug },
  });

  // Personalization cascade (the ported half): per-user preference rows die
  // with the org. user_memories follows with its domain.
  await tx`DELETE FROM app.user_preferences WHERE org_id = ${organizationId}`;

  await addJobInTx(
    tx,
    'org.cleanup_files',
    { orgSlug: slug },
    { singletonKey: `org-cleanup:${slug}` },
  );

  return { orgSlug: slug };
}
