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
 * Max number of consecutive agent→agent replies in one discussion before the
 * loop guard refuses further auto-replies. Reset to 0 by any human reply.
 * Mirrors the per-(task,agent) circuit breaker for the discussion surface.
 */
export const MAX_AGENT_REPLY_CHAIN_DEPTH = 3;

/** Upper bound on a single discussion message body (chars). */
export const DISCUSSION_MESSAGE_MAX = 20_000;

/** Upper bound on a discussion title (chars). */
export const DISCUSSION_TITLE_MAX = 200;
