/**
 * Agent workflow action — lets automations run an ORG AGENT (by slug)
 * against a task. This is the missing engine capability the task-ops pack
 * is built on: the generic `llm` step runs inline prompts, but cannot
 * reference a configured agent.
 *
 * Operations:
 *  - `run_on_task`: execute the agent against the task via
 *    `agents/run_agent_on_task` (node). NEVER throws on agent failure —
 *    the result rides `output.data` (`{ok, text?, error?, refusedReason?}`)
 *    so the workflow's condition steps own the failure branches (the engine
 *    has no try/catch port).
 *  - `run_on_discussion`: reply as the agent inside a project discussion via
 *    `agents/run_agent_on_discussion` (node) — the discussion analog of
 *    `run_on_task`, backing the `react-to-discussion-mention` /
 *    `triage-new-discussion` packs. Same never-throw contract.
 *  - `decompose_task`: manager mode — split an epic into subtasks assigned
 *    to the agent's direct reports (restricted toolset, depth = 1 enforced
 *    server-side). Returns `{ok, subtasksCreated, ...}`.
 *  - `check_run_budget`: read-only circuit-breaker state for a (task, agent)
 *    pair — the pack's loop guard for mention chains and re-triggers.
 *  - `get_org_role`: compatibility shim for the retired org-chart layer —
 *    always resolves to a chartless root (never a manager).
 *  - `list_task_candidates`: assignable agents for a task under the
 *    project's gates — input to the triage scoring step.
 *  - `reassign_or_unassign`: budget-pause handling — unassign the task for
 *    triage to pick up (the manager hand-off retired with the org chart).
 *
 * `organizationId` comes from workflow context variables (like
 * `task_action.ts`); the dispatching execution id arrives via `extras` and
 * is recorded on the run row for the task↔execution trace.
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

type AgentActionParams =
  | {
      operation: 'run_on_task';
      agentSlug: string;
      taskId: string;
      trigger:
        | 'assignment'
        | 'mention'
        | 'revision'
        | 'sla_escalation'
        | 'unblock'
        | 'decomposition'
        | 'manual';
      instructions: string;
      promptContext?: string;
      maxSteps?: number;
      timeoutMs?: number;
    }
  | {
      operation: 'run_on_discussion';
      agentSlug: string;
      threadId: string;
      instructions: string;
      promptContext?: string;
      maxSteps?: number;
      timeoutMs?: number;
    }
  | {
      operation: 'decompose_task';
      agentSlug: string;
      taskId: string;
      instructions?: string;
      maxSubtasks?: number;
      timeoutMs?: number;
    }
  | {
      operation: 'check_run_budget';
      agentSlug: string;
      taskId: string;
    }
  | {
      operation: 'get_org_role';
      agentSlug: string;
    }
  | {
      operation: 'list_task_candidates';
      taskId: string;
    }
  | {
      operation: 'reassign_or_unassign';
      taskId: string;
      agentSlug: string;
      mode?: 'reassign_to_manager' | 'unassign';
    }
  | {
      operation: 'requeue_queued_runs';
      olderThanMinutes?: number;
      limit?: number;
    };

const triggerValidator = v.union(
  v.literal('assignment'),
  v.literal('mention'),
  v.literal('revision'),
  v.literal('sla_escalation'),
  v.literal('unblock'),
  v.literal('decomposition'),
  v.literal('manual'),
);

const DEFAULT_DECOMPOSE_INSTRUCTIONS =
  'This task is too large for a single run. Decompose it into concrete subtasks and delegate each to the most suitable member of your team, following the working agreement below.';

export const agentAction: ActionDefinition<AgentActionParams> = {
  type: 'agent',
  title: 'Agent Operation',
  description:
    'Task operations on org agents: run_on_task / run_on_discussion / decompose_task (never throw — {ok, error, refusedReason} rides output.data for condition branches), check_run_budget, get_org_role, list_task_candidates, reassign_or_unassign, requeue_queued_runs. organizationId is read from workflow context variables. (Roster admin — install/enable/disable — is intentionally NOT here: it is privilege-gated and lives in the agent_write tool, the catalog mutations, and the integration cascade.)',
  parametersValidator: v.union(
    v.object({
      operation: v.literal('run_on_task'),
      agentSlug: v.string(),
      taskId: v.id('tasks'),
      trigger: triggerValidator,
      instructions: v.string(),
      promptContext: v.optional(v.string()),
      maxSteps: v.optional(v.number()),
      timeoutMs: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('run_on_discussion'),
      agentSlug: v.string(),
      threadId: v.string(),
      instructions: v.string(),
      promptContext: v.optional(v.string()),
      maxSteps: v.optional(v.number()),
      timeoutMs: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('decompose_task'),
      agentSlug: v.string(),
      taskId: v.id('tasks'),
      instructions: v.optional(v.string()),
      maxSubtasks: v.optional(v.number()),
      timeoutMs: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('check_run_budget'),
      agentSlug: v.string(),
      taskId: v.id('tasks'),
    }),
    v.object({
      operation: v.literal('get_org_role'),
      agentSlug: v.string(),
    }),
    v.object({
      operation: v.literal('list_task_candidates'),
      taskId: v.id('tasks'),
    }),
    v.object({
      operation: v.literal('reassign_or_unassign'),
      taskId: v.id('tasks'),
      agentSlug: v.string(),
      mode: v.optional(
        v.union(v.literal('reassign_to_manager'), v.literal('unassign')),
      ),
    }),
    v.object({
      operation: v.literal('requeue_queued_runs'),
      olderThanMinutes: v.optional(v.number()),
      limit: v.optional(v.number()),
    }),
  ),
  async execute(ctx, params, variables, extras) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'agent action requires a string organizationId in workflow context',
      );
    }
    const workflowSlug =
      typeof variables.wfDefinitionId === 'string'
        ? variables.wfDefinitionId
        : undefined;

    switch (params.operation) {
      case 'run_on_task': {
        // Opt-in durable path: an agent flagged `preferDurableStepForTasks`
        // runs its task as a DURABLE sandbox step (container) that spans the
        // action ceiling via the 'running' re-entry, instead of the inline LLM
        // loop. Requires a workflow execution context (the deterministic
        // checkpoint session is keyed by executionId+stepSlug); without it, or
        // when the agent isn't flagged, fall through to the inline path.
        if (
          extras?.executionId !== undefined &&
          extras?.stepSlug !== undefined
        ) {
          const plan = await ctx.runAction(
            internal.agents.run_agent_on_task.resolveDurableTaskRunPlan,
            {
              organizationId,
              agentSlug: params.agentSlug,
              taskId: toId<'tasks'>(params.taskId),
              trigger: params.trigger,
              instructions: params.instructions,
              ...(params.promptContext !== undefined && {
                promptContext: params.promptContext,
              }),
            },
          );
          if (plan.durable) {
            // Run the durable segment DIRECTLY from here so the long runAction
            // is a V8→node hop (the proven-safe sandbox-step depth), never
            // node→node (which would brush the ~5-min inter-node RPC cap).
            const sandbox = await ctx.runAction(
              internal.node_only.sandbox.workflow_sandbox_exec.runSandboxAgent,
              {
                organizationId,
                executionId: extras.executionId,
                stepSlug: extras.stepSlug,
                agentSlug: params.agentSlug,
                taskId: toId<'tasks'>(params.taskId),
                wfExecutionId: toId<'wfExecutions'>(extras.executionId),
                ...(workflowSlug !== undefined && { workflowSlug }),
                trigger: params.trigger,
                instructions: plan.prompt,
                budget: plan.budget,
                inputs: [],
              },
            );
            return {
              operation: 'run_on_task',
              ok: sandbox.ok,
              // 'running' rides through so executeActionNode maps it to the
              // 'running' port → the engine re-enters this step (next segment).
              status: sandbox.status,
              external: false,
              // Admitted-run marker: packs branch `check_admitted` on it —
              // admitted-but-failed explains + rolls back; refused stays quiet.
              ...(sandbox.runId !== undefined && { runId: sandbox.runId }),
              ...(sandbox.summary !== undefined && {
                text: sandbox.summary,
                // The operator stream panel headlines `summary` (the same field
                // a sandbox STEP persists) — `text` stays for workflow
                // templates that already consume it.
                summary: sandbox.summary,
              }),
              ...(sandbox.error !== undefined && { error: sandbox.error }),
              ...(sandbox.refusedReason !== undefined && {
                refusedReason: sandbox.refusedReason,
              }),
            };
          }
        }
        const result = await ctx.runAction(
          internal.agents.run_agent_on_task.runAgentOnTask,
          {
            organizationId,
            agentSlug: params.agentSlug,
            taskId: toId<'tasks'>(params.taskId),
            trigger: params.trigger,
            instructions: params.instructions,
            promptContext: params.promptContext,
            maxSteps: params.maxSteps,
            timeoutMs: params.timeoutMs,
            wfExecutionId: extras?.executionId,
            workflowSlug,
          },
        );
        return { operation: 'run_on_task', ...result };
      }

      case 'run_on_discussion': {
        const result = await ctx.runAction(
          internal.agents.run_agent_on_discussion.runAgentOnDiscussion,
          {
            organizationId,
            agentSlug: params.agentSlug,
            threadId: params.threadId,
            instructions: params.instructions,
            promptContext: params.promptContext,
            maxSteps: params.maxSteps,
            timeoutMs: params.timeoutMs,
            wfExecutionId: extras?.executionId,
            workflowSlug,
          },
        );
        return { operation: 'run_on_discussion', ...result };
      }

      case 'decompose_task': {
        const result = await ctx.runAction(
          internal.agents.run_agent_on_task.runAgentOnTask,
          {
            organizationId,
            agentSlug: params.agentSlug,
            taskId: toId<'tasks'>(params.taskId),
            trigger: 'decomposition',
            mode: 'decompose',
            instructions: params.instructions ?? DEFAULT_DECOMPOSE_INSTRUCTIONS,
            maxSubtasks: params.maxSubtasks,
            timeoutMs: params.timeoutMs,
            wfExecutionId: extras?.executionId,
            workflowSlug,
          },
        );
        return { operation: 'decompose_task', ...result };
      }

      case 'check_run_budget': {
        const result = await ctx.runQuery(
          internal.agents.guardrails.budget_guard.resolveTaskRunBudget,
          {
            taskId: toId<'tasks'>(params.taskId),
            agentSlug: params.agentSlug,
          },
        );
        return { operation: 'check_run_budget', ...result };
      }

      case 'get_org_role': {
        const result = await ctx.runAction(
          internal.agents.task_ops.getOrgRole,
          { organizationId, agentSlug: params.agentSlug },
        );
        return { operation: 'get_org_role', ...result };
      }

      case 'list_task_candidates': {
        const result = await ctx.runAction(
          internal.agents.task_ops.listTaskCandidates,
          { organizationId, taskId: toId<'tasks'>(params.taskId) },
        );
        return { operation: 'list_task_candidates', ...result };
      }

      case 'reassign_or_unassign': {
        const result = await ctx.runAction(
          internal.agents.task_ops.reassignOrUnassign,
          {
            organizationId,
            taskId: toId<'tasks'>(params.taskId),
            agentSlug: params.agentSlug,
            mode: params.mode,
          },
        );
        return { operation: 'reassign_or_unassign', ...result };
      }

      case 'requeue_queued_runs': {
        const result = await ctx.runMutation(
          internal.agents.guardrails.internal_mutations
            .requeueStaleQueuedNotices,
          {
            organizationId,
            olderThanMinutes: params.olderThanMinutes,
            limit: params.limit,
          },
        );
        return { operation: 'requeue_queued_runs', ...result };
      }

      default: {
        // Exhaustiveness: a new operation without a case fails to compile.
        const unhandled: never = params;
        throw new Error(
          `Unsupported agent operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
