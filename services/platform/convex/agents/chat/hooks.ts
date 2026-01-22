'use node';

/**
 * Chat Agent Hooks - Convex Actions
 *
 * These hooks are encapsulated as Convex actions so they can be passed
 * via FunctionHandle to the generic agent action.
 *
 * Hooks:
 * - beforeContextHook: Load summary, integrations, and start RAG prefetch
 * - beforeGenerateHook: Process attachments and check context overflow
 * - onErrorHook: Trigger summarization and log error details
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { getListIntegrationsInternalRef } from '../../lib/function_refs';
import { getAutoSummarizeRef } from '../../lib/summarization';
import { processAttachments } from '../../lib/attachments/index';
import {
  checkAndSummarizeIfNeeded,
  estimateTokens,
  loadContextSummary,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  CONTEXT_SAFETY_MARGIN,
  SYSTEM_INSTRUCTIONS_TOKENS,
  OUTPUT_RESERVE,
} from '../../lib/context_management';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_ROUTING_AGENT', '[RoutingAgent]');

/**
 * Before context hook: Load summary and integrations.
 */
export const beforeContextHook = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    taskDescription: v.string(),
    organizationId: v.string(),
    userTeamIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    contextSummary: v.optional(v.string()),
    integrationsInfo: v.optional(v.string()),
    integrationsList: v.optional(v.array(v.any())),
  }),
  handler: async (ctx, args) => {
    const { threadId, organizationId } = args;

    // Load context summary and integrations in parallel
    const [contextSummary, integrationsList] = await Promise.all([
      loadContextSummary(ctx, threadId),
      ctx.runQuery(getListIntegrationsInternalRef(), { organizationId }),
    ]);

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
      hasSummary: !!contextSummary,
      integrationsCount: integrationsList?.length ?? 0,
    });

    return {
      contextSummary: contextSummary ?? undefined,
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
    taskDescription: v.string(),
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
    existingSummary: v.optional(v.string()),
  },
  returns: v.object({
    promptContent: v.optional(v.any()),
    summarizationTriggered: v.boolean(),
    contextExceedsBudget: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { threadId, taskDescription, attachments, contextMessagesTokens, existingSummary } = args;

    // Check context overflow and trigger summarization if needed
    const currentPromptTokens = estimateTokens(taskDescription || '');
    const overflowCheck = await checkAndSummarizeIfNeeded(ctx, {
      threadId,
      contextMessagesTokens,
      currentPromptTokens,
      existingSummary,
    });

    if (overflowCheck.summarizationTriggered) {
      debugLog('Async summarization triggered', {
        threadId,
        currentUsagePercent: overflowCheck.estimate.usagePercent.toFixed(1) + '%',
      });
    }

    // Token budget check for logging
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
      taskDescription,
      { debugLog, toolName: 'chat_agent' },
    );

    return {
      promptContent: attachmentPrompt,
      summarizationTriggered: overflowCheck.summarizationTriggered,
      contextExceedsBudget,
    };
  },
});

/**
 * On error hook: Trigger summarization and log error details.
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
  handler: async (ctx, args) => {
    const { threadId, errorName, errorMessage, errorStatus, errorType, errorCode } = args;

    // Trigger summarization on error
    await ctx.runAction(getAutoSummarizeRef(), { threadId });

    // Log error details
    console.error('[chat_agent] generateAgentResponse error', {
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
