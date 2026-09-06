import type { Sql, TransactionSql } from 'postgres';

import {
  findOrganizationMember,
  getUserOrganizations,
  MembershipError,
} from '../../auth/membership.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { logSuccess } from '../audit_logs/service.ts';
import {
  loadActiveHolds,
  LegalHoldError,
  type ActiveHolds,
} from '../legal_holds/service.ts';
import { MEMBER_ROLES } from '../members/service.ts';

/**
 * Organizations domain — reads, the org-switch record, and the deletion
 * door. Better Auth's org plugin owns create/update + invitations (served on
 * /api/auth/organization/*); this module carries the app-side semantics
 * around them. Deletion is the exception: it is served HERE, as one
 * transaction (`deleteOrganization`), and Better Auth's own
 * `/organization/delete` is disabled — a second door would bypass the
 * legal-hold gate, the audit row, and the app-side cascade. What the slug
 * keys outside the app schema (corpus, blobs, config tree) is torn down by
 * the `org.cleanup_files` job behind a slug tombstone (`teardown.ts`).
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

/** The ONE role vocabulary (members domain) — the same membership row must
 * answer the same role on /members/me and here, so this list is derived,
 * never a second hand-written copy. */
const VALID_MEMBER_ROLES: ReadonlySet<string> = new Set(MEMBER_ROLES);

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
 * The governance ledger outlives the tenant it describes: the
 * `organization_deleted` row is written INSIDE the deletion transaction and
 * must survive its own cascade, and the hash chain it belongs to is
 * retention-governed, never bulk-deleted. Everything else keyed by `org_id`
 * in the app schema dies with the organization.
 */
const ORG_TEARDOWN_KEEPS: ReadonlySet<string> = new Set([
  'audit_logs',
  'audit_chain_heads',
  'audit_integrity_progress',
  // Written by the deletion itself, after the cascade, and cleared by the
  // teardown job — the one org-keyed row that must outlive the organization.
  'organization_tombstones',
]);

/**
 * Order tables so every table that references another (a foreign-key child)
 * comes before the table it references. Deleting in this order never trips a
 * non-cascading foreign key: by the time a parent row goes, its children are
 * gone. Deterministic (alphabetical among the ready tables); tables left in
 * a reference cycle come last in name order — a cycle can only be deleted
 * through cascading constraints anyway. Edges naming tables outside `tables`
 * are ignored.
 */
export function orderChildrenFirst(
  tables: readonly string[],
  edges: readonly { child: string; parent: string }[],
): string[] {
  const inSet = new Set(tables);
  // parent → its distinct children within the set
  const childrenOf = new Map<string, Set<string>>();
  for (const { child, parent } of edges) {
    if (!inSet.has(child) || !inSet.has(parent) || child === parent) continue;
    const children = childrenOf.get(parent) ?? new Set<string>();
    children.add(child);
    childrenOf.set(parent, children);
  }
  const pending = new Map<string, number>(
    tables.map((table) => [table, childrenOf.get(table)?.size ?? 0]),
  );
  const ordered: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, count]) => count === 0)
      .map(([table]) => table)
      .sort();
    if (ready.length === 0) {
      // Reference cycle: append what is left, deterministically.
      ordered.push(...[...pending.keys()].sort());
      break;
    }
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table);
      // This table was a child of every parent it references: one fewer
      // child now stands between each of those parents and deletion.
      for (const { child, parent } of edges) {
        if (child !== table || !pending.has(parent) || child === parent) {
          continue;
        }
        if (!childrenOf.get(parent)?.has(child)) continue;
        childrenOf.get(parent)?.delete(child);
        pending.set(parent, childrenOf.get(parent)?.size ?? 0);
      }
    }
  }
  return ordered;
}

/**
 * Every app-schema table keyed by `org_id`, child-before-parent along the
 * schema's own foreign keys. Read from the catalog rather than kept as a
 * list in code, so a new org-owned table is covered the day its migration
 * lands instead of leaking rows until someone remembers this function.
 */
async function listOrgOwnedTables(tx: TransactionSql): Promise<string[]> {
  const columns = await tx<{ tableName: string }[]>`
    SELECT c.table_name AS "tableName"
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'app' AND c.column_name = 'org_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `;
  const edges = await tx<{ child: string; parent: string }[]>`
    SELECT child.relname AS "child", parent.relname AS "parent"
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'app'
      AND child.relname <> parent.relname
  `;
  return orderChildrenFirst(
    columns
      .map((column) => column.tableName)
      .filter((table) => !ORG_TEARDOWN_KEEPS.has(table)),
    edges,
  );
}

/**
 * Refuse a slug whose previous tenant is still being torn down: the corpus
 * and blobs are slug-keyed, so taking it now would route the new tenant onto
 * the old tenant's documents. The tombstone is written by
 * `deleteOrganization` and cleared by the teardown job as its last step.
 * The refusal also re-enqueues that job (dedup key) — a tombstone that
 * outlived the job's retries must not block the slug forever; the next
 * attempt to take it is what heals it.
 */
export async function assertOrgSlugNotRetiring(
  sql: Sql,
  slug: string,
): Promise<void> {
  const rows = await sql<{ orgId: string }[]>`
    SELECT org_id AS "orgId" FROM app.organization_tombstones
    WHERE slug = ${slug} LIMIT 1
  `;
  if (rows.length === 0) {
    return;
  }
  try {
    await addJobInTx(
      sql,
      'org.cleanup_files',
      { orgSlug: slug },
      { singletonKey: `org-cleanup:${slug}` },
    );
  } catch (error) {
    console.error(
      `[organizations] failed to re-enqueue the teardown for slug "${slug}"`,
      error instanceof Error ? error.message : error,
    );
  }
  throw new OrganizationError(
    'ORG_SLUG_RETIRING',
    `Organization slug "${slug}" belongs to an organization that is still being removed. Try again in a few minutes.`,
    400,
  );
}

/**
 * The legal-hold verdict for deleting a whole organization. Deleting the org
 * destroys every target a hold can name — the org itself AND every
 * custodian's artifacts — so an active hold of EITHER granularity blocks.
 * Pure: the caller loads the holds; this only shapes the refusal.
 */
export function describeOrganizationHoldBlock(
  holds: ActiveHolds,
): LegalHoldError | null {
  if (holds.orgHeld) {
    return new LegalHoldError(
      'LEGAL_HOLD_ACTIVE',
      'This organization is under an active legal hold. Release the hold before deleting the organization.',
      409,
    );
  }
  const custodians = holds.userMembershipIds.size;
  if (custodians > 0) {
    return new LegalHoldError(
      'LEGAL_HOLD_ACTIVE',
      `${custodians} member${custodians === 1 ? '' : 's'} of this organization ${custodians === 1 ? 'is' : 'are'} under a custodian legal hold. Release those holds before deleting the organization.`,
      409,
    );
  }
  return null;
}

/**
 * The ONE deletion door — owner-only, whole teardown in the caller's
 * transaction so it either fully commits or leaves nothing behind. Order:
 * every guard first (membership, owner role, default-org protection, legal
 * holds — nothing is written until all pass), then the audit row (while the
 * actor's membership still exists), the app-side cascade over EVERY
 * org-owned app table, Better Auth's own rows (team members, teams,
 * invitations, members, the org), the slug tombstone, and finally the
 * teardown job for what the slug keys outside this database (corpus, blobs,
 * config tree) — enqueued THROUGH the transaction, so the job exists only
 * if the deletion committed. The governance ledger is the one deliberate
 * survivor (see ORG_TEARDOWN_KEEPS).
 *
 * Tenant isolation: every statement is keyed by this organization's id. A
 * user who also belongs to other organizations loses exactly this
 * membership; their account and other memberships are untouched.
 */
export async function deleteOrganization(
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

  // Preservation gate: an org-wide hold or ANY custodian hold refuses — the
  // whole tenant is what a deletion would destroy.
  const holdBlock = describeOrganizationHoldBlock(
    await loadActiveHolds(tx, organizationId),
  );
  if (holdBlock !== null) {
    throw holdBlock;
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

  // The app-side cascade: every app-schema table keyed by org_id (projects,
  // tasks, documents, conversations, automations, credentials, usage, the
  // per-user preference and memory rows, SSO provenance, …), read from the
  // catalog and deleted child-before-parent along the schema's foreign keys
  // so a non-cascading reference never trips. Tenant isolation is what
  // makes that order sufficient: a child row of this org's parent row
  // carries this org's id itself.
  for (const table of await listOrgOwnedTables(tx)) {
    await tx`
      DELETE FROM ${tx(`app.${table}`)} WHERE org_id = ${organizationId}
    `;
  }
  // The realtime hint outbox lives in its own schema, so the catalog walk
  // above never lists it; a dead organization's hints go with the rows they
  // pointed at instead of waiting out the retention sweep.
  await tx`
    DELETE FROM app_realtime.outbox WHERE org_id = ${organizationId}
  `;
  // Pointers at the dead org go too, so no session or API-key resolution
  // follows a dangling id.
  await tx`
    UPDATE "user" SET "lastActiveOrganizationId" = NULL
    WHERE "lastActiveOrganizationId" = ${organizationId}
  `;
  await tx`
    UPDATE "session" SET "activeOrganizationId" = NULL
    WHERE "activeOrganizationId" = ${organizationId}
  `;

  // Better Auth's own rows, leaf-first. (Its `organization.delete` removes
  // members, invitations and the org but strands teams; this is the
  // complete set for the teams-enabled plugin.)
  await tx`
    DELETE FROM "teamMember"
    WHERE "teamId" IN (
      SELECT "id" FROM "team" WHERE "organizationId" = ${organizationId}
    )
  `;
  await tx`DELETE FROM "team" WHERE "organizationId" = ${organizationId}`;
  await tx`
    DELETE FROM "invitation" WHERE "organizationId" = ${organizationId}
  `;
  await tx`DELETE FROM "member" WHERE "organizationId" = ${organizationId}`;
  const removed = await tx<{ id: string }[]>`
    DELETE FROM "organization" WHERE "id" = ${organizationId} RETURNING "id"
  `;
  if (removed.length === 0) {
    // A concurrent deletion won the race; nothing of ours may stand.
    throw new OrganizationError('ORG_NOT_FOUND', 'Organization not found', 404);
  }

  // The slug stays reserved until the teardown job has removed what it keys
  // outside this database; `assertOrgSlugNotRetiring` reads this row.
  await tx`
    INSERT INTO app.organization_tombstones (
      slug, org_id, deleted_by, deleted_at_ms
    ) VALUES (${slug}, ${organizationId}, ${actor.userId}, ${Date.now()})
    ON CONFLICT (slug) DO UPDATE SET
      org_id = EXCLUDED.org_id,
      deleted_by = EXCLUDED.deleted_by,
      deleted_at_ms = EXCLUDED.deleted_at_ms
  `;

  await addJobInTx(
    tx,
    'org.cleanup_files',
    { orgSlug: slug },
    { singletonKey: `org-cleanup:${slug}` },
  );

  return { orgSlug: slug };
}
