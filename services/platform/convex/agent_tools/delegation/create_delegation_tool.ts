/**
 * Builds a delegation tool for an arbitrary delegate agent at runtime, so any
 * agent config can be exposed as a `delegate_*` tool without a hardcoded
 * per-agent implementation.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import { renderPrompt } from '../../lib/prompts/registry';
import { checkTimeBudget } from '../sub_agents/helpers/check_budget';
import { checkRoleAccess } from '../sub_agents/helpers/check_role_access';
import {
  errorResponse,
  type ToolResponse,
} from '../sub_agents/helpers/tool_response';
import { validateToolContext } from '../sub_agents/helpers/validate_context';
import { runDelegateStep } from './run_delegate_step';

export interface DelegateAgentMeta {
  agentSlug: string;
  name: string;
  displayName: string;
  description: string;
  agentConfig: SerializableAgentConfig;
  model: string;
  provider?: string;
  roleRestriction?: 'admin_developer';
}

export function createDelegationTool(delegate: DelegateAgentMeta) {
  const toolName = `delegate_${delegate.name}`;

  return {
    name: toolName,
    tool: createTool({
      description: `Delegate tasks to the ${delegate.displayName} agent.

${delegate.description}

Pass the user's request in natural language. The agent will handle it and return results.`,

      inputSchema: z.object({
        userRequest: z
          .string()
          .describe(
            "The user's request to delegate, in natural language. Preserve the user's full intent.",
          ),
      }),

      execute: async (ctx: ToolCtx, args): Promise<ToolResponse> => {
        const validation = validateToolContext(ctx, toolName);
        if (!validation.valid) return validation.error;

        const budget = checkTimeBudget(ctx);
        if (!budget.ok) return budget.error;

        const { organizationId, threadId, userId } = validation.context;

        if (delegate.roleRestriction === 'admin_developer' && userId) {
          const roleCheck = await checkRoleAccess(
            ctx,
            userId,
            organizationId,
            toolName,
          );
          if (!roleCheck.allowed)
            return roleCheck.error ?? errorResponse('Access denied');
        }

        // Shared executor: sub-thread reuse + generation + ToolResponse. The
        // same path the router orchestrator uses (execute_plan.ts).
        return runDelegateStep(
          ctx,
          {
            parentThreadId: threadId,
            organizationId,
            userId,
            delegate,
            prompt: args.userRequest,
            deadlineMs: budget.deadlineMs,
            // Interactive delegation: stream the sub-agent's steps so the user
            // sees a live nested timeline under this tool row.
            streamSubAgent: true,
          },
          `[${toolName}]`,
        );
      },
    }),
  };
}

/**
 * Build a section to append to an agent's system instructions
 * describing its available delegate agents.
 *
 * The localized scaffold (header/intro/outro) lives in the prompt registry
 * (`delegation.*`). `renderPrompt` applies the same locale fallback the org
 * uses elsewhere: direct → narrowed base (e.g. de-CH → de) → en.
 */
export function buildDelegationInstructionsSection(
  delegates: DelegateAgentMeta[],
  locale?: string,
): string {
  if (delegates.length === 0) return '';

  const header = renderPrompt('delegation.header', {}, { locale });
  const intro = renderPrompt('delegation.intro', {}, { locale });
  const outro = renderPrompt('delegation.outro', {}, { locale });

  const delegateLines = delegates
    .map((d) => `- **delegate_${d.name}**: ${d.displayName} — ${d.description}`)
    .join('\n');

  return `\n\n====================
${header}
====================

${intro}
${delegateLines}

${outro}`;
}
