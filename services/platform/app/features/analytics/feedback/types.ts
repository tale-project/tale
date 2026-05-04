/**
 * Mirror of the discriminated types produced by the feedback Convex queries.
 * Kept in a feature-local module so storybook / unit tests can import without
 * pulling in `convex/_generated/api.d.ts` (which depends on a generated
 * runtime).
 */

export type ArenaVerdict = 'a_better' | 'b_better' | 'tie' | 'both_bad';

export interface FeedbackAgentBucket {
  agentSlug: string;
  positive: number;
  negative: number;
  total: number;
}

export interface FeedbackModelBucket {
  provider: string;
  model: string;
  positive: number;
  negative: number;
  total: number;
}

export interface RecentFeedbackItem {
  _id: string;
  threadId: string;
  messageId: string;
  userId: string;
  userDisplayName: string;
  rating: 'positive' | 'negative';
  comment: string | null;
  agentSlug: string | null;
  model: string | null;
  provider: string | null;
  arenaVerdict: ArenaVerdict | null;
  arenaModelA: string | null;
  arenaModelB: string | null;
  isArena: boolean;
  threadDeleted: boolean;
  createdAt: number;
}

export const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';
