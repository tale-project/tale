'use node';

/**
 * Chat Agent Hooks - Convex Actions
 *
 * These hooks are encapsulated as Convex actions so they can be passed
 * via FunctionHandle to the generic agent action.
 *
 * Hooks:
 * - beforeContextHook: Load integrations
 * - beforeGenerateHook: Process attachments and check context budget
 * - onErrorHook: Log error details
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { getListIntegrationsInternalRef } from '../../lib/function_refs';
import { processAttachments } from '../../lib/attachments/index';
import {
  estimateTokens,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  CONTEXT_SAFETY_MARGIN,
  SYSTEM_INSTRUCTIONS_TOKENS,
  OUTPUT_RESERVE,
} from '../../lib/context_management';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_ROUTING_AGENT', '[RoutingAgent]');

/**
 * Before context hook: Load integrations.
 */
export const beforeContextHook = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    promptMessage: v.string(),
    organizationId: v.string(),
    userTeamIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    integrationsInfo: v.optional(v.string()),
    integrationsList: v.optional(v.array(v.any())),
  }),
  handler: async (ctx, args) => {
    const { threadId, organizationId } = args;

    // Load integrations list
    const integrationsList = await ctx.runQuery(getListIntegrationsInternalRef(), {
      organizationId,
    });

    // Format integrations info
    let integrationsInfo: string | undefined;
    if (integrationsList && integrationsList.length > 0) {
      integrationsInfo = integrationsList
        .map((integration: Record<string, unknown>) => {
          const type = integration.type || 'rest_api';
          const status = integration.status || 'active';
          const title = integration.title || integration.name;
          const desc = integration.description ? ` - ${integration.description}` : '';
          return `• ${integration.name} (${type}, ${status}): ${title}${desc}`;
        })
        .join('\n');
    }

    debugLog('Initial context loaded', {
      threadId,
      integrationsCount: integrationsList?.length ?? 0,
    });

    return {
      integrationsInfo,
      integrationsList: integrationsList ?? undefined,
    };
  },
});

/**
 * Before generate hook: Process attachments and check context overflow.
 */
export const beforeGenerateHook = internalAction({
  args: {
    threadId: v.string(),
    promptMessage: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    contextMessagesTokens: v.number(),
  },
  returns: v.object({
    promptContent: v.optional(v.any()),
    contextExceedsBudget: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { threadId, promptMessage, attachments, contextMessagesTokens } = args;

    // Token budget check for logging
    const currentPromptTokens = estimateTokens(promptMessage || '');
    const contextBudget =
      DEFAULT_MODEL_CONTEXT_LIMIT * CONTEXT_SAFETY_MARGIN -
      SYSTEM_INSTRUCTIONS_TOKENS -
      currentPromptTokens -
      OUTPUT_RESERVE;

    const contextExceedsBudget = contextMessagesTokens > contextBudget;
    if (contextExceedsBudget) {
      debugLog('Context may exceed budget', {
        threadId,
        budget: contextBudget,
        contextTokens: contextMessagesTokens,
      });
    }

    // Process attachments
    const { promptContent: attachmentPrompt } = await processAttachments(
      ctx,
      attachments ?? [],
      promptMessage,
      { debugLog, toolName: 'chat_agent' },
    );

    return {
      promptContent: attachmentPrompt,
      contextExceedsBudget,
    };
  },
});

/**
 * On error hook: Log error details.
 */
export const onErrorHook = internalAction({
  args: {
    threadId: v.string(),
    errorName: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    errorStatus: v.optional(v.union(v.number(), v.string())),
    errorType: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const { threadId, errorName, errorMessage, errorStatus, errorType, errorCode } = args;

    console.error('[RoutingAgent] generateAgentResponse error', {
      threadId,
      name: errorName,
      message: errorMessage,
      status: errorStatus,
      type: errorType,
      code: errorCode,
    });

    return null;
  },
});
