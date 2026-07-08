'use node';

/**
 * Workforce org-chart operations for the task-ops automation pack — the
 * runtime slice of the agents-only organigram (`delegates` edges in the agent
 * JSON configs). Exposed to workflows through the `agent` action
 * (`workflow_engine/action_defs/agent/agent_action.ts`):
 *
 *  - `getOrgRole`         — manager/report position of one agent (drives the
 *                           assignment workflow's decompose-vs-run branch and
 *                           SLA manager escalation).
 *  - `listTaskCandidates` — assignable agents for a task, honoring the
 *                           project's agent gates (triage scoring input).
 *  - `reassignOrUnassign` — budget-pause handling: hand the task to the
 *                           agent's manager (guard-checked) or unassign it.
 *
 * Chart reads go through `listAgentsForOrg`, which carries a module-scope 60s
 * cache — one dir scan per org per minute across ALL chart consumers.
 *
 * The `delegates` edges are LEGACY READ-ONLY data: every editor (organigram
 * UI, `agent_write set_delegates`) was removed with the `delegate_*` tools —
 * agent-on-demand replaced delegation. Existing edges still drive manager
 * escalation routing until the workforce rework (M4) retires them.
 */

import { v } from 'convex/values';

import { RESERVED_AGENT_SLUGS } from '../../lib/shared/constants/agents';
import { agentWorkforceConfigSchema } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { type ActionCtx, internalAction } from '../_generated/server';
import { loadDelegateAgents } from '../agent_tools/delegation/load_delegation_agents';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { DEFAULT_AGENT_WORKFORCE } from './guardrails/budget_guard';
import { listAgentsForOrg } from './internal_actions';
import {
  buildOrgChart,
  chainOfCommand,
  type OrgChart,
} from './org_chart_graph';

export interface WorkforceRosterEntry {
  slug: string;
  displayName?: string;
  description?: string;
  /** Agents this agent delegates to (its direct reports). Many-to-many. */
  delegates: string[];
  budget?: { monthlyCents: number; warnPct?: number; pausePct?: number };
  maxConcurrentTasks?: number;
}

const RESERVED = new Set<string>(RESERVED_AGENT_SLUGS);

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
}

function asBudget(
  value: unknown,
): { monthlyCents: number; warnPct?: number; pausePct?: number } | undefined {
  if (!isRecord(value) || typeof value.monthlyCents !== 'number') {
    return undefined;
  }
  return {
    monthlyCents: value.monthlyCents,
    warnPct: typeof value.warnPct === 'number' ? value.warnPct : undefined,
    pausePct: typeof value.pausePct === 'number' ? value.pausePct : undefined,
  };
}

/**
 * The org-chart roster: every real org agent (router/system slugs excluded)
 * with its `delegates` edges, projected off the cached agent list.
 */
export async function readWorkforceRoster(
  orgSlug: string,
): Promise<WorkforceRosterEntry[]> {
  const raw = await listAgentsForOrg(orgSlug);
  const roster: WorkforceRosterEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const slug = asOptionalString(entry.name);
    if (!slug) continue;
    if (entry.isRouter === true || RESERVED.has(slug)) continue;
    // Unreadable configs surface in the list as {name, status, message} error
    // rows — they have no display payload and must not become chart nodes.
    if (typeof entry.status === 'string') continue;
    roster.push({
      slug,
      displayName: asOptionalString(entry.displayName),
      description: asOptionalString(entry.description),
      delegates: asStringArray(entry.delegates),
      budget: asBudget(entry.budget),
      maxConcurrentTasks:
        typeof entry.maxConcurrentTasks === 'number'
          ? entry.maxConcurrentTasks
          : undefined,
    });
  }
  return roster;
}

export function buildChartFromRoster(roster: WorkforceRosterEntry[]): OrgChart {
  return buildOrgChart(
    roster.map((entry) => ({
      slug: entry.slug,
      delegates: entry.delegates,
    })),
  );
}

export interface OrgRole {
  exists: boolean;
  isManager: boolean;
  directReports: string[];
  managerSlug?: string;
  /** Managers above this agent, nearest first. */
  chain: string[];
}

/** Pure resolution shared by the action and other node callers. */
export async function resolveOrgRole(
  orgSlug: string,
  agentSlug: string,
): Promise<OrgRole> {
  const roster = await readWorkforceRoster(orgSlug);
  const chart = buildChartFromRoster(roster);
  const exists = roster.some((entry) => entry.slug === agentSlug);
  const directReports = chart.reports.get(agentSlug) ?? [];
  return {
    exists,
    isManager: directReports.length > 0,
    directReports,
    managerSlug: chart.parents.get(agentSlug),
    chain: chainOfCommand(chart.parents, agentSlug),
  };
}

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
  handler: async (ctx, args): Promise<OrgRole> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    return await resolveOrgRole(orgSlug, args.agentSlug);
  },
});

const CANDIDATE_CAP = 25;
const CANDIDATE_DESCRIPTION_MAX = 240;

export interface TaskCandidate {
  slug: string;
  description: string;
  isManager: boolean;
  /** On the project's recommended list (or its restricted allow-list). */
  preferred: boolean;
}

/**
 * Agents assignable to a task, honoring the project's agent gates:
 * `restricted` → allow-list only; `recommended` → full roster with the
 * recommended slugs flagged `preferred`; `all`/unset → full roster. Only
 * installed+enabled agents are candidates (matches chat roster gate).
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
    const roster = await readWorkforceRoster(orgSlug);
    const chart = buildChartFromRoster(roster);
    const liveSlugs = new Set(
      await ctx.runQuery(
        internal.agents.installations.getEnabledAgentSlugsInternal,
        { organizationId: args.organizationId },
      ),
    );

    const allowed = new Set(project.allowedAgentSlugs ?? []);
    const recommended = new Set(project.recommendedAgentSlugs ?? []);
    const mode = project.agentMode ?? 'all';

    const candidates: TaskCandidate[] = [];
    for (const entry of roster) {
      if (!liveSlugs.has(entry.slug)) continue;
      if (mode === 'restricted' && !allowed.has(entry.slug)) continue;
      candidates.push({
        slug: entry.slug,
        description: (entry.description ?? '').slice(
          0,
          CANDIDATE_DESCRIPTION_MAX,
        ),
        isManager: (chart.reports.get(entry.slug) ?? []).length > 0,
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

type ReassignMode = 'reassign_to_manager' | 'unassign';

async function readBudgetPauseAction(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ReassignMode> {
  const raw = await ctx.runQuery(
    internal.governance.internal_queries.getPolicyConfigInternal,
    { organizationId, policyType: 'agent_workforce' },
  );
  if (!raw) return DEFAULT_AGENT_WORKFORCE.budgetPauseAction;
  const parsed = agentWorkforceConfigSchema.safeParse(raw);
  return parsed.success
    ? parsed.data.budgetPauseAction
    : DEFAULT_AGENT_WORKFORCE.budgetPauseAction;
}

export interface ReassignResult {
  action: 'reassigned' | 'unassigned' | 'noop';
  managerSlug?: string;
  reason?: string;
}

const WORKFLOW_ACTOR_ID = 'workflow';

/**
 * Budget-pause task handling. `reassign_to_manager` walks one step up the
 * org chart and re-assigns (which re-emits `task.assigned` → the assignment
 * workflow runs the MANAGER under its own guard verdict); when there is no
 * manager — or the manager's own guardrails refuse — the task is unassigned
 * instead, where unassigned-triage picks it up. In-progress tasks roll back
 * to To do on unassign so they don't sit half-claimed.
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
    action: v.union(
      v.literal('reassigned'),
      v.literal('unassigned'),
      v.literal('noop'),
    ),
    managerSlug: v.optional(v.string()),
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

    const mode =
      args.mode ?? (await readBudgetPauseAction(ctx, args.organizationId));

    const unassign = async (reason?: string): Promise<ReassignResult> => {
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
      return { action: 'unassigned', reason };
    };

    if (mode === 'unassign') return await unassign();

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const role = await resolveOrgRole(orgSlug, args.agentSlug);
    if (!role.managerSlug) return await unassign('NO_MANAGER');

    const [manager] = await loadDelegateAgents(
      ctx,
      [role.managerSlug],
      args.organizationId,
      orgSlug,
    );
    if (!manager) return await unassign('MANAGER_NOT_FOUND');

    const managerLive = await ctx.runQuery(
      internal.agents.installations.isAgentLiveInternal,
      { organizationId: args.organizationId, agentSlug: role.managerSlug },
    );
    if (!managerLive) return await unassign('MANAGER_NOT_LIVE');

    const verdict = await ctx.runQuery(
      internal.agents.guardrails.budget_guard.checkAgentRunAllowed,
      {
        organizationId: args.organizationId,
        agentSlug: role.managerSlug,
        context: 'task_run',
        taskId: args.taskId,
        budget: manager.agentConfig.budget,
        maxConcurrentTasks: manager.agentConfig.maxConcurrentTasks,
      },
    );
    if (!verdict.allowed) return await unassign(verdict.reason);

    await ctx.runMutation(internal.tasks.internal_mutations.agentAssignTask, {
      organizationId: args.organizationId,
      actorId: WORKFLOW_ACTOR_ID,
      taskId: args.taskId,
      assigneeType: 'agent',
      assigneeId: role.managerSlug,
    });
    return { action: 'reassigned', managerSlug: role.managerSlug };
  },
});
