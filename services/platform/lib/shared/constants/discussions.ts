/**
 * Discussions — shared constants (pure data; safe to import from the V8 runtime).
 *
 * Discussions are chat threads with `kind: 'project_discussion' | 'task_discussion'`
 * that live under a project. They reuse the chat message store and generation
 * path; these constants govern categorization, lifecycle and the agent-reply
 * loop guard.
 */

/** Default discussion categories surfaced in the board UI / per-project picker. */
export const DEFAULT_DISCUSSION_CATEGORIES = [
  'general',
  'qa',
  'ideas',
  'decisions',
  'announcements',
  'show-and-tell',
  'polls',
] as const;

export type DiscussionCategory = (typeof DEFAULT_DISCUSSION_CATEGORIES)[number];

export const DEFAULT_DISCUSSION_CATEGORY: DiscussionCategory = 'general';

/** Discussion lifecycle states (orthogonal to retention `status`). */
export const DISCUSSION_STATUSES = ['open', 'resolved', 'locked'] as const;
export type DiscussionStatus = (typeof DISCUSSION_STATUSES)[number];

/**
 * Thread `kind` values that denote a discussion (vs a private `chat` thread).
 * The single source of truth for the "is this a discussion?" discriminator that
 * every write/read path applies before treating a `threadMetadata` row as one.
 */
const DISCUSSION_KINDS = ['project_discussion', 'task_discussion'] as const;
type DiscussionKind = (typeof DISCUSSION_KINDS)[number];

/** True when a thread `kind` denotes a discussion (never a `chat` thread). */
export function isDiscussionKind(
  kind: string | undefined,
): kind is DiscussionKind {
  return kind === 'project_discussion' || kind === 'task_discussion';
}

/**
 * Activity timestamp used to order discussions (newest first): the most recent
 * reply, falling back to the last metadata update, then creation time.
 */
export function discussionActivityAt(meta: {
  lastReplyAt?: number;
  updatedAt?: number;
  createdAt: number;
}): number {
  return meta.lastReplyAt ?? meta.updatedAt ?? meta.createdAt;
}

/**
 * Max number of consecutive agent→agent replies in one discussion before the
 * loop guard refuses further auto-replies. Reset to 0 by any human reply.
 * Mirrors the per-(task,agent) circuit breaker for the discussion surface.
 */
export const MAX_AGENT_REPLY_CHAIN_DEPTH = 3;

/** Upper bound on a single discussion message body (chars). */
export const DISCUSSION_MESSAGE_MAX = 20_000;

/** Upper bound on a discussion title (chars). */
export const DISCUSSION_TITLE_MAX = 200;
