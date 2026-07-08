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
  parseMentionTokens,
  type ResolvedMention,
} from '../tasks/mentions';

/**
 * Drop `@` tokens that were already consumed by a knowledge-base reference
 * (an `@file.pdf` / `@Folder` pin the composer resolved into
 * referencedDocumentIds/referencedFolderIds). The actor-mention scanner
 * re-parses the raw text and would otherwise report those pins as
 * "did not match anyone in your organization" — a false positive on every
 * successful file mention. Each reference name is reduced to exactly the
 * token `MENTION_RE` would capture from `@<name>` so the exclusion matches
 * what the scanner saw (e.g. `@Q3 Report.pdf` scans as `Q3`).
 */
export function excludeKbReferenceTokens(
  unresolvedTokens: readonly string[],
  referenceNames: readonly string[],
): string[] {
  if (unresolvedTokens.length === 0 || referenceNames.length === 0) {
    return [...unresolvedTokens];
  }
  const excluded = new Set<string>();
  for (const name of referenceNames) {
    for (const token of parseMentionTokens(`@${name}`)) {
      excluded.add(token);
    }
  }
  return unresolvedTokens.filter((token) => !excluded.has(token));
}

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
