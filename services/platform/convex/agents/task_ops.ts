'use node';

/**
 * Task-ops agent operations for the automation pack, exposed to workflows
 * through the `agent` action (`workflow_engine/action_defs/agent/agent_action.ts`):
 *
 *  - `getOrgRole`         — compatibility shim for the retired org-chart
 *                           (`delegates`) layer: every agent is a chartless
 *                           root now (never a manager, no chain). Kept so
 *                           installed org copies of the assignment workflow
 *                           keep executing.
 *  - `listTaskCandidates` — assignable agents for a task, honoring the
 *                           project's agent gates (triage scoring input).
 *  - `reassignOrUnassign` — budget-pause handling: unassign the task so
 *                           unassigned-triage re-routes it (the
 *                           reassign-to-manager path retired with the chart).
 *
 * Roster reads go through `listAgentsForOrg`, which carries a module-scope 60s
 * cache — one dir scan per org per minute across all consumers.
 */

import { v } from 'convex/values';

import { RESERVED_AGENT_SLUGS } from '../../lib/shared/constants/agents';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { listAgentsForOrg } from './internal_actions';

export interface AssignableAgent {
  slug: string;
  description?: string;
}

const RESERVED = new Set<string>(RESERVED_AGENT_SLUGS);

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Every real org agent (router/system slugs excluded), projected off the
 * cached agent list.
 */
export async function listAssignableAgents(
  orgSlug: string,
): Promise<AssignableAgent[]> {
  const raw = await listAgentsForOrg(orgSlug);
  const roster: AssignableAgent[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const slug = asOptionalString(entry.name);
    if (!slug) continue;
    if (entry.isRouter === true || RESERVED.has(slug)) continue;
    // Unreadable configs surface in the list as {name, status, message} error
    // rows — they have no display payload and must not become candidates.
    if (typeof entry.status === 'string') continue;
    roster.push({
      slug,
      description: asOptionalString(entry.description),
    });
  }
  return roster;
}

/**
 * Compatibility shim for the retired org-chart layer. The `delegates` edges
 * are gone, so every agent resolves to a chartless root: `isManager` is
 * always false, `directReports`/`chain` are empty, `managerSlug` is never
 * set. Installed org workflows that branch on `isManager` fall through to
 * their non-manager path.
 */
export const getOrgRole = internalAction({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  returns: v.object({
    exists: v.boolean(),
    isManager: v.boolean(),
    directReports: v.array(v.string()),
    managerSlug: v.optional(v.string()),
    chain: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const roster = await listAssignableAgents(orgSlug);
    return {
      exists: roster.some((entry) => entry.slug === args.agentSlug),
      isManager: false,
      directReports: [],
      chain: [],
    };
  },
});

const CANDIDATE_CAP = 25;
const CANDIDATE_DESCRIPTION_MAX = 240;

export interface TaskCandidate {
  slug: string;
  description: string;
  /** Retired org-chart flag, kept for installed-workflow prompt-shape compat. */
  isManager: boolean;
  /** On the project's recommended list (or its restricted allow-list). */
  preferred: boolean;
}

/**
 * Agents assignable to a task, honoring the project's agent gates:
 * `restricted` → allow-list only; `recommended` → full roster with the
 * recommended slugs flagged `preferred`; `all`/unset → full roster. The
 * triage workflow feeds these to an LLM scoring step.
 */
export const listTaskCandidates = internalAction({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
  },
  returns: v.object({
    candidates: v.array(
      v.object({
        slug: v.string(),
        description: v.string(),
        isManager: v.boolean(),
        preferred: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<{ candidates: TaskCandidate[] }> => {
    const task = await ctx.runQuery(
      internal.tasks.internal_queries.getTaskByIdInternal,
      { taskId: args.taskId, organizationId: args.organizationId },
    );
    if (!task) return { candidates: [] };
    const project = await ctx.runQuery(
      internal.tasks.internal_queries.getProjectByIdInternal,
      { projectId: task.projectId, organizationId: args.organizationId },
    );
    if (!project) return { candidates: [] };

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const roster = await listAssignableAgents(orgSlug);

    const allowed = new Set(project.allowedAgentSlugs ?? []);
    const recommended = new Set(project.recommendedAgentSlugs ?? []);
    const mode = project.agentMode ?? 'all';

    const candidates: TaskCandidate[] = [];
    for (const entry of roster) {
      if (mode === 'restricted' && !allowed.has(entry.slug)) continue;
      candidates.push({
        slug: entry.slug,
        description: (entry.description ?? '').slice(
          0,
          CANDIDATE_DESCRIPTION_MAX,
        ),
        isManager: false,
        preferred:
          mode === 'restricted'
            ? allowed.has(entry.slug)
            : recommended.has(entry.slug),
      });
      if (candidates.length >= CANDIDATE_CAP) break;
    }
    return { candidates };
  },
});

export interface ReassignResult {
  action: 'unassigned' | 'noop';
  reason?: string;
}

const WORKFLOW_ACTOR_ID = 'workflow';

/**
 * Budget-pause task handling. The reassign-to-manager path retired with the
 * org chart, so every mode unassigns: the task goes back to the pool where
 * unassigned-triage picks it up. In-progress tasks roll back to To do so
 * they don't sit half-claimed. The `mode` arg is accepted for backwards
 * compatibility with installed org workflows and ignored.
 */
export const reassignOrUnassign = internalAction({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    agentSlug: v.string(),
    mode: v.optional(
      v.union(v.literal('reassign_to_manager'), v.literal('unassign')),
    ),
  },
  returns: v.object({
    action: v.union(v.literal('unassigned'), v.literal('noop')),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<ReassignResult> => {
    const task = await ctx.runQuery(
      internal.tasks.internal_queries.getTaskByIdInternal,
      { taskId: args.taskId, organizationId: args.organizationId },
    );
    // TOCTOU guard: only act on the task while it is still the paused
    // agent's open work.
    if (
      !task ||
      task.archivedAt ||
      task.status === 'done' ||
      task.status === 'cancelled' ||
      task.assigneeType !== 'agent' ||
      task.assigneeId !== args.agentSlug
    ) {
      return { action: 'noop', reason: 'TASK_CHANGED' };
    }

    await ctx.runMutation(internal.tasks.internal_mutations.agentAssignTask, {
      organizationId: args.organizationId,
      actorId: WORKFLOW_ACTOR_ID,
      taskId: args.taskId,
    });
    if (task.status === 'in_progress') {
      await ctx.runMutation(
        internal.tasks.internal_mutations.agentUpdateTaskStatus,
        {
          organizationId: args.organizationId,
          actorId: WORKFLOW_ACTOR_ID,
          taskId: args.taskId,
          status: 'todo',
        },
      );
    }
    return { action: 'unassigned' };
  },
});
