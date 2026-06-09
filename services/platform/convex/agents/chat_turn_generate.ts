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
import type { AutoRouteReason } from '../streaming/validators';
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
    threadId: v.string(),
    streamId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.string(),
    requestStartMs: v.optional(v.number()),
    /** Cache pre-warm: prime the prompt cache with a throwaway generation and
     *  persist nothing. No stream, no saved message, no visible failure notice. */
    prewarm: v.optional(v.boolean()),
    // Arena root side only: create the A↔B branch link from here, AFTER
    // startChat has saved this thread's user message (see chat_turn.ts).
    arenaBranchThreadId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // A prewarm has no stream/generation status to clear and is invisible, so
    // both clearGen and the system-notice saves below are no-ops for it.
    const clearGen = () =>
      args.prewarm
        ? Promise.resolve(null)
        : ctx.runMutation(
            internal.threads.internal_mutations.clearGenerationStatus,
            {
              threadId: args.threadId,
              streamId: args.streamId,
            },
          );
    const notify = (content: string) =>
      args.prewarm
        ? Promise.resolve()
        : saveSystemNotice(ctx, args.threadId, content);

    try {
      // 1. Auto-route (LLM classifier) — only when no agent is pinned.
      let resolvedAgentSlug = args.agentSlug;
      let autoRouteReason: AutoRouteReason | undefined;
      if (args.agentSlug === AUTO_AGENT_SLUG) {
        const allowedAgentSlugs = args.projectId
          ? await ctx.runQuery(
              internal.projects.internal_queries.getProjectAllowedAgentSlugs,
              { projectId: args.projectId },
            )
          : undefined;
        const resolved = await ctx.runAction(
          internal.agents.auto_route.resolveAutoRoute,
          {
            organizationId: args.organizationId,
            message: args.message,
            // Pass the thread id so a later same-message manual override can
            // correct this decision (route-quality feedback).
            threadId: args.threadId,
            ...(allowedAgentSlugs && allowedAgentSlugs.length > 0
              ? { allowedAgentSlugs }
              : {}),
          },
        );
        resolvedAgentSlug = resolved.agentSlug;
        autoRouteReason = resolved.reason;
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
          await notify(
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
        await notify('Your message was blocked by a content policy.');
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
          // Audit the denial, but never let an audit-log failure skip the
          // status clear + user notice below (which is what the user sees).
          try {
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
          } catch (auditErr) {
            console.error(
              '[runChatTurnGeneration] model_access.denied audit log failed',
              auditErr instanceof Error ? auditErr.message : auditErr,
            );
          }
          await clearGen();
          await notify(
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
          autoRouteReason,
          preAllocatedStreamId: args.streamId,
          capabilityBindings: args.capabilityBindings,
          projectId: args.projectId,
          requestStartMs: args.requestStartMs,
          deferGeneration: true,
          prewarm: args.prewarm,
          // Shared-ctx: the governance query above already fetched + verified
          // org membership (role) and team IDs. Reuse them so startChat skips
          // its getOrganizationMember and budget skips getUserTeamIds + the
          // member findMany (each a ~40-60ms cross-component sub-transaction).
          preResolvedRole: governance.role,
          preResolvedTeamIds: governance.teamIds,
        },
      );

      // Arena root side: startChat has now committed this thread's user
      // message, so the branch link can be created without racing the save.
      // Best-effort — a link failure must never fail the turn (both
      // generations already proceed; this only affects the A/B branch UI).
      if (args.arenaBranchThreadId) {
        try {
          await ctx.runMutation(
            internal.threads.mutations.createArenaBranchLink,
            {
              rootThreadId: args.threadId,
              branchThreadId: args.arenaBranchThreadId,
            },
          );
        } catch (err) {
          console.error(
            '[runChatTurnGeneration] arena branch link failed',
            err instanceof Error ? err.message : err,
          );
        }
      }

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
