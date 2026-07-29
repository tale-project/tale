/**
 * Deploy DRAIN control plane (V8). Mirrors the sandbox spawner's
 * `/v1/drain` + `/v1/drain-status` pattern, but for the Convex backend.
 *
 * `tale deploy` recreates the convex container in-place on a version change,
 * which restarts the backend and kills every in-flight action — including
 * non-durable chat generation. Before recreating, the CLI calls `beginDrain`
 * (the new-turn gate in `agents/chat_turn.ts` then refuses new turns so the
 * client retries onto the restarted backend) and polls `drainStatus` until
 * `inFlight === 0`, then recreates and calls `endDrain`.
 *
 * Reachable from the CLI via `bunx convex run` with the admin key (no user
 * identity), exactly like the migration entrypoints and `provisioning:*` — so
 * these are raw `internalMutation`/`internalQuery`, not the RLS wrappers.
 */

import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Hard expiry for a drain flag. Set well above the CLI's drain budget
 * (`DRAIN_TIMEOUT_MS` in `tools/cli/.../drain-convex.ts`, 3 min) so it never
 * fires during a healthy deploy, but bounds the blast radius of a deploy that
 * dies after `beginDrain` and never reaches `endDrain` — chats self-heal in 15
 * min instead of being refused forever.
 */
const DRAIN_MAX_MS = 15 * 60 * 1000;

const SINGLETON = 'singleton' as const;

/** Whether new chat turns should currently be refused (drain active + unexpired). */
export async function isDrainingNow(
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> {
  const row = await ctx.db
    .query('backendControl')
    .withIndex('by_key', (q) => q.eq('key', SINGLETON))
    .first();
  if (!row || !row.draining) return false;
  // Unexpired drain only — a stale flag (crashed deploy) reads as "not draining".
  return row.drainExpiresAt === undefined || Date.now() < row.drainExpiresAt;
}

/**
 * Count threads with a genuinely in-flight generation: `generating` AND still
 * fresh (a stale lock means the action is already dead — not something to wait
 * on).
 *
 * The freshness probe (`isGenerationFresh`, from the moved
 * `convex/threads/generation_liveness.ts`) is gone with the rest of the chat
 * pipeline. Chat generation itself is offline — nothing schedules a turn, so
 * `threadMetadata.generationStatus` can never be genuinely `'generating'`
 * again — so this always reports 0 rather than querying the (now
 * permanently empty, modulo stale pre-rewrite rows) `by_generationStatus`
 * index. `beginDrain`/`drainStatus` and the CLI's drain-status poll see
 * `inFlight: 0` immediately, which is simply true.
 */
export async function countActiveGenerations(
  _ctx: QueryCtx | MutationCtx,
): Promise<number> {
  return 0;
}

async function getSingleton(ctx: MutationCtx) {
  return ctx.db
    .query('backendControl')
    .withIndex('by_key', (q) => q.eq('key', SINGLETON))
    .first();
}

export const beginDrain = internalMutation({
  args: {},
  returns: v.object({ inFlight: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const patch = {
      key: SINGLETON,
      draining: true,
      drainStartedAt: now,
      drainExpiresAt: now + DRAIN_MAX_MS,
    } as const;
    const row = await getSingleton(ctx);
    if (row) {
      await ctx.db.patch(row._id, patch);
    } else {
      await ctx.db.insert('backendControl', patch);
    }
    return { inFlight: await countActiveGenerations(ctx) };
  },
});

export const endDrain = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await getSingleton(ctx);
    if (row) {
      await ctx.db.patch(row._id, {
        draining: false,
        drainStartedAt: undefined,
        drainExpiresAt: undefined,
      });
    }
    return null;
  },
});

export const drainStatus = internalQuery({
  args: {},
  returns: v.object({ draining: v.boolean(), inFlight: v.number() }),
  handler: async (ctx) => ({
    draining: await isDrainingNow(ctx),
    inFlight: await countActiveGenerations(ctx),
  }),
});
