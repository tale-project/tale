/**
 * Internal mutation for starting agent chat.
 *
 * Called by the unified_chat action after reading agent config from filesystem.
 * This mutation handles the transactional parts: stream creation, message saving,
 * and scheduling the agent generation action.
 */

import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import {
  composerProfilesValidator,
  creativityToScoreOverride,
  effortToTierOverride,
  styleInstructionFragment,
} from '../../lib/shared/composer-profiles';
import { internalMutation } from '../_generated/server';
import { startAgentChat } from '../lib/agent_chat';
import { userContextValidator } from '../lib/agent_response/validators';
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
    userContext: v.optional(userContextValidator),
    agentConfig: v.any(),
    agentSlug: v.string(),
    preAllocatedStreamId: v.optional(v.string()),
    capabilityBindings: v.optional(v.array(v.string())),
    /**
     * Projects feature: when chatting inside a project, the projectId
     * is persisted on `threadMetadata` so subsequent turns (and the
     * system-prompt assembler in `generate_response.ts`) automatically
     * inherit the project context.
     */
    projectId: v.optional(v.id('projects')),
    /** Composer response-tuning profiles (effort/creativity/style). */
    composerProfiles: v.optional(composerProfilesValidator),
    /** Server-stamped turn-start (chatWithAgent entry) for TTFT measurement. */
    requestStartMs: v.optional(v.number()),
    /**
     * Track B: when true, prep but DO NOT schedule generation — return its args
     * so the node-action caller can `ctx.runAction(runAgentGeneration, ...)`.
     */
    deferGeneration: v.optional(v.boolean()),
    /**
     * Org member role + team IDs already resolved by the caller's consolidated
     * governance query (`resolveGenerationGovernance`, which also throws on
     * non-membership). When present, skip the duplicate `getOrganizationMember`
     * auth lookup here and thread them into budget enforcement, removing 2-3
     * cross-component sub-transactions from the warm chat path. Omit for callers
     * that did not pre-verify membership (they fall back to a fresh lookup).
     */
    preResolvedRole: v.optional(v.string()),
    preResolvedTeamIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
    // Track B: present only when deferGeneration is set AND generation proceeds.
    generationArgs: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    // Org-membership auth. When the caller already resolved it via the
    // consolidated governance query (which throws on non-membership), reuse the
    // role and skip this betterAuth lookup entirely; otherwise verify here.
    const resolvedRole =
      args.preResolvedRole ??
      (
        await getOrganizationMember(ctx, args.organizationId, {
          userId: args.userId,
          email: args.userEmail,
          name: args.userName,
        })
      ).role;

    // Auth + existence via our own threadMetadata row (a direct ctx.db read)
    // instead of the agent-component getThread (a ~40-60ms cross-component
    // sub-transaction). threadMetadata.userId mirrors the agent thread and was
    // already verified by the chatWithAgentTurn V8 entry mutation. Reused for
    // the projectId persist below so the row is read once.
    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!threadMeta || threadMeta.userId !== args.userId) {
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

    let mergedConfig = mergeCapabilityBindings(
      args.agentConfig,
      args.capabilityBindings,
    );

    // Composer "response tuning" profiles. Each lever is independent and
    // `adaptive` (or absent) is a no-op that leaves the existing algorithms
    // in charge. Style is applied here (appended to the agent instructions
    // → system prompt); effort + creativity are forwarded to the generation
    // layer as a reasoning override consumed by `buildReasoningOptions`.
    const profiles = args.composerProfiles;
    if (profiles?.style && profiles.style !== 'adaptive') {
      const fragment = styleInstructionFragment(profiles.style);
      if (fragment) {
        const baseInstructions =
          typeof mergedConfig.instructions === 'string'
            ? mergedConfig.instructions
            : '';
        mergedConfig = {
          ...mergedConfig,
          instructions: baseInstructions
            ? `${baseInstructions}\n\n${fragment}`
            : fragment,
        };
      }
    }
    const effortTier = effortToTierOverride(profiles?.effort);
    const creativityScore = creativityToScoreOverride(profiles?.creativity);
    const reasoningOverride =
      effortTier !== undefined || creativityScore !== undefined
        ? { effort: effortTier, creativity: creativityScore }
        : undefined;

    // Projects: persist `projectId` on the thread row if the caller
    // explicitly passed one. Enforce mismatch detection: if the thread
    // already belongs to a different project, fail loudly — the client
    // must call `moveThreadToProject` instead of side-channeling via a
    // chat send.
    if (args.projectId) {
      if (threadMeta) {
        if (threadMeta.projectId && threadMeta.projectId !== args.projectId) {
          throw new ConvexError({ code: 'PROJECT_MISMATCH' });
        }
        if (!threadMeta.projectId) {
          await ctx.db.patch(threadMeta._id, {
            projectId: args.projectId,
            // First entry into a project: thread is personal-in-project
            // unless owner explicitly opts in via setThreadSharedWithProject.
            sharedWithProject: false,
            updatedAt: Date.now(),
          });
        }
      }
    }

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
      reasoningOverride,
      requestStartMs: args.requestStartMs,
      deferGeneration: args.deferGeneration,
      // Skip the duplicate betterAuth member + team lookups in
      // resolveBudgetContext — both came from the governance query (or the
      // getOrganizationMember above).
      preResolvedRole: resolvedRole,
      preResolvedTeamIds: args.preResolvedTeamIds,
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
