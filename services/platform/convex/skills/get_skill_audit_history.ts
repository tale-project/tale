/**
 * Recent audit log entries for a single skill, surfaced on the skill
 * detail page so an operator can answer "who edited this and when"
 * without leaving the page. Uses the `by_org_resourceType_resourceId`
 * compound index so the lookup is O(audit-rows-for-this-skill), not
 * O(all-audit-rows-in-the-org).
 *
 * Returns at most 50 rows ordered most-recent-first — enough to cover
 * a normal review session; the full audit log page is one click away
 * for deeper history.
 *
 * Implemented as an `action` so it can share the same
 * `requireOrgAdminOrDeveloper` gate as the read paths in
 * `skills/file_actions.ts` — a plain member can't see the skill body,
 * so they shouldn't see its change history either.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, internalQuery } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';

const MAX_AUDIT_ROWS = 50;

export interface SkillAuditRow {
  _id: string;
  timestamp: number;
  action: string;
  status: string;
  actorId: string;
  actorEmail?: string;
  actorRole?: string;
  previousState?: unknown;
  newState?: unknown;
  errorMessage?: string;
}

export const _readSkillAuditRows = internalQuery({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<SkillAuditRow[]> => {
    const rows = await ctx.db
      .query('auditLogs')
      .withIndex('by_org_resourceType_resourceId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('resourceType', 'skill')
          .eq('resourceId', args.slug),
      )
      .order('desc')
      .take(MAX_AUDIT_ROWS);

    // Project to a stable client-facing shape. `actorEmail` / `actorRole`
    // are stored as plain strings; `previousState` / `newState` are
    // JSON-record validators. Passing them through verbatim keeps the
    // shape uniform with the audit-log page that already renders the
    // same fields.
    return rows.map((r) => ({
      _id: r._id,
      timestamp: r.timestamp,
      action: r.action,
      status: r.status,
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      actorRole: r.actorRole,
      previousState: r.previousState,
      newState: r.newState,
      errorMessage: r.errorMessage,
    }));
  },
});

export const getSkillAuditHistory = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<SkillAuditRow[]> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    return await ctx.runQuery(
      internal.skills.get_skill_audit_history._readSkillAuditRows,
      { organizationId: args.organizationId, slug: args.slug },
    );
  },
});
