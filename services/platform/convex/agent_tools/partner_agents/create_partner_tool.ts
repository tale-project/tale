/**
 * Partner Agent Delegation Tool Factory
 *
 * Dynamically creates delegation tools for partner agents at runtime.
 * This generalizes the old hardcoded sub-agent tools (crm_assistant,
 * document_assistant, etc.) into a single factory that works with any agent.
 *
 * Each generated tool:
 * 1. Validates context (orgId, threadId, userId)
 * 2. Checks time budget
 * 3. Optionally checks role access
 * 4. Gets/creates a sub-thread keyed by partner rootVersionId
 * 5. Runs the partner agent via the generic runAgentGeneration action
 * 6. Returns a structured ToolResponse
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { SerializableAgentConfig } from '../../lib/agent_chat/types';

import { internal } from '../../_generated/api';
import { checkBudget } from '../sub_agents/helpers/check_budget';
import { checkRoleAccess } from '../sub_agents/helpers/check_role_access';
import { getOrCreateSubThread } from '../sub_agents/helpers/get_or_create_sub_thread';
import {
  errorResponse,
  handleToolError,
  successResponse,
  type ToolResponse,
} from '../sub_agents/helpers/tool_response';
import { validateToolContext } from '../sub_agents/helpers/validate_context';

export interface PartnerAgentMeta {
  rootVersionId: string;
  name: string;
  displayName: string;
  description: string;
  agentConfig: SerializableAgentConfig;
  model: string;
  provider: string;
  roleRestriction?: string;
}

export function createPartnerDelegationTool(partner: PartnerAgentMeta) {
  const toolName = `partner_${partner.name}`;

  return {
    name: toolName,
    tool: createTool({
      description: `Delegate tasks to the ${partner.displayName} agent.

${partner.description}

Pass the user's request in natural language. The partner agent will handle it and return results.`,

      args: z.object({
        userRequest: z
          .string()
          .describe(
            "The user's request to delegate, in natural language. Preserve the user's full intent.",
          ),
      }),

      handler: async (ctx: ToolCtx, args): Promise<ToolResponse> => {
        const validation = validateToolContext(ctx, toolName);
        if (!validation.valid) return validation.error;

        const budget = checkBudget(ctx);
        if (!budget.ok) return budget.error;

        const { organizationId, threadId, userId } = validation.context;

        if (partner.roleRestriction === 'admin_developer' && userId) {
          const roleCheck = await checkRoleAccess(
            ctx,
            userId,
            organizationId,
            toolName,
          );
          if (!roleCheck.allowed)
            return roleCheck.error ?? errorResponse('Access denied');
        }

        try {
          const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
            ctx,
            {
              parentThreadId: threadId,
              subAgentType: partner.rootVersionId,
              userId,
            },
          );

          console.log(
            `[${toolName}] Sub-thread:`,
            subThreadId,
            isNew ? '(new)' : '(reused)',
          );

          const result = await ctx.runAction(
            internal.lib.agent_chat.internal_actions.runAgentGeneration,
            {
              agentType: 'custom',
              agentConfig: partner.agentConfig,
              model: partner.model,
              provider: partner.provider,
              debugTag: `[Partner:${partner.displayName}]`,
              enableStreaming: false,
              threadId: subThreadId,
              organizationId,
              userId,
              promptMessage: args.userRequest,
              parentThreadId: threadId,
              deadlineMs: budget.deadlineMs,
              maxSteps: partner.agentConfig.maxSteps,
            },
          );

          return successResponse(
            result.text,
            {
              ...result.usage,
              durationSeconds:
                result.durationMs !== undefined
                  ? result.durationMs / 1000
                  : undefined,
            },
            result.model,
            result.provider,
            undefined,
            args.userRequest,
          );
        } catch (error) {
          return handleToolError(toolName, error);
        }
      },
    }),
  };
}

/**
 * Build a section to append to an agent's system instructions
 * describing its available partner agents.
 */
export function buildPartnerInstructionsSection(
  partners: PartnerAgentMeta[],
): string {
  if (partners.length === 0) return '';

  const partnerLines = partners
    .map((p) => `- **partner_${p.name}**: ${p.displayName} — ${p.description}`)
    .join('\n');

  return `\n\n====================
PARTNER AGENTS
====================

You can delegate tasks to these specialized agents:
${partnerLines}

Call the appropriate partner agent tool with the user's request. Preserve the user's full intent.`;
}
