import type { QueryCtx } from '../_generated/server';

import { getUserTeamIds } from '../lib/get_user_teams';

/**
 * Get all RAG-indexed document IDs accessible to a user within an organization.
 *
 * Resolves the user's team memberships internally, then filters documents:
 * - Org-wide documents (no teamId) are always included
 * - Team-scoped documents are included if the user belongs to that team
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
  const teamIds = await getUserTeamIds(ctx, args.userId);
  const teamSet = new Set([`org_${args.organizationId}`, ...teamIds]);

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

/**
 * Get all RAG-indexed file storage IDs accessible to a user within an organization.
 *
 * Same access control logic as getAccessibleDocumentIds, but returns file storage IDs
 * instead of document IDs. Skips documents without a fileId.
 */
export async function getAccessibleFileIds(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
  },
): Promise<string[]> {
  const teamIds = await getUserTeamIds(ctx, args.userId);
  const teamSet = new Set([`org_${args.organizationId}`, ...teamIds]);

  const ids: string[] = [];
  const query = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  for await (const doc of query) {
    if (doc.ragInfo?.status !== 'completed') continue;
    if (!doc.fileId) continue;

    const isOrgWide = !doc.teamId;
    const isInUserTeam = doc.teamId ? teamSet.has(doc.teamId) : false;

    if (isOrgWide || isInUserTeam) {
      ids.push(doc.fileId);
    }
  }

  return ids;
}
