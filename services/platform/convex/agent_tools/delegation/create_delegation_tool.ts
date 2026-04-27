/**
 * Delegation Tool Factory
 *
 * Dynamically creates delegation tools for delegate agents at runtime.
 * This generalizes the old hardcoded sub-agent tools (crm_assistant,
 * file_assistant, etc.) into a single factory that works with any agent.
 *
 * Each generated tool:
 * 1. Validates context (orgId, threadId, userId)
 * 2. Checks time budget
 * 3. Optionally checks role access
 * 4. Gets/creates a sub-thread keyed by delegate agentSlug
 * 5. Runs the delegate agent via the generic runAgentGeneration action
 * 6. Returns a structured ToolResponse
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { narrowBcp47 } from '../../../lib/shared/utils/narrow-bcp47';
import { internal } from '../../_generated/api';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
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

        const budget = checkBudget(ctx);
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

        try {
          const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
            ctx,
            {
              parentThreadId: threadId,
              subAgentType: delegate.agentSlug,
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
              agentConfig: delegate.agentConfig,
              model: delegate.model,
              provider: delegate.provider,
              debugTag: `[Delegate:${delegate.displayName}]`,
              enableStreaming: false,
              threadId: subThreadId,
              organizationId,
              userId,
              promptMessage: args.userRequest,
              parentThreadId: threadId,
              deadlineMs: budget.deadlineMs,
              maxSteps: delegate.agentConfig.maxSteps,
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
 * Localized scaffold text wrapping the delegate list. The locale is the
 * org's `defaultLocale`; unknown locales fall through to English.
 */
const DELEGATION_SCAFFOLD: Record<
  string,
  { header: string; intro: string; outro: string }
> = {
  en: {
    header: 'DELEGATION AGENTS',
    intro: 'You can delegate tasks to these specialized agents:',
    outro:
      "Call the appropriate delegation tool with the user's request. Preserve the user's full intent.",
  },
  de: {
    header: 'DELEGATIONS-AGENTEN',
    intro: 'Du kannst Aufgaben an diese spezialisierten Agenten delegieren:',
    outro:
      'Rufe das passende Delegations-Werkzeug mit der Anfrage des Nutzers auf. Bewahre die volle Absicht des Nutzers.',
  },
  fr: {
    header: 'AGENTS DE DÉLÉGATION',
    intro: 'Vous pouvez déléguer des tâches à ces agents spécialisés :',
    outro:
      "Appelez l'outil de délégation approprié avec la requête de l'utilisateur. Préservez l'intention complète de l'utilisateur.",
  },
};

/**
 * Build a section to append to an agent's system instructions
 * describing its available delegate agents.
 */
export function buildDelegationInstructionsSection(
  delegates: DelegateAgentMeta[],
  locale?: string,
): string {
  if (delegates.length === 0) return '';

  // Same narrowing rule as resolveAgentLocale: direct → narrowed base → en.
  // Keeps the scaffold header/intro/outro in lockstep with the delegate
  // chrome text when the org locale is a region-qualified BCP-47 tag
  // (e.g. fr-CH falls back to fr, not directly to English).
  const base = narrowBcp47(locale);
  const scaffold =
    (locale ? DELEGATION_SCAFFOLD[locale] : undefined) ??
    (base ? DELEGATION_SCAFFOLD[base] : undefined) ??
    DELEGATION_SCAFFOLD.en;

  const delegateLines = delegates
    .map((d) => `- **delegate_${d.name}**: ${d.displayName} — ${d.description}`)
    .join('\n');

  return `\n\n====================
${scaffold.header}
====================

${scaffold.intro}
${delegateLines}

${scaffold.outro}`;
}
