/**
 * `chat_filter_events` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../chat_filter_events.ts` are what
 * actually serve them.
 */

export interface ChatFilterEventsContract {
  'chat_filter_events/queries:getGuardrailStats': {
    kind: 'query';
    args: { organizationId: string; periodDays: 1 | 7 | 30 };
    returns: {
      byKind: Array<{ key: string; count: number }>;
      byFilter: Array<{ key: string; count: number }>;
      byDirection: Array<{ key: string; count: number }>;
      byCategory: Array<{ key: string; count: number }>;
      series: Array<{
        dateKey: string;
        detected: number;
        blocked: number;
        errors: number;
      }>;
      capped: boolean;
    };
  };
  'chat_filter_events/queries:listRecent': {
    kind: 'query';
    args: {
      kind?: 'blocked' | 'detected' | 'step_error' | 'circuit_open';
      filterName?: 'moderation_provider' | 'chat_filter' | 'pii';
      limit?: number;
      organizationId: string;
    };
    returns: Array<{
      _id: string;
      _creationTime: number;
      lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
      statusChangedAt?: number;
      agentSlug?: string;
      messageId?: string;
      actorType?: 'user' | 'assistant' | 'system' | 'api';
      matchCount?: number;
      truncated?: boolean;
      errorClass?:
        | 'config'
        | 'timeout'
        | 'network'
        | 'parse'
        | 'http_4xx'
        | 'http_5xx'
        | 'unknown';
      httpStatus?: number;
      durationMs?: number;
      attempt?: number;
      organizationId: string;
      createdAt: number;
      kind: 'blocked' | 'detected' | 'step_error' | 'circuit_open';
      threadId: string;
      sanitizationRunId: string;
      filterName: 'moderation_provider' | 'chat_filter' | 'pii';
      direction: 'input' | 'output';
      categoryIds: string[];
    }>;
  };
}
