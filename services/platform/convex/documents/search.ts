/**
 * Document search for the global ⌘K palette — readable Knowledge Hub and
 * project files, matched by title. Unlike the chat `@` mention picker, this
 * does not require RAG indexing; it is navigation, not retrieval.
 */

import type { PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { documentsSearchStrategy, runEntitySearch } from '../lib/search';
import { hasProjectAccess } from '../projects/access';
import { isActiveDocument } from './_helpers';
import {
  hasKnowledgeHubDocumentAccess,
  isProjectScopedDocument,
} from './access';

const MAX_RESULTS = 25;
const PAGE_SIZE = 50;

function snippetForDocument(doc: Doc<'documents'>): string {
  if (doc.folderPath?.trim()) return doc.folderPath.trim();
  if (doc.projectId) return 'Project file';
  return '';
}

async function collectReadableProjectIds(
  ctx: QueryCtx,
  organizationId: string,
  auth: { role: string; teamIds: string[] },
): Promise<Set<string>> {
  const projectIds = new Set<string>();
  for await (const row of ctx.db
    .query('projects')
    .withIndex('by_organization_archived', (q) =>
      q.eq('organizationId', organizationId).eq('archivedAt', undefined),
    )) {
    if (!hasProjectAccess(row, auth.teamIds, auth.role)) continue;
    projectIds.add(String(row._id));
  }
  return projectIds;
}

async function collectDocumentHits(
  ctx: QueryCtx,
  args: { organizationId: string; query: string },
  auth: { role: string; teamIds: string[] },
): Promise<
  Array<{
    documentId: Id<'documents'>;
    title: string;
    snippet: string;
    folderId?: Id<'folders'>;
    projectId?: Id<'projects'>;
    updatedAt: number;
  }>
> {
  const readableProjectIds = await collectReadableProjectIds(
    ctx,
    args.organizationId,
    auth,
  );
  const teamSet = new Set(auth.teamIds);

  const hits: Array<{
    documentId: Id<'documents'>;
    title: string;
    snippet: string;
    folderId?: Id<'folders'>;
    projectId?: Id<'projects'>;
    updatedAt: number;
  }> = [];
  let cursor: string | null = null;

  while (hits.length < MAX_RESULTS) {
    const page: PaginationResult<Doc<'documents'>> = await runEntitySearch(
      ctx,
      documentsSearchStrategy,
      {
        organizationId: args.organizationId,
        term: args.query,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
        accessFilter: (row) => {
          if (!isActiveDocument(row)) return false;
          if (isProjectScopedDocument(row)) {
            return (
              row.projectId != null &&
              readableProjectIds.has(String(row.projectId))
            );
          }
          return hasKnowledgeHubDocumentAccess(row, teamSet);
        },
      },
    );

    for (const row of page.page) {
      hits.push({
        documentId: row._id,
        title: row.title?.trim() || 'Untitled',
        snippet: snippetForDocument(row),
        folderId: row.folderId,
        projectId: row.projectId,
        updatedAt: row.sourceModifiedAt ?? row._creationTime,
      });
      if (hits.length >= MAX_RESULTS) break;
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
    if (page.page.length === 0 && !page.isDone) continue;
  }

  return hits;
}

export const searchDocuments = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
  },
  returns: v.array(
    v.object({
      documentId: v.id('documents'),
      title: v.string(),
      snippet: v.string(),
      folderId: v.optional(v.id('folders')),
      projectId: v.optional(v.id('projects')),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    const teamIds = await getUserTeamIds(ctx, member.userId);
    const trimmed = args.query.trim();
    if (trimmed.length === 0) return [];

    return collectDocumentHits(
      ctx,
      { organizationId: args.organizationId, query: trimmed },
      { role: member.role, teamIds },
    );
  },
});
