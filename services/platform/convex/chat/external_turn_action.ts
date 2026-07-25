'use node';

/**
 * The external-agent turn's KICK: one chat message answered by a third-party
 * harness (Claude Code, Codex, …) inside the thread's sandbox session.
 *
 * The turn is ASYNC, and the kick is THIN by contract: the composer AWAITS
 * this action, and a browser-held Convex action promise does not survive a
 * websocket reconnect — a kick that also did the cold session setup and the
 * first drain window (observed: 100s) turned every reconnect into a false
 * "failed to send" toast for a turn that ran on to success. So the kick does
 * only the refusal-capable checks and the bookkeeping writes (user message,
 * assistant placeholder, generation, op row), schedules
 * `startExternalTurnExec`, and returns: `completed` means ACCEPTED — the reply
 * itself streams into the `messages`/`generations` rows the client
 * subscribes to.
 *
 * The op row is opened HERE, before the exec exists, so the recovery sweep
 * covers every later death: if the scheduled start action dies at any step,
 * the op's heartbeat goes stale and `recoverAbandonedExternalTurns` probes the
 * exec (a 404 reads as gone) and settles the turn. Session ensure, key mint,
 * skill staging, exec start, and the first drain window all live in
 * `startExternalTurnExec`; a turn still running at that window's close
 * self-chains through `chat.external_turn_drive.driveExternalTurn`.
 *
 * V1 serves the MANAGED credential path (org provider credentials reach the
 * container only as a session-scoped gateway key). The agent's equipped
 * connectors (project binding ∪ conversation picks) become the token's
 * integration grants, and a turn with any mounts the in-image
 * `tale-integrations-mcp` bridge — dispatch runs server-side, read-only in
 * V1. Subscription credentials are still deferred.
 */

import { randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { sessionCancelExec } from '../node_only/sandbox/helpers/session_client';
import { resolveGatewayRouting } from '../node_only/sandbox/llm_gateway_admin';
import {
  BROKERABLE_GRANTS,
  resolveSessionCredentialEnv,
} from '../node_only/sandbox/session_credentials';
import { WORKSPACE_READ_TOOLS } from '../node_only/sandbox/workspace_tools_bridge';
import { sessionIdForUser } from '../sandbox/session_naming';
import {
  buildExternalTurnExec,
  EXTERNAL_TURN_DEADLINE_MS,
  drainExternalTurnWindow,
  ensureAgentSession,
  finalizeExternalTurn,
  integrationsBridgeUrlForSessions,
  isManagedHarness,
  newExecId,
  openExternalTurnOp,
  provisionTurnGatewayToken,
  resolveManagedModel,
  stageSkills,
  type ExternalTurnScope,
} from './external_turn_shared';

/** Append an assistant message carrying a refusal, with no generation opened —
 * used before the turn actually starts (bad harness, no model, missing
 * thread). Returns the refusal shape the seam surfaces. */
async function refuseBeforeStart(
  ctx: ActionCtx,
  scope: Pick<ExternalTurnScope, 'organizationId' | 'threadId'>,
  reason: string,
): Promise<{ status: 'refused'; reason: string }> {
  await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
    organizationId: scope.organizationId,
    threadId: scope.threadId,
    role: 'assistant',
    parts: [{ type: 'text', text: reason }],
    blockedReason: reason,
  });
  return { status: 'refused', reason };
}

interface ExternalTurnKickArgs {
  organizationId: string;
  threadId: string;
  userId: string;
  userText: string;
  harness: string;
  /** The composer's model pick; absent falls back to the org's first
   * directly-served model. */
  modelId?: string;
}

/**
 * The kick body, auth already done — exported for the unit tests, which
 * drive it with a mocked ctx to lock the thin-kick contract: refusals are
 * synchronous, the op row exists before the schedule, and the kick itself
 * never talks to the sandbox.
 */
export async function kickExternalTurn(
  ctx: ActionCtx,
  args: ExternalTurnKickArgs,
): Promise<{ status: 'completed' | 'refused'; reason?: string }> {
  const scope: ExternalTurnScope = {
    organizationId: args.organizationId,
    threadId: args.threadId,
    userId: args.userId,
  };

  const thread = await ctx.runQuery(
    internal.chat.threads.getOwnedThreadInternal,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      threadId: args.threadId,
    },
  );
  if (thread === null) {
    return { status: 'refused', reason: 'This conversation does not exist.' };
  }

  // The managed lane can only run a managed-capable harness — refuse a
  // byo-only one (e.g. Cursor) up front rather than build an inert exec that
  // hangs to the turn deadline. Defensive: the composer already filters these
  // out of its picker, but a stale thread pin or a direct API call could still
  // name one.
  if (!isManagedHarness(args.harness)) {
    return {
      status: 'refused',
      reason: `The third-party agent "${args.harness}" can't run here yet — it needs its own credentials, which this chat lane does not support.`,
    };
  }

  // At most one turn per thread. Refuse a concurrent send BEFORE appending
  // anything, so a second send can't overwrite the running turn's generation
  // and orphan its exec (and double-charge on finalize).
  const busy = await ctx.runQuery(
    internal.chat.generations.hasLiveGenerationInternal,
    { organizationId: args.organizationId, threadId: args.threadId },
  );
  if (busy) {
    return {
      status: 'refused',
      reason: 'This conversation is already generating a response.',
    };
  }

  await ctx.runMutation(internal.chat.messages.appendMessageInternal, {
    organizationId: args.organizationId,
    threadId: args.threadId,
    role: 'user',
    parts: [{ type: 'text', text: args.userText }],
  });

  const model = await resolveManagedModel(
    ctx,
    args.organizationId,
    args.modelId,
  );
  if (!model.ok) {
    return refuseBeforeStart(ctx, scope, model.reason);
  }
  const routing = resolveGatewayRouting(model.providerSlug, model.modelId);
  const execId = newExecId();
  const streamId = randomUUID();
  // One wall-clock cutoff for the whole turn, shared by the token expiry, the
  // op row's deadline, and the drive loop's reschedule guard.
  const deadlineAt = Date.now() + EXTERNAL_TURN_DEADLINE_MS;

  // The assistant message the reply streams into, and the generation that
  // carries the drainer's re-attach state.
  const { id: messageId } = await ctx.runMutation(
    internal.chat.messages.appendMessageInternal,
    {
      organizationId: args.organizationId,
      threadId: args.threadId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    },
  );
  await ctx.runMutation(internal.chat.generations.beginGenerationInternal, {
    organizationId: args.organizationId,
    threadId: args.threadId,
    streamId,
    messageId,
    external: {
      execId,
      lastSeq: 0,
      harness: args.harness,
      providerSlug: model.providerSlug,
      gatewayModel: routing.gatewayModel,
    },
  });

  // Open the op row BEFORE handing off: the session id is deterministic, so
  // no sandbox call is needed, and from this point every death of the
  // scheduled start action leaves a stale-heartbeat op the recovery sweep
  // settles (probe → gone → finalize). The gateway key id is patched on
  // later, the moment it is minted.
  const sessionId = sessionIdForUser(args.organizationId, args.userId);
  await openExternalTurnOp(ctx, {
    scope,
    sessionId,
    execId,
    messageId,
    providerSlug: model.providerSlug,
    gatewayModel: routing.gatewayModel,
    streamId,
    deadlineMs: deadlineAt,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.chat.external_turn_action.startExternalTurnExec,
    {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: args.userId,
      userText: args.userText,
      harness: args.harness,
      providerSlug: model.providerSlug,
      modelId: model.modelId,
      gatewayModel: routing.gatewayModel,
      execId,
      streamId,
      messageId,
      deadlineAt,
    },
  );

  return { status: 'completed' };
}

export const startExternalTurn = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    harness: v.string(),
    // The composer's per-turn model pick; absent falls back to the org's
    // first directly-served model.
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(v.literal('completed'), v.literal('refused')),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: 'completed' | 'refused'; reason?: string }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    return kickExternalTurn(ctx, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: auth.userId,
      userText: args.userText,
      harness: args.harness,
      ...(args.modelId !== undefined ? { modelId: args.modelId } : {}),
    });
  },
});

interface ExternalTurnStartArgs {
  organizationId: string;
  threadId: string;
  userId: string;
  userText: string;
  harness: string;
  providerSlug: string;
  modelId: string;
  gatewayModel: string;
  execId: string;
  streamId: string;
  messageId: Id<'messages'>;
  deadlineAt: number;
}

/**
 * The scheduled start body — exported for the unit tests, which lock the
 * async honesty contract: every failure before the exec exists still settles
 * the turn (reason under the message, op row terminal, generation gone), and
 * a turn the user stopped during setup bails before minting a key or
 * starting an exec.
 */
export async function runExternalTurnStart(
  ctx: ActionCtx,
  args: ExternalTurnStartArgs,
): Promise<void> {
  const scope: ExternalTurnScope = {
    organizationId: args.organizationId,
    threadId: args.threadId,
    userId: args.userId,
  };
  // Deterministic — known even when the session ensure throws, so the catch
  // below can always finalize through the op row the kick opened.
  const sessionId = sessionIdForUser(args.organizationId, args.userId);
  try {
    await ensureAgentSession(ctx, scope);

    // The user may have stopped the turn while the session was coming up —
    // that finalize already settled the op and deleted the generation. Bail
    // BEFORE minting a key or starting the exec: nothing to revoke, nothing
    // left running. (A different execId means a newer turn owns the thread.)
    const live = await ctx.runQuery(
      internal.chat.generations.getExternalTurnStateInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (live === null || live.external.execId !== args.execId) return;

    const thread = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        threadId: args.threadId,
      },
    );
    if (thread === null) {
      await finalizeExternalTurn(ctx, {
        scope,
        sessionId,
        execId: args.execId,
        messageId: args.messageId,
        providerSlug: args.providerSlug,
        gatewayModel: args.gatewayModel,
        fallbackText: '',
        errored: true,
        harness: args.harness,
        reason: 'This conversation no longer exists.',
      });
      return;
    }

    // A project thread runs its agent pre-equipped with the project's
    // per-agent binding (the persistent baseline), unioned with the picks
    // this conversation made in the composer — selecting one must never drop
    // the other. The binding is keyed by harness slug. Resolved BEFORE the
    // token mint: the connector union is the token's integration grant set.
    const projectBinding = await ctx.runQuery(
      internal.projects.internal_queries.getProjectAgentCapabilitiesForThread,
      { threadId: args.threadId, agentId: args.harness },
    );
    const skillSlugs = [
      ...new Set([
        ...projectBinding.skills,
        ...(thread.capabilities?.skills ?? []),
      ]),
    ];
    const connectorSlugs = [
      ...new Set([
        ...projectBinding.connectors,
        ...(thread.capabilities?.connectors ?? []),
      ]),
    ];
    // First-party workspace reads (knowledge + Documents hub) are granted to
    // every managed external turn: they read only the org's OWN data, run as
    // the turn's user, org-scoped and audited — so a default read grant is
    // honest without a per-agent picker. Writes are not in this set.
    const toolGrants = [...WORKSPACE_READ_TOOLS];

    // Tier-2 broker: the explicitly BROKERABLE grants among the turn's
    // connectors (github today) resolve to in-container env — GITHUB_TOKEN
    // for the git CLI via the in-image credential helper — while every other
    // connector stays dispatch-only behind the MCP bridge. Per-exec env, not
    // session env: the grant is per-turn, the session per-user, and the exec
    // overlay dies with the turn, so a later ungranted turn never inherits
    // the token. The owner's git author identity rides along unconditionally.
    // Best-effort: a broker failure downgrades the turn (git reports its
    // missing credentials), never kills it.
    let brokerEnv: Record<string, string> = {};
    try {
      const brokered = await resolveSessionCredentialEnv(ctx, {
        organizationId: args.organizationId,
        sessionId,
        grants: BROKERABLE_GRANTS.filter((grant) =>
          connectorSlugs.includes(grant),
        ),
        kind: 'bootstrap',
      });
      brokerEnv = brokered.env;
    } catch (err) {
      console.warn(
        '[external-turn] credential broker failed (continuing without):',
        err,
      );
    }
    const { token, keyId } = await provisionTurnGatewayToken(
      ctx,
      scope,
      sessionId,
      { providerSlug: args.providerSlug, modelId: args.modelId },
      {
        harness: args.harness,
        gatewayModel: args.gatewayModel,
        expiresAt: args.deadlineAt,
        integrationGrants: connectorSlugs,
        toolGrants,
      },
    );
    // Patch the freshly minted key id onto the op row the kick opened, so
    // every finalize path (drain, cancel, deadline, recovery) can revoke it.
    await openExternalTurnOp(ctx, {
      scope,
      sessionId,
      execId: args.execId,
      messageId: args.messageId,
      providerSlug: args.providerSlug,
      gatewayModel: args.gatewayModel,
      streamId: args.streamId,
      deadlineMs: args.deadlineAt,
      mintedKeyId: keyId,
    });
    const instructions = await stageSkills(ctx, scope, sessionId, skillSlugs);
    const exec = buildExternalTurnExec({
      harness: args.harness,
      gatewayModel: args.gatewayModel,
      gatewayToken: token,
      instructions,
      prompt: args.userText,
      ...(thread.externalResume !== undefined
        ? { resume: thread.externalResume }
        : {}),
      // Mount the MCP bridge when the agent can reach EITHER surface —
      // connectors (integrations) or workspace tools. One bridge serves both
      // (`…/api/integrations` + the derived `…/api/tools`), so one URL covers
      // them. With workspace reads granted by default, this is effectively
      // every managed turn; a turn with neither carries no bridge.
      ...(connectorSlugs.length > 0 || toolGrants.length > 0
        ? { bridgeUrl: integrationsBridgeUrlForSessions() }
        : {}),
      ...(Object.keys(brokerEnv).length > 0 ? { extraEnv: brokerEnv } : {}),
      execId: args.execId,
    });

    const outcome = await drainExternalTurnWindow(ctx, {
      scope,
      sessionId,
      execId: args.execId,
      messageId: args.messageId,
      harness: args.harness,
      providerSlug: args.providerSlug,
      gatewayModel: args.gatewayModel,
      start: exec,
    });

    if (outcome.kind === 'gone') {
      await finalizeExternalTurn(ctx, {
        scope,
        sessionId,
        execId: args.execId,
        messageId: args.messageId,
        providerSlug: args.providerSlug,
        gatewayModel: args.gatewayModel,
        fallbackText: '',
        errored: true,
        harness: args.harness,
        reason: 'The sandbox session ended before the turn could run.',
      });
      return;
    }
    if (outcome.kind === 'continue') {
      await ctx.scheduler.runAfter(
        0,
        internal.chat.external_turn_drive.driveExternalTurn,
        {
          organizationId: args.organizationId,
          threadId: args.threadId,
          userId: args.userId,
          deadlineAt: args.deadlineAt,
        },
      );
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : 'The third-party agent turn failed.';
    console.error('[external-turn] start failed:', error);
    await finalizeExternalTurn(ctx, {
      scope,
      sessionId,
      execId: args.execId,
      messageId: args.messageId,
      providerSlug: args.providerSlug,
      gatewayModel: args.gatewayModel,
      fallbackText: '',
      errored: true,
      harness: args.harness,
      reason: `The third-party agent could not run: ${reason}`,
    });
  }
}

/**
 * Session ensure + key mint + skill staging + exec start + the first drain
 * window — everything slow, scheduled off the kick so no browser-held action
 * spans it. Failures here are still user-visible: the shared finalize writes
 * the reason under the assistant message and settles the generation.
 */
export const startExternalTurnExec = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userId: v.string(),
    userText: v.string(),
    harness: v.string(),
    providerSlug: v.string(),
    modelId: v.string(),
    gatewayModel: v.string(),
    execId: v.string(),
    streamId: v.string(),
    messageId: v.id('messages'),
    deadlineAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await runExternalTurnStart(ctx, args);
    return null;
  },
});

/**
 * Stop the caller's in-flight external turn on a thread. Cancels the harness exec
 * in the sandbox (SIGTERM→SIGKILL via runnerd) and settles the turn through the
 * shared finalize: the exactly-once claim revokes the turn's gateway VK, stamps
 * the op row `cancelled`, and deletes the generation so the composer unlocks.
 * The partial reply that already streamed is kept, with a stop note under it.
 *
 * Idempotent and owner-scoped: a thread with no live external turn (already
 * settled, or not the caller's) returns `{stopped:false}`. Racing the drain
 * loop is safe — whichever finalizer wins the claim runs the side-effects once;
 * the loser bails.
 */
export const stopExternalTurn = action({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.object({ stopped: v.boolean() }),
  handler: async (ctx, args): Promise<{ stopped: boolean }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const thread = await ctx.runQuery(
      internal.chat.threads.getOwnedThreadInternal,
      {
        organizationId: args.organizationId,
        userId: auth.userId,
        threadId: args.threadId,
      },
    );
    if (thread === null) return { stopped: false };

    const state = await ctx.runQuery(
      internal.chat.generations.getExternalTurnStateInternal,
      { organizationId: args.organizationId, threadId: args.threadId },
    );
    if (state === null) return { stopped: false };

    const scope: ExternalTurnScope = {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: auth.userId,
    };
    const sessionId = sessionIdForUser(args.organizationId, auth.userId);
    const { messageId, external } = state;

    await sessionCancelExec(sessionId, external.execId).catch((err) =>
      console.warn('[external-turn] stop exec cancel failed:', err),
    );
    await finalizeExternalTurn(ctx, {
      scope,
      sessionId,
      execId: external.execId,
      messageId,
      providerSlug: external.providerSlug,
      gatewayModel: external.gatewayModel,
      fallbackText: '',
      errored: false,
      cancelled: true,
      harness: external.harness,
      reason: 'You stopped this response.',
    });
    return { stopped: true };
  },
});
