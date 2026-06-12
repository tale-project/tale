/**
 * The `escalate` tool — the upward edge of the agent org chart, auto-injected
 * for chart members at tool-build time (see `buildDelegationTools`). What it
 * does depends on where the agent is running and where it sits in the chart:
 *
 *  TASK context (a `taskId` rides the ToolCtx — task-ops runs):
 *   - with a manager: posts an agent-authored `@manager [escalation]` comment.
 *     The mention-response workflow turns that into a manager run under the
 *     MANAGER's own guardrails — every escalation chain stays budget-gated.
 *   - root agent (or the manager isn't mentionable in this project): the
 *     comment is posted without a triggering mention and org admins get an
 *     `agent_escalation` inbox notification — the chain terminates at humans.
 *
 *  CHAT context:
 *   - with a manager: runs the manager synchronously as a sub-agent
 *     (`runDelegateStep`, same budget/deadline guards as delegation) and
 *     returns its direction.
 *   - root agent: instructs the model to raise the matter with the human in
 *     the conversation — the human IS present in chat.
 *
 * Every path records the `agent.escalated` activity (task context) so the
 * metrics layer can count intervention rates.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { DelegateAgentMeta } from '../delegation/create_delegation_tool';
import { runDelegateStep } from '../delegation/run_delegate_step';
import { checkTimeBudget } from '../sub_agents/helpers/check_budget';
import { validateToolContext } from '../sub_agents/helpers/validate_context';
import type { ToolDefinition } from '../types';

const escalateArgs = z.object({
  reason: z
    .string()
    .min(1)
    .describe(
      'Why you are escalating: the decision, blocker, or missing capability — one or two sentences.',
    ),
  blockers: z
    .string()
    .optional()
    .describe('What concretely blocks you (errors, missing access, …).'),
  requestedAction: z
    .string()
    .optional()
    .describe('What you need from your manager / the humans.'),
});

export interface EscalationToolMeta {
  agentSlug: string;
  /** Resolved from the org chart at tool-build time; undefined for roots. */
  managerSlug?: string;
  /**
   * The manager's config, pre-loaded by `buildDelegationTools` in its Node
   * context and passed in — mirrors how `createDelegationTool` receives its
   * delegate. Undefined for roots or when the manager file failed to load.
   * Keeping the load upstream is what lets this builder stay in Convex's V8
   * runtime; a `node:fs` import here would drag Node into the V8 bundle.
   */
  manager?: DelegateAgentMeta;
  organizationId: string;
}

function readCtxString(ctx: ToolCtx, key: string): string | undefined {
  const value: unknown = Reflect.get(ctx, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function composeReason(args: z.infer<typeof escalateArgs>): string {
  const parts = [args.reason.trim()];
  if (args.blockers?.trim()) parts.push(`Blocked by: ${args.blockers.trim()}`);
  if (args.requestedAction?.trim()) {
    parts.push(`Requested: ${args.requestedAction.trim()}`);
  }
  return parts.join(' — ');
}

export function createEscalationTool(meta: EscalationToolMeta): ToolDefinition {
  const target = meta.managerSlug
    ? `your manager (${meta.managerSlug})`
    : 'the humans of this organization';
  return {
    name: 'escalate',
    tool: createTool({
      description: `Escalate to ${target} when you are blocked, lack a needed permission or capability, or face a decision above your authority. State the reason, what blocks you, and what you need. Do NOT escalate work you can do yourself.`,
      inputSchema: escalateArgs,
      execute: async (ctx: ToolCtx, args) => {
        const reason = composeReason(args);
        const taskId = readCtxString(ctx, 'taskId');

        // --- Task context: comment-based escalation ---------------------
        if (taskId) {
          const result = await ctx.runMutation(
            internal.tasks.internal_mutations.agentEscalateOnTask,
            {
              organizationId: meta.organizationId,
              actorId: meta.agentSlug,
              taskId: toId<'tasks'>(taskId),
              managerSlug: meta.managerSlug,
              reason,
            },
          );
          if (!result.ok) {
            return { escalated: false, error: 'TASK_NOT_FOUND' };
          }
          // No manager, or the @mention didn't resolve in this project's
          // directory → make sure HUMANS hear about it.
          if (!result.mentionResolved) {
            await ctx.runMutation(
              internal.collab.internal_mutations.notifyFromAutomation,
              {
                organizationId: meta.organizationId,
                audience: 'org_admins',
                type: 'agent_escalation',
                titleKey: 'agentEscalation',
                bodyKey: 'agentEscalationBody',
                params: {
                  agent: meta.agentSlug,
                  reason: reason.slice(0, 300),
                },
                taskId: toId<'tasks'>(taskId),
              },
            );
            return {
              escalated: true,
              to: 'humans',
              note: 'Escalation recorded on the task and surfaced to the organization admins. Wrap up what you can and state clearly what remains blocked.',
            };
          }
          return {
            escalated: true,
            to: meta.managerSlug,
            note: `Escalation posted — ${meta.managerSlug} will pick it up on this task. Wrap up what you can in the meantime.`,
          };
        }

        // --- Chat context: synchronous manager consult ------------------
        if (meta.managerSlug) {
          const validation = validateToolContext(ctx, 'escalate');
          if (!validation.valid) return validation.error;
          const budget = checkTimeBudget(ctx);
          if (!budget.ok) return budget.error;
          const { organizationId, threadId, userId } = validation.context;

          const manager = meta.manager;
          if (!manager) {
            return {
              escalated: false,
              note: `Your manager (${meta.managerSlug}) could not be loaded. Raise the matter directly with the user.`,
            };
          }
          return runDelegateStep(
            ctx,
            {
              parentThreadId: threadId,
              organizationId,
              userId,
              delegate: manager,
              prompt: `Your direct report ${meta.agentSlug} escalated to you mid-conversation:\n\n${reason}\n\nDecide as their manager: give concrete direction, take the decision yourself, or say precisely what is needed before work can continue.`,
              deadlineMs: budget.deadlineMs,
              streamSubAgent: true,
            },
            '[escalate]',
          );
        }

        // Chat context, root agent: the human is right there.
        return {
          escalated: false,
          to: 'user',
          note: 'You report to the humans of this organization and the user is present in this conversation — state the blocker and what you need directly in your reply.',
        };
      },
    }),
  };
}
