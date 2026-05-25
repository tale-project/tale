import type { QueryCtx } from '../_generated/server';

/**
 * Get RAG-indexed file storage IDs scoped to a agent's knowledge config.
 *
 * Access layers (in order):
 * 1. Agent-specific files — always included (passed in directly as knowledgeFileIds)
 * 2. Team documents — included when includeTeamKnowledge !== false and agent has teams
 * 3. Org-wide documents — included when includeOrgKnowledge is true
 * 4. Project documents — included when chatting inside a project (agentProjectIds set).
 *    Per the projects mutual-exclusivity rule, a project doc has projectId set and
 *    teamId cleared — so this branch never double-counts with the team layer.
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
    /**
     * Project IDs whose documents should be unioned into the file set.
     * Typically a single-element array (one project per chat).
     */
    agentProjectIds?: string[];
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

  const agentProjectIdSet = new Set<string>(args.agentProjectIds ?? []);

  const needsTeamDocs =
    args.includeTeamKnowledge !== false && agentTeamIdSet.size > 0;
  const needsOrgDocs = args.includeOrgKnowledge === true;
  const needsProjectDocs = agentProjectIdSet.size > 0;

  if (!needsTeamDocs && !needsOrgDocs && !needsProjectDocs) {
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

    if (
      needsProjectDocs &&
      doc.projectId &&
      agentProjectIdSet.has(doc.projectId)
    ) {
      fileIdSet.add(fileId);
      continue;
    }

    if (needsTeamDocs && doc.teamId && agentTeamIdSet.has(doc.teamId)) {
      fileIdSet.add(fileId);
      continue;
    }

    if (needsOrgDocs && !doc.teamId && !doc.projectId) {
      fileIdSet.add(fileId);
    }
  }

  return [...fileIdSet];
}
