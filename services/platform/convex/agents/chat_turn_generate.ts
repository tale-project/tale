'use node';

/**
 * Track B generation action — the SINGLE durable node action for a chat turn.
 *
 * Scheduled by the `chatWithAgentTurn` V8 mutation (which already marked the
 * thread generating + allocated the stream). Because a V8 mutation — not a node
 * action — scheduled it, this starts on a free Node event loop in ~20ms (no
 * contention). It front-loads the disk-bound resolution that used to live in
 * the `chatWithAgent` node action (auto-route, agent-config read, governance
 * default, model-access, guardrails sanitize), hands off to `startChat` with
 * `deferGeneration` (which does saveMessage / budget / feature-flags / image-gen
 * and returns the generation args instead of scheduling), then runs generation
 * via an AWAITED `ctx.runAction(runAgentGeneration, ...)`: the parent yields the
 * event loop during the await, so `runAgentGeneration` starts cleanly instead
 * of contending. `runAgentGeneration` itself is unchanged.
 *
 * Async-validation tradeoff (accepted): guardrails-block / model-access-denied /
 * project-access-denied surface as a saved system message + cleared generation
 * status (not a synchronous client throw). The client `precheckInput` already
 * covers the guardrails-block UX before send.
 */

import { saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { composerProfilesValidator } from '../../lib/shared/composer-profiles';
import { AUTO_AGENT_SLUG } from '../../lib/shared/constants/agents';
import { stripModelRefQualifier } from '../../lib/shared/utils/model-ref';
import { components, internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import {
  loadGuardrailsSnapshot,
  sanitizeMessage,
} from '../governance/sanitize';
import { runGenerationCore } from '../lib/agent_chat/internal_actions';
import { userContextValidator } from '../lib/agent_response/validators';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { applyModelOverride } from './config';
import { resolveAgentConfigInline } from './resolve_agent_config';

/** Save a short assistant-role system notice so an async failure is visible. */
async function saveSystemNotice(
  ctx: ActionCtx,
  threadId: string,
  content: string,
): Promise<void> {
  try {
    await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'assistant', content },
    });
  } catch (err) {
    console.warn(
      '[runChatTurnGeneration] failed to save system notice',
      err instanceof Error ? err.message : err,
    );
  }
}

export const runChatTurnGeneration = internalAction({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    message: v.string(),
    modelId: v.optional(v.string()),
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
    capabilityBindings: v.optional(v.array(v.string())),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(userContextValidator),
    maxSteps: v.optional(v.number()),
    projectId: v.optional(v.id('projects')),
    composerProfiles: v.optional(composerProfilesValidator),
    threadId: v.string(),
    streamId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.string(),
    requestStartMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const clearGen = () =>
      ctx.runMutation(
        internal.threads.internal_mutations.clearGenerationStatus,
        {
          threadId: args.threadId,
          streamId: args.streamId,
        },
      );

    try {
      // 1. Auto-route (LLM classifier) — only when no agent is pinned.
      let resolvedAgentSlug = args.agentSlug;
      if (args.agentSlug === AUTO_AGENT_SLUG) {
        const allowedAgentSlugs = args.projectId
          ? await ctx.runQuery(
              internal.projects.internal_queries.getProjectAllowedAgentSlugs,
              { projectId: args.projectId },
            )
          : undefined;
        const route = await ctx.runAction(
          internal.agents.auto_route.resolveAutoRoute,
          {
            organizationId: args.organizationId,
            message: args.message,
            ...(allowedAgentSlugs && allowedAgentSlugs.length > 0
              ? { allowedAgentSlugs }
              : {}),
          },
        );
        resolvedAgentSlug = route.agentSlug;
      }

      // (Project access was validated synchronously in the chatWithAgentTurn
      // mutation; the thread↔project persist + PROJECT_MISMATCH check run in
      // startChat below.)

      // 2. orgSlug → agent config (node-local disk read, fast) yields the
      //    agent's supportedModels, then guardrails snapshot + ALL governance
      //    (default-model + access) resolve in parallel — governance is now a
      //    SINGLE backend round-trip (member + teamIds fetched once) instead of
      //    the former two/three (resolveDefaultModel + getAccessibleModels +
      //    checkModelAccess each re-fetching membership).
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const configResult = await resolveAgentConfigInline(ctx, {
        orgSlug,
        agentSlug: resolvedAgentSlug,
        organizationId: args.organizationId,
        modelId: args.modelId,
      });
      const agentConfig = configResult.config;

      const [guardrails, governance] = await Promise.all([
        loadGuardrailsSnapshot(ctx, args.organizationId),
        ctx.runQuery(
          internal.governance.internal_queries.resolveGenerationGovernance,
          {
            organizationId: args.organizationId,
            userId: args.userId,
            userEmail: args.userEmail,
            userName: args.userName,
            supportedModels: configResult.supportedModels.map(
              stripModelRefQualifier,
            ),
            ...(args.modelId
              ? { explicitModelId: stripModelRefQualifier(args.modelId) }
              : {}),
          },
        ),
      ]);

      // 4. Governance default model (implicit path only).
      if (!args.modelId && governance.defaultModel?.modelId) {
        const qualifiedRef = governance.defaultModel.providerName
          ? `${governance.defaultModel.providerName}:${governance.defaultModel.modelId}`
          : governance.defaultModel.modelId;
        applyModelOverride(
          agentConfig,
          qualifiedRef,
          configResult.supportedModels,
        );
      }

      // 5. Implicit model-access RBAC (no explicit modelId) — accessible set
      //    came back in the consolidated governance query above.
      if (!args.modelId) {
        const accessibleSet = new Set(governance.accessibleModelIds);
        const accessibleRefs = configResult.supportedModels.filter((ref) =>
          accessibleSet.has(stripModelRefQualifier(ref)),
        );
        if (accessibleRefs.length === 0) {
          await clearGen();
          await saveSystemNotice(
            ctx,
            args.threadId,
            "No model in this agent is permitted by your organization's model access policy.",
          );
          return null;
        }
        const currentPlain = agentConfig.model
          ? stripModelRefQualifier(agentConfig.model)
          : null;
        const chosenRef =
          currentPlain && accessibleSet.has(currentPlain) && agentConfig.model
            ? agentConfig.model
            : accessibleRefs[0];
        agentConfig.model = chosenRef;
        const chosenPlain = stripModelRefQualifier(chosenRef);
        const fallbacks = accessibleRefs.filter(
          (ref) => stripModelRefQualifier(ref) !== chosenPlain,
        );
        agentConfig.fallbackModels =
          fallbacks.length > 0 ? fallbacks : undefined;
      }

      // 6. Guardrails input sanitize (chat_filter → PII → moderation_provider).
      let sanitized;
      try {
        sanitized = await sanitizeMessage(
          ctx,
          args.message,
          'input',
          guardrails,
          {
            organizationId: args.organizationId,
            orgSlug,
            threadId: args.threadId,
            agentSlug: resolvedAgentSlug,
            actorId: args.userId,
            actorEmail: args.userEmail,
            actorType: 'user',
          },
        );
      } catch (err) {
        await clearGen();
        await saveSystemNotice(
          ctx,
          args.threadId,
          'Your message was blocked by a content policy.',
        );
        console.warn(
          '[runChatTurnGeneration] input blocked by guardrails',
          err instanceof ConvexError ? err.data : err,
        );
        return null;
      }
      const message = sanitized.text;

      // 7. Explicit model-access RBAC (explicit modelId only) — access result
      //    came back in the consolidated governance query above.
      if (args.modelId) {
        const accessCheck = governance.explicitAccess;
        if (accessCheck && !accessCheck.allowed) {
          await ctx.runMutation(
            internal.audit_logs.internal_mutations.createAuditLog,
            {
              organizationId: args.organizationId,
              actorId: args.userId,
              actorEmail: args.userEmail,
              actorType: 'user',
              action: 'model_access.denied',
              category: 'ai',
              resourceType: 'chat_message',
              resourceId: args.threadId,
              status: 'denied',
              metadata: {
                requestedModelId: args.modelId,
                reason: accessCheck.reason ?? null,
                agentSlug: resolvedAgentSlug,
              },
            },
          );
          await clearGen();
          await saveSystemNotice(
            ctx,
            args.threadId,
            accessCheck.reason ??
              'You do not have access to the selected model.',
          );
          return null;
        }
      }

      // 8. Prep (saveMessage / budget / feature-flags / image-gen) WITHOUT
      // scheduling — startChat returns the generation args.
      const result = await ctx.runMutation(
        internal.agents.start_chat.startChat,
        {
          threadId: args.threadId,
          organizationId: args.organizationId,
          userId: args.userId,
          userEmail: args.userEmail,
          userName: args.userName,
          message,
          maxSteps: args.maxSteps,
          attachments: args.attachments,
          additionalContext: args.additionalContext,
          userContext: args.userContext,
          agentConfig,
          agentSlug: resolvedAgentSlug,
          preAllocatedStreamId: args.streamId,
          capabilityBindings: args.capabilityBindings,
          projectId: args.projectId,
          composerProfiles: args.composerProfiles,
          requestStartMs: args.requestStartMs,
          deferGeneration: true,
        },
      );

      // Budget block / file-upload block / image-generation agents are fully
      // handled inside startChat (no generationArgs) — the turn is finalized.
      if (!result.generationArgs) {
        return null;
      }

      // 9. Generate IN-PROCESS — call the generation core directly instead of
      // ctx.runAction(runAgentGeneration). We're already in a node action, so
      // this skips the ~340ms node→backend→node runAction dispatch hop. The
      // turn is now ONE node action end-to-end (front-load + generation).
      await runGenerationCore(ctx, result.generationArgs);
      return null;
    } catch (err) {
      console.error(
        '[runChatTurnGeneration] failed',
        err instanceof Error ? err.message : err,
      );
      await clearGen().catch(() => {});
      throw err;
    }
  },
});
