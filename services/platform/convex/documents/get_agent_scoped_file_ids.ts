import type { QueryCtx } from '../_generated/server';

/**
 * Get RAG-indexed file storage IDs scoped to a agent's knowledge config.
 *
 * Access layers (in order):
 * 1. Agent-specific files — always included (passed in directly as knowledgeFileIds)
 * 2. Team documents — included when includeTeamKnowledge !== false and agent has teams
 * 3. Org-wide documents — included when includeOrgKnowledge is true
 *
 * Only returns documents with ragInfo.status === 'completed' and a valid fileId.
 */
export async function getAgentScopedFileIds(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    agentTeamId?: string;
    agentTeamIds?: string[];
    includeTeamKnowledge?: boolean;
    includeOrgKnowledge?: boolean;
    knowledgeFileIds?: string[];
  },
): Promise<string[]> {
  const fileIdSet = new Set<string>(args.knowledgeFileIds ?? []);

  // Build effective team set: prefer agentTeamIds, fall back to single agentTeamId
  const agentTeamIdSet = new Set<string>();
  if (args.agentTeamIds) {
    for (const id of args.agentTeamIds) agentTeamIdSet.add(id);
  } else if (args.agentTeamId) {
    agentTeamIdSet.add(args.agentTeamId);
  }

  const needsTeamDocs =
    args.includeTeamKnowledge !== false && agentTeamIdSet.size > 0;
  const needsOrgDocs = args.includeOrgKnowledge === true;

  if (!needsTeamDocs && !needsOrgDocs) {
    return [...fileIdSet];
  }

  const query = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_indexed', (q) =>
      q.eq('organizationId', args.organizationId).eq('indexed', true),
    );

  for await (const doc of query) {
    if (!doc.fileId) continue;

    const fileId = String(doc.fileId);
    if (fileIdSet.has(fileId)) continue;

    if (needsTeamDocs && doc.teamId && agentTeamIdSet.has(doc.teamId)) {
      fileIdSet.add(fileId);
      continue;
    }

    if (needsOrgDocs && !doc.teamId) {
      fileIdSet.add(fileId);
    }
  }

  return [...fileIdSet];
}
