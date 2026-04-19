/**
 * Internal mutation for starting agent chat.
 *
 * Called by the unified_chat action after reading agent config from filesystem.
 * This mutation handles the transactional parts: stream creation, message saving,
 * and scheduling the agent generation action.
 */

import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { startAgentChat } from '../lib/agent_chat';
import { getOrganizationMember } from '../lib/rls';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);
const afterGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:afterGenerateHook',
);

export const startChat = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
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
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
    agentConfig: v.any(),
    agentSlug: v.string(),
    preAllocatedStreamId: v.optional(v.string()),
    capabilityBindings: v.optional(v.array(v.string())),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: args.userName,
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (!thread || thread.userId !== args.userId) {
      throw new Error('Thread not found');
    }

    const toolNames: unknown = args.agentConfig?.convexToolNames;
    const usesTodos =
      Array.isArray(toolNames) &&
      toolNames.some((name) => name === 'update_todos');

    const hooks = usesTodos
      ? {
          beforeGenerate: await createFunctionHandle(beforeGenerateHookRef),
          afterGenerate: await createFunctionHandle(afterGenerateHookRef),
        }
      : undefined;

    const mergedConfig = mergeCapabilityBindings(
      args.agentConfig,
      args.capabilityBindings,
    );

    return startAgentChat({
      ctx,
      agentType: 'custom',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      additionalContext: args.additionalContext,
      userContext: args.userContext,
      agentConfig: mergedConfig,
      model: mergedConfig.model ?? 'default',
      provider: mergedConfig.provider,
      agentSlug: args.agentSlug,
      debugTag: `[${args.agentSlug}]`,
      enableStreaming: true,
      preAllocatedStreamId: args.preAllocatedStreamId,
      hooks,
    });
  },
});

function mergeCapabilityBindings<
  T extends {
    integrationBindings?: string[];
    convexToolNames?: string[];
  },
>(agentConfig: T, capabilityBindings: string[] | undefined): T {
  if (!capabilityBindings || capabilityBindings.length === 0) {
    return agentConfig;
  }
  const existingBindings = Array.isArray(agentConfig.integrationBindings)
    ? agentConfig.integrationBindings
    : [];
  const bindingSet = new Set<string>([
    ...existingBindings,
    ...capabilityBindings,
  ]);
  const existingTools = Array.isArray(agentConfig.convexToolNames)
    ? agentConfig.convexToolNames
    : [];
  const needsIntegrationTool =
    bindingSet.size > 0 && !existingTools.includes('integration');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- preserving generic config shape while adding bindings
  return {
    ...agentConfig,
    integrationBindings: Array.from(bindingSet),
    convexToolNames: needsIntegrationTool
      ? [...existingTools, 'integration']
      : existingTools,
  } as T;
}
