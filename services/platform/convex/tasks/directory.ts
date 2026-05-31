/**
 * Mention/assignee directory for tasks.
 *
 * Builds the set of `@`-mentionable actors for a project: organization members
 * (humans) and the agent slugs the project exposes. Used by the comment
 * mutation to resolve `@token` mentions to `{type,id}` refs (see
 * `tasks/mentions.ts`). The richer directory UI + autocomplete and human↔agent
 * chat directory arrive in the collaboration milestone; this is the minimal
 * server-side resolver M0 needs.
 */

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { listByOrganizationHandler } from '../members/queries';
import type { MentionDirectoryEntry } from './mentions';

/** Derive candidate `@handle`s for a member from email + display name. */
function memberHandles(member: {
  userId: string;
  email?: string;
  displayName?: string;
}): string[] {
  const handles = new Set<string>();
  handles.add(member.userId.toLowerCase());
  if (member.email) {
    const local = member.email.split('@')[0];
    if (local) handles.add(local.toLowerCase());
  }
  if (member.displayName) {
    const name = member.displayName.trim().toLowerCase();
    if (name) {
      handles.add(name.replace(/\s+/g, ''));
      handles.add(name.replace(/\s+/g, '.'));
    }
  }
  return [...handles];
}

/**
 * Build the directory of mentionable actors for a project. Degrades gracefully
 * to whatever can be resolved (members or agents alone) rather than throwing.
 */
export async function buildMentionDirectory(
  ctx: QueryCtx | MutationCtx,
  args: { organizationId: string; project: Doc<'projects'> },
): Promise<MentionDirectoryEntry[]> {
  const entries: MentionDirectoryEntry[] = [];

  try {
    const members = await listByOrganizationHandler(ctx, {
      organizationId: args.organizationId,
    });
    for (const member of members) {
      entries.push({
        type: 'user',
        id: member.userId,
        handles: memberHandles(member),
      });
    }
  } catch (error) {
    console.warn('[tasks] buildMentionDirectory: member listing failed', error);
  }

  // Agents the project exposes (slug is its own handle). Full agent directory
  // enumeration lands with the collaboration milestone.
  const agentSlugs = new Set<string>([
    ...(args.project.allowedAgentSlugs ?? []),
    ...(args.project.recommendedAgentSlugs ?? []),
  ]);
  for (const slug of agentSlugs) {
    entries.push({ type: 'agent', id: slug, handles: [slug.toLowerCase()] });
  }

  return entries;
}
