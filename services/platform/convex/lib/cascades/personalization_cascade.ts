import type { MutationCtx } from '../../_generated/server';

/**
 * Active erasure cascades for the personalization tables. These run on
 * authoritative lifecycle events (member removal, org deletion) and
 * hard-delete the underlying rows immediately. They are the GDPR Art 17
 * erasure path; opportunistic lazy cleanup is for storage hygiene only
 * and is not on the erasure critical path.
 *
 * Audit-log rows are NOT deleted by these hooks — they retain the raw
 * `subjectUserId` for compliance reporting. Admin-blind pseudonymisation
 * can be reintroduced when an admin-readable audit view ships.
 *
 * NOTE: account-level deletion is not yet a product feature on this
 * deployment (Better Auth's user-delete plugin is not wired). When that
 * lands, add a `cascadeOnUserAccountDeleted` hook that fans out across
 * the user's orgs.
 */

async function deleteAllForUserOrg(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<void> {
  const memories = await ctx.db
    .query('userMemories')
    .withIndex('by_user_org_status_deleted_created', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .collect();
  for (const m of memories) await ctx.db.delete(m._id);

  const prefs = await ctx.db
    .query('userPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .collect();
  for (const p of prefs) await ctx.db.delete(p._id);
}

/**
 * Member removed from an org: hard-delete that user's prefs + memories
 * scoped to the org. The user keeps their data in any other org they're in.
 */
export async function cascadeOnMemberRemoved(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
): Promise<void> {
  await deleteAllForUserOrg(ctx, userId, organizationId);
}

/**
 * Organization deleted: hard-delete all prefs + memories scoped to the org
 * across every user. Audit-log rows for the org are retained for the
 * configured audit retention window — do not call this hook to scrub
 * audits; that's a separate retention concern.
 */
export async function cascadeOnOrgDeleted(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  const memories = await ctx.db
    .query('userMemories')
    .filter((q) => q.eq(q.field('organizationId'), organizationId))
    .collect();
  for (const m of memories) await ctx.db.delete(m._id);

  const prefs = await ctx.db
    .query('userPreferences')
    .filter((q) => q.eq(q.field('organizationId'), organizationId))
    .collect();
  for (const p of prefs) await ctx.db.delete(p._id);
}
