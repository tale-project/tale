/**
 * The analytics/metrics pages over the 0.5 backend — usage, feedback,
 * chat health (+ guardrails), and external turns. All are point-in-time
 * folds the server computes in one bounded page, so every read is a
 * plain READ row keyed by its filter args; the recent-feedback table is
 * the one PAGINATED lane (`ts|id` keyset, server envelope pass-through).
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';

import type { AdapterContext, PaginatedAdapter, ReadAdapter } from './adapters';
import { backendFetch } from './api-client';
import { backendKey } from './query-keys';

type UsageMetricsResult = ReturnsOf<'governance/queries:getOrgUsageMetrics'>;
type FeedbackStatsResult = ReturnsOf<'feedback/queries:getFeedbackStats'>;
type ChatHealthResult = ReturnsOf<'chat/messages:getOrgChatHealth'>;
type GuardrailStatsResult =
  ReturnsOf<'chat_filter_events/queries:getGuardrailStats'>;
type ExternalTurnMetricsResult =
  ReturnsOf<'sandbox/session_queries_public:getExternalTurnMetrics'>;

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

/** Build `&key=value` for every present string/number/boolean arg. */
function filterQs(
  args: Record<string, unknown>,
  keys: readonly string[],
): string {
  let out = '';
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') {
      out += `&${key}=${encodeURIComponent(value)}`;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out += `&${key}=${String(value)}`;
    } else if (value === true) {
      out += `&${key}=true`;
    }
  }
  return out;
}

function keyPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value === true) return 'true';
  return '';
}

function splitCursor(cursor: string | null): { ts: string; id: string } | null {
  if (cursor === null || cursor === '') return null;
  const at = cursor.indexOf('|');
  if (at <= 0) return null;
  return { ts: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

const USAGE_KEYS = [
  'periodDays',
  'granularity',
  'agentSlug',
  'model',
  'provider',
] as const;
const FEEDBACK_STATS_KEYS = [
  'periodDays',
  'agentSlug',
  'model',
  'provider',
] as const;
const FEEDBACK_RECENT_KEYS = [
  'periodDays',
  'kind',
  'withCommentOnly',
  'agentSlug',
  'model',
  'provider',
] as const;

export const metricsReadAdapters: Record<string, ReadAdapter> = {
  'governance/queries:getOrgUsageMetrics': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qs = filterQs(args, USAGE_KEYS);
    return {
      queryKey: backendKey(
        orgId,
        'metrics',
        'usage',
        ...USAGE_KEYS.map((key) => keyPart(args[key])),
      ),
      queryFn: () =>
        backendFetch<UsageMetricsResult>(
          `/governance/usage-metrics?${qs.slice(1)}`,
          { orgId },
        ),
    };
  },
  'feedback/queries:getFeedbackStats': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qs = filterQs(args, FEEDBACK_STATS_KEYS);
    return {
      queryKey: backendKey(
        orgId,
        'metrics',
        'feedback-stats',
        ...FEEDBACK_STATS_KEYS.map((key) => keyPart(args[key])),
      ),
      queryFn: () =>
        backendFetch<FeedbackStatsResult>(
          `/feedback/stats${qs === '' ? '' : `?${qs.slice(1)}`}`,
          { orgId },
        ),
    };
  },
  'chat/messages:getOrgChatHealth': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(
        orgId,
        'metrics',
        'chat-health',
        keyPart(args.periodDays),
      ),
      queryFn: () =>
        backendFetch<ChatHealthResult>(
          `/chat/health?periodDays=${keyPart(args.periodDays) || '7'}`,
          { orgId },
        ),
    };
  },
  'chat_filter_events/queries:getGuardrailStats': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(
        orgId,
        'metrics',
        'guardrails',
        keyPart(args.periodDays),
      ),
      queryFn: () =>
        backendFetch<GuardrailStatsResult>(
          `/governance/chat-filter-events/stats?periodDays=${keyPart(args.periodDays) || '7'}`,
          { orgId },
        ),
    };
  },
  'sandbox/session_queries_public:getExternalTurnMetrics': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(
        orgId,
        'metrics',
        'external-turns',
        keyPart(args.periodDays),
      ),
      queryFn: () =>
        backendFetch<ExternalTurnMetricsResult>(
          `/sandbox/external-turn-metrics?periodDays=${keyPart(args.periodDays) || '7'}`,
          { orgId },
        ),
    };
  },
};

interface PageEnvelope {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
}

export const metricsPaginatedAdapters: Record<string, PaginatedAdapter> = {
  'feedback/queries:listRecentFeedback': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qs = filterQs(args, FEEDBACK_RECENT_KEYS);
    return {
      queryKey: backendKey(
        orgId,
        'metrics',
        'feedback-recent',
        ...FEEDBACK_RECENT_KEYS.map((key) => keyPart(args[key])),
      ),
      fetchPage: (cursor, numItems) => {
        const split = splitCursor(cursor);
        return backendFetch<PageEnvelope>(
          `/feedback/recent?limit=${numItems}${qs}${split !== null ? `&cursorTs=${encodeURIComponent(split.ts)}&cursorId=${encodeURIComponent(split.id)}` : ''}`,
          { orgId },
        );
      },
    };
  },
};
