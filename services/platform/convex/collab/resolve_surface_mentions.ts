/**
 * Shared mention resolution for human-authored surfaces (tasks, discussions,
 * agent chat). Keeps directory selection + unresolved-token detection in one
 * place so every write path reports the same shape to the client.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  buildMentionDirectory,
  buildOrgMentionDirectory,
} from '../tasks/directory';
import {
  extractMentions,
  findUnresolvedMentionTokens,
  type ResolvedMention,
} from '../tasks/mentions';

export interface SurfaceMentionResolution {
  mentions: ResolvedMention[];
  unresolvedMentionTokens: string[];
}

export async function resolveSurfaceMentions(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    body: string;
    projectId?: Id<'projects'>;
  },
): Promise<SurfaceMentionResolution> {
  let directory;
  if (args.projectId) {
    const project = await ctx.db.get(args.projectId);
    if (project && project.organizationId === args.organizationId) {
      directory = await buildMentionDirectory(ctx, {
        organizationId: args.organizationId,
        project,
      });
    } else {
      directory = await buildOrgMentionDirectory(ctx, args.organizationId);
    }
  } else {
    directory = await buildOrgMentionDirectory(ctx, args.organizationId);
  }

  const mentions = extractMentions(
    args.body,
    directory.entries,
    directory.permissiveAgents,
  );
  const unresolvedMentionTokens = findUnresolvedMentionTokens(
    args.body,
    directory.entries,
    directory.permissiveAgents,
  );
  return { mentions, unresolvedMentionTokens };
}
