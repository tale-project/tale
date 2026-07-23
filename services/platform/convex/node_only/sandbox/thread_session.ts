'use node';

/**
 * Per-thread persistent sandbox session lifecycle for chat `run_code`
 * (Phase 2 of the persistent-session design — see
 * `services/sandbox/docs/run-code-persistent-sessions.md`).
 *
 * These are the reusable lifecycle actions. They reuse the exact session
 * machinery external agents run on (`session_mutations` / `session_client`),
 * keyed per-thread (`thr-<threadId>`, `ownerType: 'thread'`) so one thread's
 * packages/files never leak into another.
 *
 * The session is TURN-scoped: `ensureThreadSession` creates it lazily on the
 * first run_code call of a turn and every later call in that turn reuses it
 * warm; the turn's finally schedules `teardownThreadSessionAtTurnEnd`
 * (session_teardown.ts), which destroys the container + workspace unless a
 * sibling turn on the thread still has a live exec. It never idles across
 * turns. {@link destroyThreadSession} is the thread-delete teardown for
 * whatever the turn-end path left behind.
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { internalAction } from '../../_generated/server';
import { resolveOrgVisionModel } from '../../lib/providers/resolve_vision_model';
import { sessionIdForThread } from '../../sandbox/session_naming';
import { buildProviderProvision } from './gateway_provisioning';
import {
  sessionCreate,
  sessionDestroy,
  sessionEnvPatch,
  sessionIsAlive,
} from './helpers/session_client';
import {
  applyGatewayConfig,
  hashVirtualKey,
  mintVirtualKey,
  provisionProviders,
  resolveGatewayRouting,
} from './llm_gateway_admin';

const OWNER_TYPE = 'thread';
// run_code is untrusted user code — keep the hardened one-shot posture
// (uid 65534). (A long-lived `run_code` profile that also drops the
// cumulative-CPU ulimit is a follow-up on the sandbox side.)
const PROFILE = 'default' as const;

// Vision lane (tale-vision CLI in run_code execs): per-session gateway key
// budget + TTL. Small on purpose — vision-only, one turn's worth of images.
const VISION_BUDGET_CENTS = (() => {
  const parsed = Number(process.env.RUN_CODE_VISION_BUDGET_CENTS ?? '200');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
})();
const VISION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
// Always the sandbox-network alias (hardcoded in the runtime NO_PROXY); kept
// separate from SANDBOX_LLM_GATEWAY_URL so host-run convex doesn't leak a
// host-only URL into the container (same split as the external-agent path).
const VISION_GATEWAY_URL =
  process.env.EXTERNAL_AGENT_GATEWAY_URL ?? 'http://sandbox-llm-gateway:8080';

/**
 * Arm the vision lane on a freshly (re)created thread session: mint a
 * gateway virtual key scoped to ONLY the org's auto-selected vision model
 * (`resolveOrgVisionModel` — cheapest gateway-servable vision-capable model
 * on the org's default credentials) and patch
 * `TALE_GATEWAY_URL`/`TALE_GATEWAY_TOKEN`/`TALE_VISION_MODEL` into the
 * session env store, so the baked `tale-vision` CLI works from run_code
 * execs.
 *
 * Best-effort BY DESIGN — a posture difference from the external-agent path,
 * where a gateway-auth failure fails the turn (fail-closed): here vision is
 * a convenience capability, so ANY failure (no vision-capable model, gateway
 * down, provisioning error) logs, and the session comes up without vision —
 * the CLI then exits 2 with an actionable message. Ordering matters: the
 * token row is inserted BEFORE the env patch so a crash can never leave an
 * injected-but-untracked key; turn-end teardown revokes every token row of
 * the session (session_teardown.ts) including stale ones from mid-turn
 * recreates. A reaped container always needs a fresh mint — the plaintext
 * key exists only in the container's in-memory env store, never on the
 * platform.
 */
export async function armVisionLane(
  ctx: ActionCtx,
  args: { organizationId: string; threadId: string; sessionId: string },
): Promise<void> {
  const started = Date.now();
  try {
    const vision = await resolveOrgVisionModel(ctx, args.organizationId);
    if (!vision) {
      console.warn(
        `[thread_session] vision lane not armed for ${args.sessionId}: no gateway-servable vision-capable model is available to this organization (run_code continues without tale-vision)`,
      );
      return;
    }
    const { gatewayModel } = resolveGatewayRouting(
      vision.providerSlug,
      vision.modelId,
    );

    // Chat sessions never provision the gateway otherwise. mintVirtualKey
    // fails closed on a missing provider key, so a provisioning failure
    // surfaces as a skipped lane, never an over-permissive key (same
    // layering as the external-agent path).
    const provision = await buildProviderProvision(ctx, {
      organizationId: args.organizationId,
      providerSlug: vision.providerSlug,
    });
    if (provision) {
      await provisionProviders(args.organizationId, [provision]);
    }
    await applyGatewayConfig();

    const minted = await mintVirtualKey({
      budgetCents: VISION_BUDGET_CENTS,
      allowedModels: [
        { providerSlug: vision.providerSlug, modelId: vision.modelId },
      ],
      organizationId: args.organizationId,
      sessionId: args.sessionId,
    });
    await ctx.runMutation(
      internal.sandbox.session_mutations.insertSessionToken,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        tokenHash: hashVirtualKey(minted.key),
        llmGatewayKeyId: minted.keyId,
        scope: {
          agentKind: 'run_code_vision',
          allowedModels: [gatewayModel],
          integrationGrants: [],
          toolGrants: [],
          budgetCents: VISION_BUDGET_CENTS,
          threadId: args.threadId,
        },
        expiresAt: Date.now() + VISION_TOKEN_TTL_MS,
      },
    );
    const denied = await sessionEnvPatch(args.sessionId, {
      set: {
        TALE_GATEWAY_URL: VISION_GATEWAY_URL,
        TALE_GATEWAY_TOKEN: minted.key,
        TALE_VISION_MODEL: gatewayModel,
      },
    });
    if (denied.length > 0) {
      console.warn(
        `[thread_session] vision env names denied by runnerd:`,
        denied,
      );
    }
    console.log(
      `[thread_session] vision lane armed for ${args.sessionId} in ${Date.now() - started}ms (model ${gatewayModel})`,
    );
  } catch (err) {
    console.warn(
      `[thread_session] vision lane not armed for ${args.sessionId} after ${Date.now() - started}ms (run_code continues without tale-vision):`,
      err,
    );
  }
}

/**
 * Ensure the thread's session exists and is live; create or resume it.
 * Returns its deterministic `sessionId`. Idempotent within a turn: a warm
 * session is reused, a reaped one is recreated against the same id (its
 * preserved workspace re-attaches). TURN-scoped: the chat turn's finally
 * destroys the session when the turn ends (`teardownThreadSessionAtTurnEnd`,
 * spared while a sibling turn's exec is live) — it amortizes the run_code
 * calls of one turn, never idles across turns.
 */
export const ensureThreadSession = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    createdBy: v.string(),
  },
  returns: v.object({ sessionId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const sessionId = sessionIdForThread(args.threadId);
    const existing = await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: OWNER_TYPE, ownerId: args.threadId },
    );

    if (existing !== null) {
      // Container actually up → reuse as-is.
      if (await sessionIsAlive(sessionId)) {
        return { sessionId, created: false };
      }
      // Row is live but the container was reaped/stopped — recreate against
      // the same id to re-attach the preserved workspace, then normalize the
      // row.
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: PROFILE,
      });
      await ctx.runMutation(
        internal.sandbox.session_mutations.resumeStoppedSession,
        { organizationId: args.organizationId, sessionId },
      );
      await armVisionLane(ctx, {
        organizationId: args.organizationId,
        threadId: args.threadId,
        sessionId,
      });
      return { sessionId, created: false };
    }

    // No row yet — reserve a slot (per-owner + per-org caps enforced there)
    // and create fresh. A reserve conflict / capacity wait throws and
    // surfaces to the model as a run_code failure (there is no one-shot
    // fallback path).
    const rowId = await ctx.runMutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: args.organizationId,
        sessionId,
        profile: PROFILE,
        ownerType: OWNER_TYPE,
        ownerId: args.threadId,
        createdBy: args.createdBy,
      },
    );
    try {
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: PROFILE,
      });
    } catch (err) {
      // Roll the reserved row out of the way so a retry isn't blocked by the
      // per-owner cap.
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId, status: 'failed' },
      );
      throw err;
    }
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'active',
    });
    await armVisionLane(ctx, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      sessionId,
    });
    return { sessionId, created: true };
  },
});

/**
 * Tear down a thread's session for good (thread delete): destroy the
 * container + its preserved workspace, then mark the row destroyed.
 * Best-effort and idempotent — an already-gone session/row is a no-op.
 */
export const destroyThreadSession = internalAction({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sessionId = sessionIdForThread(args.threadId);
    try {
      await sessionDestroy(sessionId);
    } catch (err) {
      console.warn(`[thread_session] destroy(${sessionId}) failed:`, err);
    }
    const existing = await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: OWNER_TYPE, ownerId: args.threadId },
    );
    if (existing !== null) {
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId: existing._id, status: 'destroyed' },
      );
    }
    return null;
  },
});
