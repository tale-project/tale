import { defineTable } from 'convex/server';
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
 * (no auto-selected model, no route reason, no tier), because the model is
 * always chosen explicitly; no personalization blob and no auto-injected
 * memory or retrieval context, because everything the model sees is assembled
 * from the message history and the tools it calls; and no per-agent timeout,
 * because execution ceilings are physics the host enforces, not policy stored
 * per conversation.
 */

/** Where a thread came from. `sandbox` threads run their turns inside a
 * harness session; `direct` threads call the model API. */
export const chatKindValidator = v.union(
  v.literal('direct'),
  v.literal('sandbox'),
);

export const threadsTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  kind: chatKindValidator,
  title: v.optional(v.string()),
  /** The agent configuration this thread talks to, by slug. */
  agentSlug: v.optional(v.string()),
  /**
   * What the conversation equips its agent with, picked in the composer:
   * org skill slugs and enabled-connector slugs. Stored on the thread so the
   * whole conversation runs with one assembly; CONSUMED by the lane that runs
   * the agent (a coding agent's session provisioning stages the skills and
   * bridges the connectors) — never interpreted here.
   */
  capabilities: v.optional(
    v.object({
      skills: v.array(v.string()),
      connectors: v.array(v.string()),
    }),
  ),
  /** The third-party coding agent pinned to a sandbox thread. A sandbox
   * thread keeps its agent for its whole life — switching means a new chat —
   * so the composer reads this to stay on it across turns and reloads. */
  harness: v.optional(v.string()),
  /** The coding harness's own conversation handle from the last turn, so the
   * next turn resumes it (its state lives in the preserved workspace). */
  codingResume: v.optional(v.string()),
  /** Branching: the message this thread was forked from, if any. Threads are
   * the unit of branching so a fork never mutates the conversation it came
   * from. */
  branchedFromMessageId: v.optional(v.string()),
  archived: v.boolean(),
  /** Sharing: an org-internal, read-only snapshot link. The token is the URL
   * credential; `sharedAt` is the snapshot boundary — messages appended after
   * it are never part of the share. Unsharing flips `isShared` but keeps the
   * token, so re-sharing restores the same URL. */
  shareToken: v.optional(v.string()),
  isShared: v.optional(v.boolean()),
  sharedAt: v.optional(v.number()),
  sharedBy: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_org_user_updated', ['organizationId', 'userId', 'updatedAt'])
  .index('by_shareToken', ['shareToken']);

/**
 * One message. Tool calls and their results are messages too — the history is
 * the full record of the turn, because the context contract sends it whole
 * rather than summarizing it. `parts` carries the ordered content (text,
 * attachments, tool calls, approval cards) as authored, so replaying a thread
 * reproduces exactly what the model saw.
 */
export const messagesTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  role: v.union(
    v.literal('user'),
    v.literal('assistant'),
    v.literal('tool'),
    v.literal('system'),
  ),
  /** Ordered content parts. Shapes are validated by the chat layer rather
   * than re-declared here, so adding a part kind is not a schema migration. */
  parts: v.any(),
  /** Monotonic within a thread; assigned on insert so ordering never depends
   * on wall-clock ties. */
  sequence: v.number(),
  /** Which model produced an assistant message — recorded per message because
   * a thread may legitimately switch models between turns. */
  model: v.optional(v.string()),
  providerSlug: v.optional(v.string()),
  /** Token accounting and timings for this message, for the usage ledger and
   * the message-info panel. */
  usage: v.optional(v.any()),
  /** Set when a guardrail refused or altered the message, so the UI can
   * explain the refusal instead of showing an empty turn. */
  blockedReason: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_thread', ['threadId'])
  .index('by_thread_sequence', ['threadId', 'sequence']);

/**
 * The in-flight turn. Exactly one row per actively generating thread; it is
 * deleted when the turn settles, so its presence IS the "is generating"
 * signal and no thread row carries stale generation state.
 *
 * `heartbeatAt` is what makes an abandoned turn recoverable: a sweeper can
 * tell a live stream from a crashed one without guessing from timestamps on
 * the thread.
 */
export const generationsTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  status: v.union(
    v.literal('queued'),
    v.literal('streaming'),
    v.literal('waiting-approval'),
    v.literal('waiting-input'),
  ),
  /** The stream the client subscribes to. */
  streamId: v.string(),
  /** The assistant message being written, once it exists. */
  messageId: v.optional(v.string()),
  /** What the turn is blocked on, when waiting. */
  waitingOn: v.optional(v.string()),
  startedAt: v.number(),
  heartbeatAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_thread', ['threadId'])
  .index('by_heartbeat', ['heartbeatAt']);

/**
 * Memories are a TOOL, not an ambient context injection: the model must call
 * `memory.save` to write one and `memory.search` to read one, and nothing is
 * injected into a prompt automatically.
 *
 * A saved memory starts `pending` and becomes usable only once the user
 * approves it — a model should not be able to silently give itself durable
 * state about a person. `sourceMessageId` keeps every memory traceable to the
 * turn that proposed it.
 */
export const memoriesTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  content: v.string(),
  status: v.union(
    v.literal('pending'),
    v.literal('approved'),
    v.literal('rejected'),
  ),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  reviewedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_org_user_status', ['organizationId', 'userId', 'status']);
