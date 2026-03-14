import type { QueryCtx } from '../_generated/server';

import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';

/**
 * Get all RAG-indexed document IDs accessible to a user within an organization.
 *
 * Resolves the user's team memberships internally, then filters documents:
 * - Org-wide documents (no teams) are always included
 * - Team-scoped documents are included if the user belongs to at least one team
 *
 * Only returns documents with ragInfo.status === 'completed'.
 */
export async function getAccessibleDocumentIds(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
  },
): Promise<string[]> {
  const userTeamIds = await getUserTeamIds(ctx, args.userId);
  const teamSet = new Set([`org_${args.organizationId}`, ...userTeamIds]);

  const ids: string[] = [];
  const query = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  for await (const doc of query) {
    if (doc.ragInfo?.status !== 'completed') continue;

    if (hasTeamAccess(doc, teamSet)) {
      ids.push(doc._id);
    }
  }

  return ids;
}
