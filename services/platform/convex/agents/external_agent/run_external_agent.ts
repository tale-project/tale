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
import {
  applyGatewayConfig,
  getVirtualKeySpendCents,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  revokeVirtualKey,
  toGatewayModelRef,
} from '../../node_only/sandbox/bifrost_admin';
import {
  sessionCreate,
  sessionEnvPatch,
} from '../../node_only/sandbox/helpers/session_client';
import { runAgentInSessionImpl } from '../../node_only/sandbox/run_agent';
import { loadOrgGatewayProviders } from '../../providers/file_actions';
import {
  sessionIdForThread,
  sessionIdForUser,
  userOwnerId,
} from '../../sandbox/session_naming';

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
// Per-turn LLM budget for an external-agent run (cents). Operator-tunable.
const TURN_BUDGET_CENTS = Number(
  process.env.EXTERNAL_AGENT_TURN_BUDGET_CENTS ?? '500',
);

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
    // Token totals the agent reported (often 0 through non-Anthropic gateways);
    // cost comes from the VK budget in the finally. Captured here so usage is
    // attributed even if the turn later throws.
    let turnTokens: { inputTokens: number; outputTokens: number } | null = null;

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
      const existing = await ctx.runQuery(
        internal.sandbox.session_queries.getActiveSessionByOwner,
        { ownerType, ownerId },
      );
      let sessionId: string;
      // Lower bound for the --resume lookup: ops from a PRIOR session (same
      // deterministic id, since destroyed) must not be resumed. The reused
      // session uses its own createdAt; a freshly created one uses now (it
      // has no ops yet either way).
      let sessionCreatedAt: number;
      if (existing) {
        sessionId = existing.sessionId;
        sessionCreatedAt = existing.createdAt;
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
      const vk = await mintVirtualKey({
        budgetCents: TURN_BUDGET_CENTS,
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
            budgetCents: TURN_BUDGET_CENTS,
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
      });

      // 6. Capture token totals (cost is read from the VK budget in finally —
      // see the usage attribution there).
      if (result.usage) {
        turnTokens = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        };
      }

      // 7. Save the agent's reply into the thread. Persist the FULL tool-call
      // timeline as the assistant message content (reasoning + tool-call/
      // tool-result + final text) so a completed turn keeps its tool history in
      // chat history (listUIMessages reconstructs the tool-<name> UI parts the
      // renderer shows). Fall back to plain text when there was no timeline
      // (trivial turn) or none was produced (errored early).
      const finalText =
        result.finalText ??
        (result.status === 'completed'
          ? 'Agent run completed.'
          : `Agent run ${result.status}.`);
      const content =
        result.assistantContent !== undefined &&
        // a non-empty parts array, or a non-empty string
        (typeof result.assistantContent !== 'string' ||
          result.assistantContent.length > 0)
          ? result.assistantContent
          : finalText;
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: { role: 'assistant', content },
        ...(result.status !== 'completed' && {
          metadata: { status: 'failed', error: `agent ${result.status}` },
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[runExternalAgentTurn] failed:', {
        threadId: args.threadId,
        agentKind: args.agentKind,
        error: message,
      });
      try {
        await saveMessage(ctx, components.agent, {
          threadId: args.threadId,
          message: {
            role: 'assistant',
            content: `External agent run failed: ${message}`,
          },
          metadata: { status: 'failed', error: message },
        });
      } catch (saveErr) {
        console.error(
          '[runExternalAgentTurn] also failed to save error message:',
          saveErr,
        );
      }
    } finally {
      // Attribute spend + revoke the single-use key. Read the VK's cumulative
      // budget for cost (the only signal that works through every gateway
      // path), pair it with the agent's reported tokens (often 0 via
      // non-Anthropic upstreams), and write ONE usageLedger row. No cron —
      // the per-turn VK lifecycle is the natural attribution point.
      if (mintedKeyId !== null) {
        try {
          // Bifrost v1.4.8 aggregates per-VK spend asynchronously (~seconds of
          // lag) and exposes no token breakdown — so poll the budget briefly
          // until it lands. Best-effort and bounded (the user's answer is
          // already saved above; this only delays VK revoke + status clear).
          let costCents: number | null = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            costCents = await getVirtualKeySpendCents(mintedKeyId);
            if ((costCents ?? 0) > 0) break;
            await new Promise((r) => setTimeout(r, 800));
          }
          const inputTokens = turnTokens?.inputTokens ?? 0;
          const outputTokens = turnTokens?.outputTokens ?? 0;
          if (inputTokens > 0 || outputTokens > 0 || (costCents ?? 0) > 0) {
            const colon = args.modelRef.indexOf(':');
            const provider =
              colon === -1 ? undefined : args.modelRef.slice(0, colon);
            await ctx.runMutation(
              internal.governance.internal_mutations.incrementUsageLedger,
              {
                organizationId: args.organizationId,
                userId: args.userId ?? 'system',
                inputTokens,
                outputTokens,
                costEstimateCents: costCents ?? 0,
                timestamp: Date.now(),
                agentSlug: args.agentSlug ?? args.agentKind,
                model: args.modelRef,
                ...(provider ? { provider } : {}),
              },
            );
          }
        } catch (usageErr) {
          console.warn('[runExternalAgentTurn] usage sync failed:', usageErr);
        }
        try {
          await revokeVirtualKey(mintedKeyId);
        } catch (revokeErr) {
          console.warn('[runExternalAgentTurn] VK revoke failed:', revokeErr);
        }
      }
      if (args.streamId) {
        try {
          await ctx.runMutation(
            internal.threads.internal_mutations.clearGenerationStatus,
            { threadId: args.threadId, streamId: args.streamId },
          );
        } catch (clearErr) {
          console.error(
            '[runExternalAgentTurn] failed to clear generation status:',
            clearErr,
          );
        }
      }
    }

    return null;
  },
});
