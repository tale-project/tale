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

import {
  getCredentialPolicy,
  usesGateway,
} from '../../lib/agent-adapters/credential-policy';
import {
  resolveProductAgentKind,
  type ProductAgentSlug,
} from '../../lib/agent-adapters/events';
import { AUTO_AGENT_SLUG } from '../../lib/shared/constants/agents';
import type {
  ResponseReasoningSeed,
  ResponseStyleAdvice,
} from '../../lib/shared/response-tuning';
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
import { resolveLanguageModelWithFallback } from '../providers/failover';
import type { AutoRouteReason } from '../streaming/validators';
import { applyModelOverride } from './config';
import { resolveExternalAgentModelRefs } from './external_agent/resolve_external_agent_model';
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
    /** `@`-mentioned knowledge-base documents, already resolved + authorized
     *  by `chatWithAgentTurn`. Threaded to startChat → startAgentChat, where
     *  they become the enriched marker block + the pinned RAG scope. Folder
     *  pins arrive pre-expanded into this same list. */
    referencedFiles: v.optional(
      v.array(
        v.object({
          documentId: v.id('documents'),
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    /** `@`-mentioned folders (display metadata only — their files are
     *  already merged into `referencedFiles`). Drives the folder marker
     *  block + the sent-bubble folder chips. */
    referencedFolders: v.optional(
      v.array(
        v.object({
          folderId: v.id('folders'),
          name: v.string(),
          fileCount: v.number(),
        }),
      ),
    ),
    /** Queued-message drain turn (threads/message_queue.ts): the user
     *  message(s) are already persisted — startChat must not re-save. */
    queuedPromptMessageId: v.optional(v.string()),
    /** The thread's stored agent BEFORE this turn's optimistic
     *  `threadMetadata.agentSlug` patch. When it resolves to an external
     *  agent, the thread is agent-locked: the sandbox session, --resume
     *  transcript, and plan/act posture are bound to it, so a differing
     *  client selection (stale per-user picker state from another thread)
     *  or an Auto route must not re-route the turn (step 0 below). */
    priorAgentSlug: v.optional(v.string()),
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
      // 0. External-thread agent lock. A thread whose stored agent is an
      //    external agent is bound to it — re-routing would silently abandon
      //    the sandbox session, --resume transcript, and plan/act posture. The
      //    client's slug can legitimately differ only through stale per-user
      //    picker state (the composer pins locked threads), so the stored
      //    agent wins and the optimistic metadata patch is corrected. A prior
      //    agent that no longer resolves (uninstalled/renamed) falls through
      //    to the client selection.
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      let lockedConfigResult:
        | Awaited<ReturnType<typeof resolveAgentConfigInline>>
        | undefined;
      let lockedAgentSlug: string | undefined;
      if (args.priorAgentSlug && args.priorAgentSlug !== args.agentSlug) {
        try {
          const prior = await resolveAgentConfigInline(ctx, {
            orgSlug,
            agentSlug: args.priorAgentSlug,
            organizationId: args.organizationId,
            modelId: args.modelId,
          });
          if (prior.config.primaryBehavior === 'external-agent') {
            lockedConfigResult = prior;
            lockedAgentSlug = args.priorAgentSlug;
            console.warn(
              `[runChatTurnGeneration] external-thread agent lock: keeping '${args.priorAgentSlug}' over client selection '${args.agentSlug}' for thread ${args.threadId}`,
            );
            await ctx.runMutation(
              internal.threads.internal_mutations.setThreadAgentSlug,
              { threadId: args.threadId, agentSlug: args.priorAgentSlug },
            );
          }
        } catch (err: unknown) {
          console.warn(
            '[runChatTurnGeneration] agent-lock check failed (honoring client selection):',
            err instanceof Error ? err.message : err,
          );
        }
      }

      // 1. Auto-route (LLM classifier) — only when no agent is pinned and the
      //    thread isn't agent-locked (step 0).
      let resolvedAgentSlug = lockedAgentSlug ?? args.agentSlug;
      let autoRouteReason: AutoRouteReason | undefined;
      // The router's per-message advice (Auto mode only) — applied to the
      // agentConfig once it's built below. `routeStyle` shapes the prose
      // suffix; `routeSeed` seeds the reasoning governor's prior.
      let routeStyle: ResponseStyleAdvice | undefined;
      let routeSeed: ResponseReasoningSeed | undefined;
      if (!lockedConfigResult && args.agentSlug === AUTO_AGENT_SLUG) {
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
        routeStyle = resolved.tuning;
        routeSeed = resolved.seed;

        // Broadcast the resolved route the instant routing settles so the
        // client's thinking timeline flips "Routing…" → "Routed to X" BEFORE
        // generation starts (it rides the existing getThreadMeta
        // subscription). Without this the timeline only learns the route from
        // the assistant message's metadata, i.e. after the answer has already
        // started streaming. Fire-and-forget + best-effort — never blocks the
        // first-token path. (Prewarm turns never carry the Auto slug, so this
        // can't fire for an invisible prewarm.)
        if (autoRouteReason) {
          void ctx
            .runMutation(internal.threads.internal_mutations.setLiveRoute, {
              threadId: args.threadId,
              agentSlug: resolvedAgentSlug,
              reason: autoRouteReason,
            })
            .catch((err: unknown) =>
              console.warn(
                '[runChatTurnGeneration] setLiveRoute broadcast failed:',
                err instanceof Error ? err.message : err,
              ),
            );
        }
      }

      // (Project access was validated synchronously in the chatWithAgentTurn
      // mutation; the thread↔project persist + PROJECT_MISMATCH check run in
      // startChat below.)

      // 2. Agent config (node-local disk read, fast; already resolved in step
      //    0 when the lock fired) yields the agent's supportedModels, then
      //    guardrails snapshot + ALL governance (default-model + access)
      //    resolve in parallel — governance is now a SINGLE backend round-trip
      //    (member + teamIds fetched once) instead of the former two/three
      //    (resolveDefaultModel + getAccessibleModels + checkModelAccess each
      //    re-fetching membership).
      const configResult =
        lockedConfigResult ??
        (await resolveAgentConfigInline(ctx, {
          orgSlug,
          agentSlug: resolvedAgentSlug,
          organizationId: args.organizationId,
          modelId: args.modelId,
        }));
      const agentConfig = configResult.config;
      // Carry the Auto router's per-message advice onto the config for this turn
      // (both unset for a pinned agent — the router only runs under Auto).
      agentConfig.responseStyle = routeStyle;
      agentConfig.routeSeed = routeSeed;
      // Env-managed external runtimes (Cursor) name their models by the vendor
      // CLI's OWN ids (`auto`, `claude-opus-4-8-thinking-high`, …), not platform
      // catalog entries — the vendor account + CLI own the model list. So their
      // `supportedModels` is a runtime HINT, not a catalog allowlist: the first
      // entry is the model to run this turn (empty ⇒ let the CLI pick), and
      // catalog governance is bypassed whether or not it's set.
      const externalAgentKind: ProductAgentSlug = resolveProductAgentKind(
        agentConfig.agentKind,
      );
      const isExternalAgent = agentConfig.primaryBehavior === 'external-agent';
      const isEnvManagedExternal =
        isExternalAgent &&
        agentConfig.authMode !== 'byo' &&
        getCredentialPolicy(externalAgentKind).managedSource === 'agent-env';
      const isGatewayManagedExternal =
        isExternalAgent &&
        agentConfig.authMode !== 'byo' &&
        usesGateway(externalAgentKind, agentConfig.authMode);

      // External agents that don't draw from the platform model catalog bypass
      // default-model resolution and model-access RBAC:
      //  - BYO: raw provider id (or empty = member default / credential default).
      //  - env-managed (e.g. Cursor): the vendor CLI's own model ids.
      // Gateway-managed Claude Code with an empty `supportedModels` still resolves
      // through governance + platform defaults (dynamic, not a static pin).
      const skipsPlatformModelGovernance =
        isExternalAgent &&
        (agentConfig.authMode === 'byo' ||
          isEnvManagedExternal ||
          (configResult.supportedModels.length === 0 &&
            !isGatewayManagedExternal));

      // Env-managed vendor pin: first `supportedModels` entry is the CLI model id.
      if (
        isEnvManagedExternal &&
        !args.modelId &&
        !agentConfig.model &&
        configResult.supportedModels.length > 0
      ) {
        agentConfig.model = configResult.supportedModels[0];
        agentConfig.fallbackModels =
          configResult.supportedModels.length > 1
            ? configResult.supportedModels.slice(1)
            : undefined;
      }

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
      if (
        !skipsPlatformModelGovernance &&
        !args.modelId &&
        governance.defaultModel?.modelId
      ) {
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
      //    came back in the consolidated governance query above. Skipped for
      //    BYO (no platform catalog to police) and for gateway-managed Claude
      //    Code with an empty `supportedModels` (step 5b resolves + RBAC-checks
      //    the governance/platform default instead).
      const deferToExternalDynamicResolution =
        isGatewayManagedExternal && configResult.supportedModels.length === 0;
      if (
        !skipsPlatformModelGovernance &&
        !args.modelId &&
        !deferToExternalDynamicResolution
      ) {
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

      // 5b. External-agent dynamic model resolution (BYO defaults, gateway-managed
      //     empty lists, vendor-model tails). Gateway-managed agents with an explicit
      //     supportedModels list were handled in step 5 above.
      if (isExternalAgent) {
        const needsDynamicResolution =
          agentConfig.authMode === 'byo' ||
          isEnvManagedExternal ||
          (isGatewayManagedExternal &&
            configResult.supportedModels.length === 0);
        if (needsDynamicResolution) {
          let platformDefault: {
            providerName: string;
            modelId: string;
          } | null = null;
          if (
            isGatewayManagedExternal &&
            configResult.supportedModels.length === 0 &&
            !governance.defaultModel &&
            !args.modelId
          ) {
            try {
              const resolved = await resolveLanguageModelWithFallback(ctx, {
                tag: 'chat',
                organizationId: args.organizationId,
              });
              platformDefault = {
                providerName: resolved.modelData.providerName,
                modelId: resolved.modelData.modelId,
              };
            } catch (err) {
              console.warn(
                '[runChatTurnGeneration] platform default model resolution skipped:',
                err,
              );
            }
          }

          const explicitModelRef = args.modelId ?? agentConfig.model;
          const resolvedModels = resolveExternalAgentModelRefs({
            authMode: agentConfig.authMode,
            gatewayManaged: isGatewayManagedExternal,
            supportedModels: configResult.supportedModels,
            ...(explicitModelRef !== undefined && {
              explicitModelRef,
            }),
            governanceDefault: governance.defaultModel,
            ...(platformDefault !== null && { platformDefault }),
          });

          if (
            isGatewayManagedExternal &&
            resolvedModels.primaryModelRef !== 'default' &&
            !args.modelId
          ) {
            const plain = stripModelRefQualifier(
              resolvedModels.primaryModelRef,
            );
            const access = await ctx.runQuery(
              internal.governance.internal_queries.checkModelAccessInternal,
              {
                organizationId: args.organizationId,
                userId: args.userId,
                modelId: plain,
              },
            );
            if (!access.allowed) {
              await clearGen();
              await notify(
                access.reason ??
                  "You do not have access to the organization's default model.",
              );
              return null;
            }
          }

          agentConfig.model =
            resolvedModels.primaryModelRef === 'default'
              ? undefined
              : resolvedModels.primaryModelRef;
          agentConfig.fallbackModels =
            resolvedModels.agentFallbackRefs.length > 0
              ? resolvedModels.agentFallbackRefs
              : undefined;
        } else if (
          isEnvManagedExternal &&
          !agentConfig.fallbackModels &&
          configResult.supportedModels.length > 1
        ) {
          agentConfig.fallbackModels = configResult.supportedModels.slice(1);
        }
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
      //    came back in the consolidated governance query above. Skipped for
      //    BYO (the raw model id isn't a catalog entry).
      if (!skipsPlatformModelGovernance && args.modelId) {
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
          referencedFiles: args.referencedFiles,
          referencedFolders: args.referencedFolders,
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
          queuedPromptMessageId: args.queuedPromptMessageId,
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
      await clearGen().catch((clearErr: unknown) =>
        console.warn(
          '[runChatTurnGeneration] clearGenerationStatus on failure path failed:',
          clearErr instanceof Error ? clearErr.message : clearErr,
        ),
      );
      throw err;
    }
  },
});
