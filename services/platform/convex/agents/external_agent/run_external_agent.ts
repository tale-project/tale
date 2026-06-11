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
  hashVirtualKey,
  mintVirtualKey,
  revokeVirtualKey,
  toGatewayModelRef,
} from '../../node_only/sandbox/bifrost_admin';
import {
  sessionCreate,
  sessionEnvPatch,
} from '../../node_only/sandbox/helpers/session_client';
import { runAgentInSessionImpl } from '../../node_only/sandbox/run_agent';

const debugLog = createDebugLog(
  'DEBUG_EXTERNAL_AGENT',
  '[runExternalAgentTurn]',
);

const OWNER_TYPE = 'thread';
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

/** Deterministic spawner session id for a thread (ID_ALPHABET_RE-safe). */
function sessionIdForThread(threadId: string): string {
  return `thr-${threadId}`.slice(0, 64);
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

    try {
      // 1. Reuse the thread's active session, or create one (owner = thread).
      const existing = await ctx.runQuery(
        internal.sandbox.session_queries.getActiveSessionByOwner,
        { ownerType: OWNER_TYPE, ownerId: args.threadId },
      );
      let sessionId: string;
      if (existing) {
        sessionId = existing.sessionId;
      } else {
        sessionId = sessionIdForThread(args.threadId);
        const rowId = await ctx.runMutation(
          internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
          {
            organizationId: args.organizationId,
            sessionId,
            profile: 'agent',
            ownerType: OWNER_TYPE,
            ownerId: args.threadId,
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

      // 4. Resume the in-sandbox agent's prior conversation if any.
      const agentSessionId = await ctx.runQuery(
        internal.sandbox.session_queries.latestAgentSessionId,
        { sessionId },
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

      // 6. Save the agent's final reply into the thread (chat UI renders it).
      const finalText =
        result.finalText ??
        (result.status === 'completed'
          ? 'Agent run completed.'
          : `Agent run ${result.status}.`);
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: { role: 'assistant', content: finalText },
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
      // Per-turn key is single-use; revoke so a leaked key can't be replayed.
      if (mintedKeyId !== null) {
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
