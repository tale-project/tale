import type { QueryCtx } from '../_generated/server';

/**
 * Get RAG-indexed file storage IDs scoped to a custom agent's knowledge config.
 *
 * Access layers (in order):
 * 1. Agent-specific files — always included (passed in directly as knowledgeFileIds)
 * 2. Team documents — included when includeTeamKnowledge !== false and agentTeamId is set
 * 3. Org-wide documents — included when includeOrgKnowledge is true
 *
 * Only returns documents with ragInfo.status === 'completed' and a valid fileId.
 */
export async function getAgentScopedFileIds(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    agentTeamId?: string;
    includeTeamKnowledge?: boolean;
    includeOrgKnowledge?: boolean;
    knowledgeFileIds?: string[];
  },
): Promise<string[]> {
  const fileIdSet = new Set<string>(args.knowledgeFileIds ?? []);

  const needsTeamDocs =
    args.includeTeamKnowledge !== false && !!args.agentTeamId;
  const needsOrgDocs = args.includeOrgKnowledge === true;

  if (!needsTeamDocs && !needsOrgDocs) {
    return [...fileIdSet];
  }

  const query = ctx.db
    .query('documents')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  for await (const doc of query) {
    if (doc.ragInfo?.status !== 'completed') continue;
    if (!doc.fileId) continue;

    const fileId = String(doc.fileId);
    if (fileIdSet.has(fileId)) continue;

    if (needsTeamDocs && doc.teamId === args.agentTeamId) {
      fileIdSet.add(fileId);
      continue;
    }

    if (needsOrgDocs && !doc.teamId) {
      fileIdSet.add(fileId);
    }
  }

  return [...fileIdSet];
}
