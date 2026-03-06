import type { QueryCtx } from '../_generated/server';

/**
 * Get all RAG-indexed document IDs accessible to a user within an organization.
 *
 * A document is accessible if:
 * - It has no teamId (org-wide), OR
 * - Its teamId is in the user's team list
 *
 * Only returns documents with ragInfo.status === 'completed'.
 */
export async function getAccessibleDocumentIds(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userTeamIds: string[];
  },
): Promise<string[]> {
  const teamSet = new Set(args.userTeamIds);

  const ids: string[] = [];
  const query = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  for await (const doc of query) {
    if (doc.ragInfo?.status !== 'completed') continue;

    const isOrgWide = !doc.teamId;
    const isInUserTeam = doc.teamId ? teamSet.has(doc.teamId) : false;

    if (isOrgWide || isInUserTeam) {
      ids.push(doc._id);
    }
  }

  return ids;
}
