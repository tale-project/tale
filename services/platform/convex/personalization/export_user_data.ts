import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

const SCHEMA_VERSION = 1;

interface ExportPayload {
  schemaVersion: number;
  generatedAt: number;
  organizationId: string;
  userId: string;
  preferences: Doc<'userPreferences'> | null;
  memories: Doc<'userMemories'>[];
  auditLog: Doc<'userMemoryAuditLog'>[];
}

/**
 * GDPR Art 15 (right of access) + Art 20 (data portability) export. Returns
 * a single JSON document covering everything Tale stores for the calling
 * user in the given org: prefs, all memories (including soft-deleted,
 * since they're still personal data within the retention window), and
 * audit-log rows whose pseudonymised subject matches the caller.
 *
 * Auth: callable by the data subject only (`assertSelfAndOrgMember`); admins
 * cannot export another user's data through this endpoint — a separate
 * legal-hold path would be added in v2 if needed.
 */
export const exportMyPersonalData = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<ExportPayload> => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );

    const preferences = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .first();

    const memories = await ctx.db
      .query('userMemories')
      .withIndex('by_user_org_status_deleted_created', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .collect();

    const auditLog = await ctx.db
      .query('userMemoryAuditLog')
      .withIndex('by_org_subject_at', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('subjectUserId', authUser.userId),
      )
      .collect();

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: Date.now(),
      organizationId: args.organizationId,
      userId: authUser.userId,
      preferences: preferences ?? null,
      memories,
      auditLog,
    };
  },
});
