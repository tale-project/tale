import type { QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { isActiveDocument } from './_helpers';
import { hasKnowledgeHubDocumentAccess } from './access';

/**
 * Get all document IDs accessible to a user within an organization.
 *
 * Resolves the user's team memberships internally, then filters documents:
 * - Org-wide documents (no teams) are always included
 * - Team-scoped documents are included if the user belongs to at least one team
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
    // Trashed/expired docs (e.g. via WebDAV DELETE) must not be retrievable by
    // agents — this helper gates document_retrieve's access check.
    if (!isActiveDocument(doc)) continue;
    if (hasKnowledgeHubDocumentAccess(doc, teamSet)) {
      ids.push(doc._id);
    }
  }

  return ids;
}
