/**
 * Mention/assignee directory for tasks.
 *
 * Builds the set of `@`-mentionable actors for a project: organization members
 * (humans), the agents the project exposes, and the deployed automations
 * visible from it. Used by the task mutations to resolve `@token` mentions to
 * `{type,id}` refs (see `tasks/mentions.ts`).
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
import { bindingsOf, versionRow } from '../automations/store';
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

  // DEPLOYED automations visible from this project (bound to it, or
  // org-level) resolve by store name and by display name — '@vat-return-desk',
  // '@swiss.vat.return.desk'. Mentioning a task's OWNING automation is the
  // comment-side run trigger (`triggerMentionedTaskAutomation`), exactly as
  // @-ing an agent instance is for the agent lane; on any other surface the
  // mention is presentational. Pushed after the legacy slugs (an automation
  // shadows a retired same-named slug) but before the instances below (a
  // project's own agent instance stays the strongest claim on a handle).
  try {
    const deployments = await ctx.db
      .query('automationDeployments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    for (const deployment of deployments) {
      const bindings = await bindingsOf(
        ctx,
        args.organizationId,
        deployment.name,
      );
      if (
        bindings.length > 0 &&
        !bindings.some((binding) => binding.projectId === args.project._id)
      ) {
        continue;
      }
      const version = await versionRow(
        ctx,
        args.organizationId,
        deployment.name,
        deployment.version,
      );
      if (!version) continue;
      entries.push({
        type: 'automation',
        id: deployment.name,
        handles: automationHandles(
          deployment.name,
          presentationName(version.presentation),
        ),
      });
    }
  } catch (error) {
    console.warn(
      '[tasks] buildMentionDirectory: automation listing failed',
      error,
    );
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
      const handles = agentInstanceHandles(instance.name, String(instance._id));
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

/** The base (English) display name out of an automation version's untyped
 * `presentation` blob, if it carries one. Handles are locale-independent, so
 * only the base name feeds them — per-locale names stay a render concern. */
function presentationName(presentation: unknown): string | undefined {
  if (
    presentation !== null &&
    typeof presentation === 'object' &&
    'name' in presentation &&
    typeof presentation.name === 'string' &&
    presentation.name.trim() !== ''
  ) {
    return presentation.name;
  }
  return undefined;
}

/** Derive candidate `@handle`s for a deployed automation: the store name
 * (the stable addressing form the composer inserts) plus the display-name
 * variants (dot-joined and squashed, matching the member/instance
 * convention) so a hand-typed `@swiss.vat.return.desk` resolves too. */
function automationHandles(name: string, displayName?: string): string[] {
  const handles = new Set<string>([name.toLowerCase()]);
  const normalized = (displayName ?? '').trim().toLowerCase();
  if (normalized !== '') {
    handles.add(normalized.replace(/\s+/g, '.'));
    handles.add(normalized.replace(/\s+/g, ''));
  }
  return [...handles];
}

/** Derive candidate `@handle`s for a project agent instance: the display
 * name (member convention minus email — dot-joined and squashed) plus the
 * instance id itself, so a picker-inserted or copied id token resolves even
 * under `agentMode: 'restricted'` (where the permissive fallback is off)
 * and two same-named instances keep a collision-proof form. */
function agentInstanceHandles(name: string, instanceId: string): string[] {
  const normalized = name.trim().toLowerCase();
  const variants =
    normalized === ''
      ? []
      : [normalized.replace(/\s+/g, '.'), normalized.replace(/\s+/g, '')];
  return [...new Set([...variants, instanceId.toLowerCase()])];
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
