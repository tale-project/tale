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
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import { RESERVED_AGENT_SLUGS } from '../../lib/shared/constants/agents';
import { agentWorkforceConfigSchema } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { type ActionCtx, internalAction } from '../_generated/server';
import { loadDelegateAgents } from '../agent_tools/delegation/load_delegation_agents';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
} from '../lib/file_io';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_HISTORY_ENTRIES,
  parseAgentJson,
  resolveAgentFilePath,
  resolveHistoryDir,
  serializeAgentJson,
  type AgentJsonConfig,
} from './file_utils';
import { DEFAULT_AGENT_WORKFORCE } from './guardrails/budget_guard';
import { invalidateAgentListCache } from './internal_actions';
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

/**
 * Direct reports of one agent off the cached roster — the runtime source
 * of an agent's delegates (the org chart is the single delegation
 * authority). Returns [] for unknown slugs and chartless orgs.
 */
export async function listDirectReports(
  orgSlug: string,
  agentSlug: string | undefined,
): Promise<string[]> {
  if (!agentSlug) return [];
  const roster = await readWorkforceRoster(orgSlug);
  return buildChartFromRoster(roster).reports.get(agentSlug) ?? [];
}

/**
 * The agent's manager (off the post-build forest, so dangling edges and
 * cycles are already resolved), or undefined for roots / unknown slugs.
 */
export async function lookupManagerSlug(
  orgSlug: string,
  agentSlug: string | undefined,
): Promise<string | undefined> {
  if (!agentSlug) return undefined;
  const roster = await readWorkforceRoster(orgSlug);
  return buildChartFromRoster(roster).parents.get(agentSlug);
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
    const roster = await readWorkforceRoster(orgSlug);
    const chart = buildChartFromRoster(roster);

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

// ---------------------------------------------------------------------------
// Delegation-edge writers (shared by the organigram UI actions and the
// organigram_write agent tool — validation lives HERE so every writer gets it).
//
// The graph is a many-to-many DELEGATION graph stored as each agent's
// `delegates` array (the agents it delegates to). There is no limitation
// beyond a forbidden self-edge; cycles are allowed.
// ---------------------------------------------------------------------------

/**
 * Snapshot an agent file's CURRENT content into its version-history dir
 * before a delegation write mutates it — the same snapshot-then-write
 * contract `saveAgent`/`snapshotToHistory` (file_actions) give every other
 * agent edit, so organigram changes show up in (and restore from) the agent
 * History dropdown like any config edit. No-op when the file doesn't exist.
 */
async function snapshotAgentHistory(
  orgSlug: string,
  agentSlug: string,
): Promise<void> {
  const filePath = resolveAgentFilePath(orgSlug, agentSlug);
  const currentContent = await readFileSafe(filePath);
  if (!currentContent) return;
  const historyDir = resolveHistoryDir(orgSlug, agentSlug);
  await mkdir(historyDir, { recursive: true });
  const timestamp = generateHistoryTimestamp();
  await atomicWrite(path.join(historyDir, `${timestamp}.json`), currentContent);
  await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
}

async function readAgentConfig(filePath: string): Promise<AgentJsonConfig> {
  const file = await readJsonFile<AgentJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseAgentJson,
  );
  if (!file.ok) {
    throw new ConvexError({ code: 'AGENT_NOT_FOUND' });
  }
  return file.data;
}

/**
 * Validate a target list: no self-edge (SELF_EDGE), every slug a real,
 * non-reserved agent (INVALID_TARGET). Deduped, original order preserved.
 */
function sanitizeTargets(
  targets: string[],
  selfSlug: string,
  slugs: Set<string>,
): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (target === selfSlug) throw new ConvexError({ code: 'SELF_EDGE' });
    if (!slugs.has(target) || RESERVED.has(target)) {
      throw new ConvexError({ code: 'INVALID_TARGET' });
    }
    if (seen.has(target)) continue;
    seen.add(target);
    cleaned.push(target);
  }
  return cleaned;
}

/**
 * Set the agents that `agentSlug` delegates to (its outgoing edges / direct
 * reports). Throws RESERVED_AGENT_SLUG, AGENT_NOT_FOUND, SELF_EDGE,
 * INVALID_TARGET. Returns the previous delegate list.
 */
export async function writeAgentDelegates(args: {
  orgSlug: string;
  agentSlug: string;
  delegateSlugs: string[];
}): Promise<{ previous: string[] }> {
  const { orgSlug, agentSlug } = args;
  if (RESERVED.has(agentSlug)) {
    throw new ConvexError({ code: 'RESERVED_AGENT_SLUG' });
  }
  const roster = await readWorkforceRoster(orgSlug);
  const slugs = new Set(roster.map((entry) => entry.slug));
  if (!slugs.has(agentSlug)) {
    throw new ConvexError({ code: 'AGENT_NOT_FOUND' });
  }
  const next = sanitizeTargets(args.delegateSlugs, agentSlug, slugs);

  const filePath = resolveAgentFilePath(orgSlug, agentSlug);
  const config = await readAgentConfig(filePath);
  const previous = config.delegates ?? [];
  if (next.length > 0) config.delegates = next;
  else delete config.delegates;
  await snapshotAgentHistory(orgSlug, agentSlug);
  await atomicWrite(filePath, serializeAgentJson(config));

  invalidateAgentListCache(orgSlug);
  return { previous };
}

/**
 * Set the agents that delegate to `agentSlug` (its incoming edges / the
 * "reports to" list). Adjusts each candidate parent's `delegates` to match.
 * Throws the same codes as {@link writeAgentDelegates}. Returns the previous
 * parent list.
 */
export async function writeAgentParents(args: {
  orgSlug: string;
  agentSlug: string;
  parentSlugs: string[];
}): Promise<{ previous: string[] }> {
  const { orgSlug, agentSlug } = args;
  if (RESERVED.has(agentSlug)) {
    throw new ConvexError({ code: 'RESERVED_AGENT_SLUG' });
  }
  const roster = await readWorkforceRoster(orgSlug);
  const slugs = new Set(roster.map((entry) => entry.slug));
  if (!slugs.has(agentSlug)) {
    throw new ConvexError({ code: 'AGENT_NOT_FOUND' });
  }
  const desired = new Set(sanitizeTargets(args.parentSlugs, agentSlug, slugs));
  const previous = buildChartFromRoster(roster).parentsAll.get(agentSlug) ?? [];

  for (const entry of roster) {
    if (entry.slug === agentSlug) continue;
    const has = entry.delegates.includes(agentSlug);
    const should = desired.has(entry.slug);
    if (has === should) continue;
    const filePath = resolveAgentFilePath(orgSlug, entry.slug);
    const config = await readAgentConfig(filePath).catch(() => null);
    if (!config) continue;
    const updated = should
      ? [...new Set([...(config.delegates ?? []), agentSlug])]
      : (config.delegates ?? []).filter((slug) => slug !== agentSlug);
    if (updated.length > 0) config.delegates = updated;
    else delete config.delegates;
    await snapshotAgentHistory(orgSlug, entry.slug);
    await atomicWrite(filePath, serializeAgentJson(config));
  }

  invalidateAgentListCache(orgSlug);
  return { previous };
}

// ---------------------------------------------------------------------------
// Agent-tool surface (consumed by the `organigram_read` / `organigram_write`
// agent tools)
// ---------------------------------------------------------------------------

/** Compact chart snapshot for an agent's context window. */
export const getChartOverview = internalAction({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{
    nodes: Array<{
      slug: string;
      description?: string;
      delegates: string[];
      reportsTo: string[];
    }>;
  }> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const roster = await readWorkforceRoster(orgSlug);
    const chart = buildChartFromRoster(roster);
    return {
      nodes: roster
        .map((entry) => ({
          slug: entry.slug,
          description: entry.description?.slice(0, 160),
          delegates: chart.reports.get(entry.slug) ?? [],
          reportsTo: chart.parentsAll.get(entry.slug) ?? [],
        }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    };
  },
});

/**
 * Set the agents one agent delegates to, on behalf of an agent tool call.
 * Same validation + single write path as the canvas
 * (`writeAgentDelegates`, including the pre-write history snapshot),
 * audited with the CHAT USER as the actor.
 */
export const setDelegatesFromAgent = internalAction({
  args: {
    organizationId: v.string(),
    actorUserId: v.string(),
    agentSlug: v.string(),
    delegateSlugs: v.array(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    code: v.optional(v.string()),
    previous: v.optional(v.array(v.string())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; code?: string; previous?: string[] }> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    try {
      const { previous } = await writeAgentDelegates({
        orgSlug,
        agentSlug: args.agentSlug,
        delegateSlugs: args.delegateSlugs,
      });
      await ctx.runMutation(
        internal.agents.audit_mutations.logAgentAuditEvent,
        {
          organizationId: args.organizationId,
          actorId: args.actorUserId,
          actorRole: 'assistant',
          action: 'set_agent_delegates',
          resourceId: args.agentSlug,
          previousState: { delegates: previous },
          newState: { delegates: args.delegateSlugs },
        },
      );
      return { ok: true, previous };
    } catch (error) {
      if (error instanceof ConvexError) {
        const data: unknown = error.data;
        const code =
          isRecord(data) && typeof data.code === 'string'
            ? data.code
            : 'UNKNOWN';
        return { ok: false, code };
      }
      throw error;
    }
  },
});
