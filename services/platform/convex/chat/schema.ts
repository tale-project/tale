import { v } from 'convex/values';

/**
 * Chat storage — threads, their messages, and the live generation state.
 *
 * The split is deliberate. `threads` is small, frequently listed, and rarely
 * written; `messages` is append-heavy and read as a whole conversation;
 * `generations` is the only hot-written row during a turn. Keeping the
 * in-flight state out of the thread row means a streaming turn does not
 * rewrite a row that every thread list reads.
 *
 * What is NOT here is as deliberate as what is. There are no routing columns
 * (no route reason, no tier): a chat send may say Auto, but that resolves to
 * a concrete model BEFORE the turn binds, and only the resolved model is
 * recorded (`messages.model`) — the pick's why goes to the server log, not a
 * column. No personalization blob and no auto-injected memory or retrieval
 * context, because everything the model sees is assembled from the message
 * history and the tools it calls; and no per-agent timeout, because
 * execution ceilings are physics the host enforces, not policy stored per
 * conversation.
 */

/** Where a thread came from. `sandbox` threads run their turns inside a
 * harness session; `direct` threads call the model API. */
export const chatKindValidator = v.union(
  v.literal('direct'),
  v.literal('sandbox'),
);

/** The user-facing reasoning-effort scale — the five steps of
 * `lib/chat/effort.ts`, spelled as literals for every arg and column that
 * carries a pick. */
export const reasoningEffortValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('extra'),
  v.literal('max'),
);
