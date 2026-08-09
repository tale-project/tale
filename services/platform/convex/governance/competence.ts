/**
 * Competence records (Phase 4) — who is qualified to review agent work.
 *
 * A grant names one competence slug for one member; the `review_policy`
 * governance file lists `requiredCompetences`, and `respondToTaskReview`
 * refuses a responder who does not hold EVERY listed competence through an
 * unexpired, unrevoked row here (`holdsAllCompetences`).
 *
 * Write discipline mirrors `legal_hold.ts`: admin-only mutations, a `denied`
 * audit row on an attempted non-admin write, a `security`-category audit row
 * with full metadata on every grant and revoke, and revocation as a stamp
 * (`revokedAt`/`revokedBy`) — never a hard delete, so a past review's audit
 * trail keeps pointing at the record that justified it.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation, query } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { resolveUserAccessContext } from '../projects/resolve_project_access';

const COMPETENCE_RESOURCE_TYPE = 'competence_record';
/** Matches `reviewPolicyConfigSchema.requiredCompetences` entry bounds. */
const COMPETENCE_SLUG_MAX = 120;
const COMPETENCE_EVIDENCE_MAX = 2000;
/** Rows scanned per membership check — a member holds a handful of
 * competences, not thousands; the cap bounds a pathological org. */
const COMPETENCE_SCAN_CAP = 200;

/** Whether the record vouches for its holder RIGHT NOW. */
export function isCompetenceRecordActive(
  record: Pick<Doc<'competenceRecords'>, 'expiresAt' | 'revokedAt'>,
  now: number,
): boolean {
  if (record.revokedAt !== undefined) return false;
  if (record.expiresAt !== undefined && record.expiresAt <= now) return false;
  return true;
}

/**
 * Whether `userId` holds EVERY competence in `required` through unexpired,
 * unrevoked records. Returns the vouching record ids so the caller can stamp
 * WHICH grants justified the decision (the review check outcome), and the
 * missing slugs so a refusal can name what is lacking. An empty `required`
 * trivially holds.
 */
export async function holdsAllCompetences(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
  required: readonly string[],
): Promise<{ holdsAll: boolean; heldRecordIds: string[]; missing: string[] }> {
  if (required.length === 0) {
    return { holdsAll: true, heldRecordIds: [], missing: [] };
  }
  const now = Date.now();
  const rows = await ctx.db
    .query('competenceRecords')
    .withIndex('by_org_user', (q) =>
      q.eq('organizationId', organizationId).eq('userId', userId),
    )
    .take(COMPETENCE_SCAN_CAP);
  const activeBySlug = new Map<string, Doc<'competenceRecords'>>();
  for (const row of rows) {
    if (isCompetenceRecordActive(row, now)) {
      activeBySlug.set(row.competence, row);
    }
  }
  const heldRecordIds: string[] = [];
  const missing: string[] = [];
  for (const slug of new Set(required)) {
    const record = activeBySlug.get(slug);
    if (record === undefined) missing.push(slug);
    else heldRecordIds.push(String(record._id));
  }
  return { holdsAll: missing.length === 0, heldRecordIds, missing };
}

/** Authorize the caller as an org admin, writing the legal-hold-style
 * `denied` audit row before refusing a non-admin write attempt. */
async function requireAdminForWrite(
  ctx: MutationCtx,
  organizationId: string,
  deniedAction: string,
  resource: { resourceId?: string; resourceName?: string },
): Promise<{ userId: string; email: string }> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'unauthenticated',
      message: 'Sign in required.',
    });
  }
  const member = await getOrganizationMember(ctx, organizationId, {
    userId: authUser.userId,
    email: authUser.email ?? '',
  });
  if (!isAdmin(member.role)) {
    await createAuditLog(ctx, {
      organizationId,
      actorId: authUser.userId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: deniedAction,
      category: 'security',
      resourceType: COMPETENCE_RESOURCE_TYPE,
      ...(resource.resourceId !== undefined
        ? { resourceId: resource.resourceId }
        : {}),
      ...(resource.resourceName !== undefined
        ? { resourceName: resource.resourceName }
        : {}),
      status: 'denied',
      errorMessage: 'caller is not an org admin',
      metadata: { role: member.role },
    });
    throw new ConvexError({
      code: 'forbidden',
      message: 'Only org admins can manage competence records.',
    });
  }
  return { userId: authUser.userId, email: authUser.email ?? '' };
}

/**
 * Grant one competence to one member. Refuses a duplicate ACTIVE grant of
 * the same competence — renew by revoking the old grant first, so the ledger
 * shows one unambiguous vouching record per (member, competence) at any
 * moment.
 */
export const grantCompetence = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    competence: v.string(),
    /** ms since epoch; absent ⇒ the grant does not expire. */
    expiresAt: v.optional(v.number()),
    /** Free text or URL pointing at the qualification evidence. */
    evidence: v.optional(v.string()),
  },
  returns: v.id('competenceRecords'),
  handler: async (ctx, args) => {
    const competence = args.competence.trim();
    const admin = await requireAdminForWrite(
      ctx,
      args.organizationId,
      'competence_grant_denied',
      { resourceName: competence },
    );

    if (competence.length === 0 || competence.length > COMPETENCE_SLUG_MAX) {
      throw new ConvexError({
        code: 'COMPETENCE_INVALID',
        message: `competence must be 1..${COMPETENCE_SLUG_MAX} characters`,
      });
    }
    if (args.userId.trim().length === 0) {
      throw new ConvexError({
        code: 'COMPETENCE_USER_REQUIRED',
        message: 'the grant must name the member who holds the competence',
      });
    }
    const now = Date.now();
    if (args.expiresAt !== undefined && args.expiresAt <= now) {
      throw new ConvexError({
        code: 'COMPETENCE_EXPIRY_IN_PAST',
        message: 'expiresAt must be in the future (or absent for no expiry)',
      });
    }
    const evidence = args.evidence?.trim();
    if (evidence !== undefined && evidence.length > COMPETENCE_EVIDENCE_MAX) {
      throw new ConvexError({
        code: 'COMPETENCE_EVIDENCE_TOO_LONG',
        message: `evidence must be at most ${COMPETENCE_EVIDENCE_MAX} characters`,
      });
    }

    // The holder must be an org member (the repo's member lookup —
    // `resolveUserAccessContext` returns null for a non-member). A dangling
    // grant to an arbitrary string is fail-safe (`holdsAllCompetences`
    // scopes by org + user) but pollutes the qualification ledger.
    const holder = await resolveUserAccessContext(
      ctx,
      args.organizationId,
      args.userId,
    );
    if (holder === null) {
      throw new ConvexError({
        code: 'COMPETENCE_USER_NOT_MEMBER',
        message: 'the named user is not a member of this organization',
      });
    }

    const existing = await ctx.db
      .query('competenceRecords')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .take(COMPETENCE_SCAN_CAP);
    const duplicate = existing.find(
      (row) =>
        row.competence === competence && isCompetenceRecordActive(row, now),
    );
    if (duplicate !== undefined) {
      throw new ConvexError({
        code: 'COMPETENCE_ALREADY_GRANTED',
        message:
          'this member already holds an active grant of this competence — revoke it first to re-grant',
      });
    }

    const recordId = await ctx.db.insert('competenceRecords', {
      organizationId: args.organizationId,
      userId: args.userId,
      competence,
      grantedBy: admin.userId,
      grantedAt: now,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
      ...(evidence !== undefined && evidence !== '' ? { evidence } : {}),
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: admin.userId,
      actorEmail: admin.email,
      actorType: 'user',
      action: 'competence_granted',
      category: 'security',
      resourceType: COMPETENCE_RESOURCE_TYPE,
      resourceId: String(recordId),
      resourceName: competence,
      newState: {
        userId: args.userId,
        competence,
        grantedBy: admin.userId,
        grantedAt: now,
        expiresAt: args.expiresAt ?? null,
        evidence: evidence ?? null,
      },
      metadata: { userId: args.userId, competence },
      status: 'success',
    });

    return recordId;
  },
});

/**
 * Revoke a grant: stamp `revokedAt`/`revokedBy`, never delete — the record
 * stays as the audit trail behind every review it once justified.
 */
export const revokeCompetence = mutation({
  args: {
    organizationId: v.string(),
    recordId: v.id('competenceRecords'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdminForWrite(
      ctx,
      args.organizationId,
      'competence_revoke_denied',
      { resourceId: String(args.recordId) },
    );

    const record = await ctx.db.get(args.recordId);
    if (!record || record.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'COMPETENCE_NOT_FOUND',
        message: 'no such competence record in this organization',
      });
    }
    if (record.revokedAt !== undefined) {
      throw new ConvexError({
        code: 'COMPETENCE_ALREADY_REVOKED',
        message: 'this competence record is already revoked',
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.recordId, {
      revokedAt: now,
      revokedBy: admin.userId,
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: admin.userId,
      actorEmail: admin.email,
      actorType: 'user',
      action: 'competence_revoked',
      category: 'security',
      resourceType: COMPETENCE_RESOURCE_TYPE,
      resourceId: String(args.recordId),
      resourceName: record.competence,
      previousState: {
        userId: record.userId,
        competence: record.competence,
        grantedBy: record.grantedBy,
        grantedAt: record.grantedAt,
        expiresAt: record.expiresAt ?? null,
        revokedAt: null,
      },
      newState: {
        userId: record.userId,
        competence: record.competence,
        revokedAt: now,
        revokedBy: admin.userId,
      },
      metadata: { userId: record.userId, competence: record.competence },
      status: 'success',
    });

    return null;
  },
});

const competenceRecordItem = v.object({
  _id: v.id('competenceRecords'),
  _creationTime: v.number(),
  organizationId: v.string(),
  userId: v.string(),
  competence: v.string(),
  grantedBy: v.string(),
  grantedAt: v.number(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  revokedBy: v.optional(v.string()),
  evidence: v.optional(v.string()),
});

/** Every competence record of the org (admin-only — a governance surface,
 * like the legal-hold list). Newest grants first. */
export const listOrgCompetences = query({
  args: { organizationId: v.string() },
  returns: v.array(competenceRecordItem),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can list competence records.',
      });
    }
    const rows = await ctx.db
      .query('competenceRecords')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
    return rows.sort((a, b) => b.grantedAt - a.grantedAt);
  },
});

/** One member's competence records — the member themselves, or an admin. */
export const listUserCompetences = query({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.array(competenceRecordItem),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email ?? '',
    });
    if (authUser.userId !== args.userId && !isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: "Only org admins can list another member's competences.",
      });
    }
    const rows = await ctx.db
      .query('competenceRecords')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .collect();
    return rows.sort((a, b) => b.grantedAt - a.grantedAt);
  },
});
