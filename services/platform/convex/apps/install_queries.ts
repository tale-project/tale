import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Reactive install state for every app installed in the org — powers the hub's
 * Install/Installed/Reinstall badges and the per-app readiness checklist. Kept
 * DB-only (no manifest/FS read) so it stays a live query: the app's required
 * integrations are denormalized onto the install row, and "connected" is read
 * straight off `integrationCredentials`. The missing-file integrity check
 * (which needs the filesystem) lives in the `verifyAppIntegrity` action, whose
 * result is reflected here via the row's `status`.
 */
export const getAppInstallState = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      appSlug: v.string(),
      status: v.union(v.literal('active'), v.literal('broken')),
      installedAt: v.number(),
      /** Required integrations that are NOT yet connected (setup steps). */
      blockedIntegrations: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const isConnected = async (slug: string): Promise<boolean> => {
      const cred = await ctx.db
        .query('integrationCredentials')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', args.organizationId).eq('slug', slug),
        )
        .first();
      return cred !== null && cred.isActive && cred.status === 'active';
    };

    const out: Array<{
      appSlug: string;
      status: 'active' | 'broken';
      installedAt: number;
      blockedIntegrations: string[];
    }> = [];
    for await (const row of ctx.db
      .query('appInstallations')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const blocked: string[] = [];
      for (const slug of row.requiredIntegrations) {
        if (!(await isConnected(slug))) blocked.push(slug);
      }
      out.push({
        appSlug: row.appSlug,
        status: row.status,
        installedAt: row.installedAt,
        blockedIntegrations: blocked,
      });
    }
    return out;
  },
});
