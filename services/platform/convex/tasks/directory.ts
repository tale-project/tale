/**
 * Mention/assignee directory for tasks.
 *
 * Builds the set of `@`-mentionable actors for a project: organization members
 * (humans) and the agents the project exposes. Used by the task mutations to
 * resolve `@token` mentions to `{type,id}` refs (see `tasks/mentions.ts`).
 *
 * Agent scoping follows the project agent gates (`task_ops.ts`):
 * `agentMode: 'restricted'` limits mentionable agents to the project's
 * `allowedAgentSlugs`; the default `'all'` exposes every org agent. The agent
 * roster is file-based and only enumerable from the Node runtime, so in 'all'
 * mode the directory can't list agents — it sets `permissiveAgents` instead
 * and the resolver accepts any unmatched token as an agent handle (nonexistent
 * slugs are quiet no-ops at run admission).
 */

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { listByOrganizationHandler } from '../members/queries';
import { getProjectAccessibleUserIds } from '../projects/accessible_members';
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

export interface MentionDirectory {
  entries: MentionDirectoryEntry[];
  /** 'all'-agent-mode projects: any token that resolves to no member is
   *  treated as an agent handle (see module docstring). */
  permissiveAgents: boolean;
}

/**
 * Build the directory of mentionable actors for a project. Degrades gracefully
 * to whatever can be resolved (members or agents alone) rather than throwing.
 */
export async function buildMentionDirectory(
  ctx: QueryCtx | MutationCtx,
  args: { organizationId: string; project: Doc<'projects'> },
): Promise<MentionDirectory> {
  const entries: MentionDirectoryEntry[] = [];

  try {
    const members = await listByOrganizationHandler(ctx, {
      organizationId: args.organizationId,
    });
    // Only members who can access the project are mentionable — matches the
    // assignee picker's scoping (`use-actor-directory`). `null` = org-wide.
    const accessible = await getProjectAccessibleUserIds(ctx, args.project);
    for (const member of members) {
      if (member.role === 'disabled') continue;
      if (accessible && !accessible.has(member.userId)) continue;
      entries.push({
        type: 'user',
        id: member.userId,
        handles: memberHandles(member),
      });
    }
  } catch (error) {
    console.warn('[tasks] buildMentionDirectory: member listing failed', error);
  }

  // Explicitly listed agents (allow/recommended — project config) resolve by
  // slug. There is no DB install gate any more (the `agentInstallations`
  // bookkeeping died with the retired install system; the roster is
  // file-based) — a listed slug that names no roster agent still resolves as
  // a mention but cannot actually run: run admission is the effective gate,
  // exactly as for the permissive 'all'-mode path below.
  const agentSlugs = new Set<string>([
    ...(args.project.allowedAgentSlugs ?? []),
    ...(args.project.recommendedAgentSlugs ?? []),
  ]);
  for (const slug of agentSlugs) {
    entries.push({ type: 'agent', id: slug, handles: [slug.toLowerCase()] });
  }

  // The project's agent INSTANCES resolve by display name — '@alice',
  // '@pr.reviewer'. Pushed LAST so an instance handle shadows a same-named
  // legacy slug in the resolver's handle map, and a mention reaches the
  // instance lane (comment @mention → assign + run), never the retired one.
  try {
    const instances = await ctx.db
      .query('projectAgents')
      .withIndex('by_project', (q) => q.eq('projectId', args.project._id))
      .collect();
    for (const instance of instances) {
      const handles = agentInstanceHandles(instance.name);
      if (handles.length > 0) {
        entries.push({ type: 'agent', id: String(instance._id), handles });
      }
    }
  } catch (error) {
    console.warn(
      '[tasks] buildMentionDirectory: agent instance listing failed',
      error,
    );
  }

  return {
    entries,
    permissiveAgents: (args.project.agentMode ?? 'all') !== 'restricted',
  };
}

/** Derive candidate `@handle`s for a project agent instance from its display
 * name — the member convention minus email: spaces collapsed and dot-joined. */
function agentInstanceHandles(name: string): string[] {
  const normalized = name.trim().toLowerCase();
  if (normalized === '') return [];
  return [
    ...new Set([
      normalized.replace(/\s+/g, ''),
      normalized.replace(/\s+/g, '.'),
    ]),
  ];
}

/**
 * Org-wide human mention directory for surfaces without a project anchor
 * (private agent chat). Agents are omitted — chat `@` routing for agents is
 * out of scope here; only teammate notifications are fan-out.
 */
export async function buildOrgMentionDirectory(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<MentionDirectory> {
  const entries: MentionDirectoryEntry[] = [];
  try {
    const members = await listByOrganizationHandler(ctx, { organizationId });
    for (const member of members) {
      entries.push({
        type: 'user',
        id: member.userId,
        handles: memberHandles(member),
      });
    }
  } catch (error) {
    console.warn(
      '[tasks] buildOrgMentionDirectory: member listing failed',
      error,
    );
  }
  return { entries, permissiveAgents: false };
}
