'use node';

/**
 * External-agent runtime — runs a coding agent (Claude Code / OpenCode) inside
 * a sandbox session for one chat turn.
 *
 * Called for agents with `primaryBehavior === 'external-agent'`. Bypasses the
 * chat-loop generate_response pipeline: the user's message becomes one agent
 * run inside the thread's persistent sandbox session (`--resume` continues the
 * same conversation across turns). The agent's tool-use/text stream lands in
 * `sandboxSessionOps` live (via run_agent); this module saves the final
 * assistant text into the thread so the chat UI renders the reply, and owns
 * session lifecycle + the per-turn Bifrost virtual key.
 *
 * v1: empty `/workspace/repo` workspace (no repo attach); the agent clones with
 * the injected GITHUB_TOKEN if it needs a repo. The session is reused across
 * turns (owner = thread); the per-turn LLM key is minted and revoked here so no
 * plaintext gateway key is ever persisted.
 */

import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import type { AgentAssistantContent } from '../../node_only/sandbox/agent_message_parts';
import {
  applyGatewayConfig,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  revokeVirtualKey,
  toGatewayModelRef,
} from '../../node_only/sandbox/bifrost_admin';
import {
  SessionNotFoundError,
  sessionCreate,
  sessionEnvPatch,
  sessionIsAlive,
  sessionSetPinned,
} from '../../node_only/sandbox/helpers/session_client';
import { runAgentInSessionImpl } from '../../node_only/sandbox/run_agent';
import { loadOrgGatewayProviders } from '../../providers/file_actions';
import {
  sessionIdForThread,
  sessionIdForUser,
  userOwnerId,
} from '../../sandbox/session_naming';
import {
  finalizeTurnSideEffects,
  handleTurnOutcome,
  patchStreamingMessage,
  type TurnContext,
} from './turn_lifecycle';

const debugLog = createDebugLog(
  'DEBUG_EXTERNAL_AGENT',
  '[runExternalAgentTurn]',
);

// One persistent sandbox per USER, reused across all their chat threads (shared
// /workspace; each thread keeps its own Claude conversation via per-thread
// resume). Falls back to thread ownership only when no userId is available
// (system/rare). See [[sandbox-agent-sessions-e2e-2026-06-11]].
const OWNER_TYPE_USER = 'user';
const OWNER_TYPE_THREAD = 'thread';
// Data plane — Bifrost as seen from INSIDE the session container. (The
// management plane URL, BIFROST_URL, is read in bifrost_admin.ts.) Always the
// sandbox-network alias (it's hardcoded in the runtime NO_PROXY); kept
// separate from BIFROST_URL so host-run convex doesn't leak a host-only URL
// into the container (same split as SANDBOX_STORAGE_INTERNAL_BASE_URL).
const EXTERNAL_AGENT_GATEWAY_URL =
  process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://bifrost:8080';
// v1 static grant set: external agents get the org's GitHub credential (when
// one is active) so they can clone/push/open PRs. The broker audits every
// fetch; a missing credential degrades to an anonymous session.
const SESSION_GRANTS = ['github'];
// Per-turn LLM budget CEILING for an external-agent run (cents), used only when
// the org has NO rolling cost cap (uncapped). When a cost cap IS configured the
// VK is sized to the rolling-remaining instead (see the mint below), so a long
// task is bounded by the org budget, not this flat default. Raised from the
// original $5 — a multi-hour task reuses ONE VK across all its continuations,
// and $5 would hard-reject a legitimate long run mid-task. Operator-tunable.
const TURN_BUDGET_CENTS = Number(
  process.env.EXTERNAL_AGENT_TURN_BUDGET_CENTS ?? '10000',
);
// Total wall-clock a turn may run, threaded down as the exec `timeoutMs` so
// runnerd keeps the child alive this long. Decoupled from the Convex action
// ceiling via the cross-action continuation, so it can be the full sandbox
// `execMaxTimeoutMs` (24h) — a long task runs to completion / budget / manual
// stop, not a wall clock.
const TURN_TIMEOUT_MS = Number(
  process.env.EXTERNAL_AGENT_TURN_TIMEOUT_MS ?? String(24 * 60 * 60 * 1000),
);
// Per-ACTION window: how long one action drains before handing off to a
// continuation action (kept under the 30min ACTIONS_USER_TIMEOUT_SECS ceiling
// with margin for the handoff + the next action's cold start).
const ACTION_WINDOW_MS = Number(
  process.env.EXTERNAL_AGENT_ACTION_WINDOW_MS ?? String(25 * 60 * 1000),
);

/**
 * Append a failure note to the timeline-so-far WITHOUT discarding it. On an
 * early end (timeout/abort/error) the message already holds the partial
 * tool timeline (patched live via onTimeline); we mark it failed and add the
 * reason rather than clobbering the history with a bare error string.
 */
function withErrorNote(
  content: AgentAssistantContent,
  note: string,
): AgentAssistantContent {
  const text = `\n\n⚠️ External agent run failed: ${note}`;
  if (typeof content === 'string') {
    return content.length > 0 ? content + text : text.trimStart();
  }
  return [...content, { type: 'text', text: text.trimStart() }];
}

export const runExternalAgentTurn = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    /** Model ref (`provider:model-id` or bare); scopes the minted VK. */
    modelRef: v.string(),
    rawPrompt: v.string(),
    systemInstructions: v.optional(v.string()),
    agentKind: v.union(v.literal('claude-code'), v.literal('opencode')),
    streamId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    organizationId: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let mintedKeyId: string | null = null;
    // The streaming assistant message, created BEFORE the run so the turn's tool
    // timeline is persisted incrementally into it (onTimeline below) and survives
    // cancel/timeout/disconnect. Finalized to success/failed at the end; the
    // catch falls back to a fresh failed message only if the run died before this
    // was created.
    let assistantMessageId: string | null = null;
    // Hoisted so the catch can finalize side-effects (it's assigned once the
    // sandbox is resolved, before the message + op row exist).
    let sessionId: string | null = null;
    // Mirror of the most recent content patched into the streaming message, so
    // the catch can mark it failed while preserving the partial tool timeline.
    let lastContent: AgentAssistantContent = '';

    try {
      // 1. Reuse the user's persistent sandbox, or create one (owner = user;
      // thread-owned fallback only when no userId is available). One sandbox
      // per user PER ORG serves all their threads in that org — shared
      // /workspace, per-thread Claude conversation. The owner key is
      // (org, user) so the same user in another org gets a separate sandbox.
      const ownerType = args.userId ? OWNER_TYPE_USER : OWNER_TYPE_THREAD;
      const ownerId = args.userId
        ? userOwnerId(args.organizationId, args.userId)
        : args.threadId;
      let existing = await ctx.runQuery(
        internal.sandbox.session_queries.getActiveSessionByOwner,
        { ownerType, ownerId },
      );
      // Phantom check BEFORE reuse: the spawner reaps sessions (idle/TTL) and
      // its registry is in-memory, so an `active` platform row can point at a
      // session that no longer exists — previously that 404'd the turn and
      // only healed the row for the NEXT send. Probe first: a definitive 404
      // clears the stale rows and falls through to the create path below, so
      // the turn recreates the session transparently. Transport errors throw
      // (a spawner blip must not trigger a spurious recreate).
      if (existing && !(await sessionIsAlive(existing.sessionId))) {
        console.warn(
          '[runExternalAgentTurn] phantom session, recreating in place:',
          existing.sessionId,
        );
        await ctx.runMutation(
          internal.sandbox.session_mutations.destroyActiveSessionsByOwner,
          { ownerType, ownerId },
        );
        existing = null;
      }
      // Lower bound for the --resume lookup: ops from a PRIOR session (same
      // deterministic id, since destroyed) must not be resumed. The reused
      // session uses its own createdAt; a freshly created one uses now (it
      // has no ops yet either way).
      let sessionCreatedAt: number;
      if (existing) {
        sessionId = existing.sessionId;
        sessionCreatedAt = existing.createdAt;
        // Re-push pin to the spawner: its registry is in-memory, so a spawner
        // restart loses the always-on exemption — the platform row is the truth.
        if (existing.pinned === true) {
          await sessionSetPinned(sessionId, true).catch((err) =>
            console.warn('[runExternalAgentTurn] re-pin failed:', err),
          );
        }
      } else {
        sessionId = args.userId
          ? sessionIdForUser(args.organizationId, args.userId)
          : sessionIdForThread(args.threadId);
        sessionCreatedAt = Date.now();
        const rowId = await ctx.runMutation(
          internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
          {
            organizationId: args.organizationId,
            sessionId,
            profile: 'agent',
            ownerType,
            ownerId,
            createdBy: args.userId ?? 'system',
            agentKind: args.agentKind,
          },
        );
        try {
          await sessionCreate({
            sessionId,
            organizationId: args.organizationId,
            profile: 'agent',
          });
        } catch (createErr) {
          await ctx.runMutation(
            internal.sandbox.session_mutations.setSessionStatus,
            { rowId, status: 'failed' },
          );
          throw createErr;
        }
        await ctx.runMutation(
          internal.sandbox.session_mutations.setSessionStatus,
          { rowId, status: 'active', lastActivityAt: Date.now() },
        );

        // Once per session create: push the org's providers + harden the
        // gateway auth posture (idempotent). Best-effort — a hiccup degrades
        // to the prior manual-config behavior rather than killing the turn.
        try {
          const gatewayProviders = await loadOrgGatewayProviders(
            ctx,
            args.organizationId,
          );
          if (gatewayProviders.length > 0) {
            await provisionProviders(gatewayProviders);
          }
          await applyGatewayConfig();
        } catch (provisionErr) {
          console.warn(
            '[runExternalAgentTurn] gateway provisioning failed (continuing):',
            provisionErr,
          );
        }
      }

      // 2. Inject Tier-2 integration credentials. Per-turn (not just at
      // create) so reused sessions pick up rotations; the broker audits
      // every fetch and skips grants without an active credential.
      let grantedSlugs: string[] = [];
      try {
        const creds = await ctx.runAction(
          internal.node_only.sandbox.session_credentials
            .resolveSessionCredentials,
          {
            organizationId: args.organizationId,
            sessionId,
            grants: SESSION_GRANTS,
            kind: 'bootstrap',
          },
        );
        grantedSlugs = creds.git.map((g) => g.slug);
        if (Object.keys(creds.env).length > 0) {
          const denied = await sessionEnvPatch(sessionId, { set: creds.env });
          if (denied.length > 0) {
            console.warn(
              '[runExternalAgentTurn] session env names denied by runnerd:',
              denied,
            );
          }
        }
      } catch (credErr) {
        console.warn(
          '[runExternalAgentTurn] credential injection failed (continuing without):',
          credErr,
        );
      }

      // 3. Mint a per-turn, model-scoped gateway key (revoked in finally).
      // Size its hard budget to the org's rolling-remaining cost (when a cost
      // cap applies) so Bifrost's own ceiling can't exceed the rolling cap even
      // between the seam-level budget checks; fall back to the flat per-turn
      // default when the org is uncapped. The turn-start gate in
      // start_agent_chat.ts already blocked a fully-exhausted budget, so a
      // started turn's remaining is > 0.
      let vkBudgetCents = TURN_BUDGET_CENTS;
      if (args.userId) {
        try {
          const budget = await ctx.runQuery(
            internal.governance.internal_queries.evaluateExternalAgentBudget,
            { organizationId: args.organizationId, userId: args.userId },
          );
          if (budget.rollingRemainingCents !== null) {
            vkBudgetCents = Math.max(
              1,
              Math.floor(budget.rollingRemainingCents),
            );
          }
        } catch (budgetErr) {
          console.warn(
            '[runExternalAgentTurn] budget sizing failed (using default):',
            budgetErr,
          );
        }
      }
      const vk = await mintVirtualKey({
        budgetCents: vkBudgetCents,
        allowedModels: [args.modelRef],
        organizationId: args.organizationId,
        sessionId,
      });
      mintedKeyId = vk.keyId;
      await ctx.runMutation(
        internal.sandbox.session_mutations.insertSessionToken,
        {
          organizationId: args.organizationId,
          sessionId,
          tokenHash: hashVirtualKey(vk.key),
          bifrostKeyId: vk.keyId,
          scope: {
            agentKind: args.agentKind,
            allowedModels: [args.modelRef],
            integrationGrants: grantedSlugs,
            budgetCents: vkBudgetCents,
          },
          expiresAt: Date.now() + 2 * 60 * 60 * 1000,
        },
      );

      // 4. Resume THIS thread's prior conversation, if any (a per-user sandbox
      // holds every thread's conversation — scope by thread, bounded to the
      // current session's lifetime).
      const agentSessionId = await ctx.runQuery(
        internal.sandbox.session_queries.latestAgentSessionId,
        { threadId: args.threadId, sinceStartedAt: sessionCreatedAt },
      );

      debugLog('run', {
        threadId: args.threadId,
        sessionId,
        agentKind: args.agentKind,
        resume: agentSessionId !== null,
      });

      // 5. Run the agent — streams tool-use/text into sandboxSessionOps live.
      // Direct import, NOT ctx.runAction: the action-RPC hop is capped at
      // ~5 minutes in self-hosted Convex, which kills the parent mid-turn
      // (and its finally then revokes the VK under the still-running agent).
      // 5a. Create the streaming assistant message BEFORE the run so its tool
      // timeline is persisted incrementally (onTimeline) and survives an early
      // end / handoff. Finalized to success/failed by handleTurnOutcome.
      const created = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: { role: 'assistant', content: '' },
        metadata: { status: 'pending' },
      });
      assistantMessageId = created.messageId;

      const turn: TurnContext = {
        organizationId: args.organizationId,
        sessionId,
        execId,
        threadId: args.threadId,
        agentKind: args.agentKind,
        modelRef: args.modelRef,
        assistantMessageId: created.messageId,
        mintedKeyId,
        continuationCount: 0,
        ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
        ...(args.userId !== undefined && { userId: args.userId }),
        ...(args.streamId !== undefined && { streamId: args.streamId }),
      };

      // Stamp the durable-job fields on the op row up front so a continuation
      // action OR the recovery watchdog can resume/finalize THIS turn even if
      // this action dies (crash / 30min ceiling).
      await ctx.runMutation(
        internal.sandbox.session_mutations.upsertSessionOp,
        {
          organizationId: args.organizationId,
          sessionId,
          threadId: args.threadId,
          execId,
          kind: 'agent-run',
          status: 'running',
          heartbeatAt: Date.now(),
          deadlineMs: Date.now() + TURN_TIMEOUT_MS,
          assistantMessageId: created.messageId,
          userId: args.userId ?? 'system',
          modelRef: args.modelRef,
          continuationCount: 0,
          ...(mintedKeyId !== null && { mintedKeyId }),
          ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
          ...(args.streamId !== undefined && { streamId: args.streamId }),
        },
      );

      const result = await runAgentInSessionImpl(ctx, {
        organizationId: args.organizationId,
        sessionId,
        threadId: args.threadId,
        execId,
        agentSlug: args.agentKind,
        prompt: args.rawPrompt,
        // The agent CLI sends this verbatim to the gateway, which rejects
        // the colon-qualified Tale form — translate at the boundary.
        model: toGatewayModelRef(args.modelRef),
        ...(agentSessionId !== null && { agentSessionId }),
        ...(args.systemInstructions !== undefined && {
          systemPromptAppend: args.systemInstructions,
        }),
        gatewayBaseUrl: EXTERNAL_AGENT_GATEWAY_URL,
        gatewayToken: vk.key,
        timeoutMs: TURN_TIMEOUT_MS,
        budgetDeadlineMs: Date.now() + ACTION_WINDOW_MS,
        // Durable per-flush mirror: patch the streaming message with the
        // timeline-so-far. This is the record that survives cancel/timeout.
        onTimeline: async (content) => {
          lastContent = content;
          await patchStreamingMessage(ctx, created.messageId, content);
        },
      });

      // 6. Dispatch: TERMINAL → finalize the message + VK revoke + usage ledger;
      // 'continued' → checkpoint to _storage + schedule the continuation action
      // (the >30min handoff; no finalize, the turn keeps going).
      await handleTurnOutcome(ctx, turn, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[runExternalAgentTurn] failed:', {
        threadId: args.threadId,
        agentKind: args.agentKind,
        error: message,
      });
      // Self-heal the phantom: a reused session that's gone spawner-side leaves
      // an `active` platform row that would 404 every future turn. Clear it so
      // the next turn creates a fresh session.
      if (err instanceof SessionNotFoundError) {
        const ownerType = args.userId ? OWNER_TYPE_USER : OWNER_TYPE_THREAD;
        const ownerId = args.userId
          ? userOwnerId(args.organizationId, args.userId)
          : args.threadId;
        await ctx
          .runMutation(
            internal.sandbox.session_mutations.destroyActiveSessionsByOwner,
            { ownerType, ownerId },
          )
          .catch((e) =>
            console.warn('[runExternalAgentTurn] self-heal clear failed:', e),
          );
      }
      try {
        if (assistantMessageId !== null && sessionId !== null) {
          // The streaming message already holds the partial tool timeline
          // (patched live via onTimeline). Mark it failed and APPEND the reason
          // rather than discarding the history with a bare error string — this
          // is the fix for "cancel/timeout wipes the tool calls".
          await patchStreamingMessage(
            ctx,
            assistantMessageId,
            withErrorNote(lastContent, message),
            'failed',
          );
          // Terminal side-effects, exactly-once (the op row was stamped before
          // the run, so the claim succeeds here).
          await finalizeTurnSideEffects(ctx, {
            organizationId: args.organizationId,
            sessionId,
            execId,
            threadId: args.threadId,
            agentKind: args.agentKind,
            modelRef: args.modelRef,
            assistantMessageId,
            mintedKeyId,
            continuationCount: 0,
            ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
            ...(args.userId !== undefined && { userId: args.userId }),
            ...(args.streamId !== undefined && { streamId: args.streamId }),
          });
        } else {
          // Failed before the streaming message + op row existed (e.g. session
          // create). Save a fresh failed bubble; revoke the VK directly (no op
          // row to claim) + clear the generation status.
          await saveMessage(ctx, components.agent, {
            threadId: args.threadId,
            message: {
              role: 'assistant',
              content: `External agent run failed: ${message}`,
            },
            metadata: { status: 'failed', error: message },
          });
          if (mintedKeyId !== null) {
            await revokeVirtualKey(mintedKeyId).catch((e) =>
              console.warn('[runExternalAgentTurn] VK revoke failed:', e),
            );
          }
          if (args.streamId) {
            await ctx
              .runMutation(
                internal.threads.internal_mutations.clearGenerationStatus,
                { threadId: args.threadId, streamId: args.streamId },
              )
              .catch((e) =>
                console.error('[runExternalAgentTurn] clear gen failed:', e),
              );
          }
        }
      } catch (saveErr) {
        console.error(
          '[runExternalAgentTurn] also failed to finalize error:',
          saveErr,
        );
      }
    }

    return null;
  },
});
