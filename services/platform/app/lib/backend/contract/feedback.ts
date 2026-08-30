/**
 * `feedback` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../feedback.ts` are what
 * actually serve them.
 */

export interface FeedbackContract {
  'feedback/queries:getFeedbackStats': {
    kind: 'query';
    args: {
      agentSlug?: string;
      model?: string;
      provider?: string;
      periodDays?: 1 | 7 | 30 | 90;
      organizationId: string;
    };
    returns: null | {
      hasAnyFeedback: boolean;
      previous?: { positive: number; negative: number; total: number };
      message: {
        byRating: { positive: number; negative: number };
        total: number;
      };
      arena: {
        byVerdict: {
          a_better: number;
          b_better: number;
          tie: number;
          both_bad: number;
        };
        total: number;
      };
      series: Array<{ dateKey: string; positive: number; negative: number }>;
      topAgents: Array<{
        agentSlug: string;
        positive: number;
        negative: number;
        total: number;
      }>;
      topModels: Array<{
        provider: string;
        model: string;
        positive: number;
        negative: number;
        total: number;
      }>;
      topMatchups: Array<{
        modelLeft: string;
        modelRight: string;
        leftWins: number;
        rightWins: number;
        ties: number;
        bothBad: number;
        total: number;
      }>;
      capped: boolean;
      scanned: number;
      windowStartMs: null | number;
    };
  };
  'feedback/queries:listRecentFeedback': {
    kind: 'query';
    args: {
      kind?: 'arena' | 'message' | 'all';
      agentSlug?: string;
      model?: string;
      provider?: string;
      periodDays?: 1 | 7 | 30 | 90;
      withCommentOnly?: boolean;
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        _id: string;
        threadId: string;
        messageId: string;
        userId: string;
        userDisplayName: string;
        rating: 'positive' | 'negative';
        comment: null | string;
        agentSlug: null | string;
        model: null | string;
        provider: null | string;
        arenaVerdict: null | 'a_better' | 'b_better' | 'tie' | 'both_bad';
        arenaModelA: null | string;
        arenaModelB: null | string;
        isArena: boolean;
        createdAt: number;
      }>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
  'feedback/queries:listThreadFeedback': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: Array<{
      messageId: string;
      rating: 'positive' | 'negative';
      comment: undefined | string;
    }>;
  };
}
