/**
 * Pure reducer for the per-org chat-health rollup (admin observability
 * instrument #1). Mirrors `feedback/stats.ts:computeFeedbackStats`: no Convex
 * `ctx`, accepts any iterable of `messageMetadata` rows (a live query iterator
 * or an in-memory test array), and produces the aggregate the admin panel
 * renders. The caller is responsible for opening the iterator with the right
 * org+window index range AND for bounding the scan (see `getChatHealthRollup` —
 * messageMetadata rows are heavy, so the scan is byte-bounded upstream).
 *
 * Aggregates only what the row already carries — no new telemetry is written or
 * captured here. NOTE: the persisted `toolsUsage` items have no success/error
 * field (`extract_tool_calls.ts` writes tool status only to the ephemeral
 * `toolCalls`, which is not persisted), so this reports tool-call VOLUME, not a
 * tool-failure rate. Turn-level failure is `error`; guardrail blocks are
 * `blockedReason`. A tool-level failure signal belongs to a later instrument.
 */

import {
  type ChatErrorCode,
  classifyChatErrorCode,
} from '../../lib/shared/chat-errors';
import type { Doc } from '../_generated/dataModel';

/** Sentinel routing bucket for turns the user pinned (no `autoRouteReason`). */
export const PINNED_ROUTE_REASON = 'pinned';
/** Sentinel for turns with no agent attribution. */
export const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

/** Cap on the size of each ranked distribution (agents, models, tools). */
const TOP_N = 10;

/**
 * How many errored turns the `recent` list carries. The caller scans
 * newest-first, so these are the most-recent failures within the (byte-bounded)
 * scan window — enough to eyeball what is breaking without paging the table.
 */
const RECENT_ERRORS_LIMIT = 20;

export interface ChatHealthDistItem {
  key: string;
  count: number;
}

export interface ChatHealthModelItem {
  provider: string;
  model: string;
  count: number;
}

export interface ChatHealthLatencyStat {
  /** Nearest-rank p50 over rows that carried this metric; `null` when none did. */
  p50: number | null;
  p95: number | null;
  /** How many rows contributed a value (the percentile denominator). */
  count: number;
}

/** One recently-errored turn, projected for the admin recent-errors list. */
export interface ChatHealthRecentError {
  /** `_creationTime` of the errored turn (ms). */
  at: number;
  /** Classified error code — see {@link classifyChatErrorCode}. */
  type: ChatErrorCode;
  /** Model that produced the failure, when the row recorded one. */
  model?: string;
  /** Agent attributed to the turn, when the row recorded one. */
  agentSlug?: string;
}

export interface ChatHealthStats {
  /** Assistant turns in the window (every scanned row = one turn). */
  totalMessages: number;
  errorCount: number;
  /** `errorCount / totalMessages`, in [0,1]; 0 when there are no turns. */
  errorRate: number;
  errors: {
    /** Errored turns bucketed by classified code, ranked desc (full set). */
    byType: ChatHealthDistItem[];
    /**
     * The most-recent errored turns (newest-first as scanned), capped at
     * {@link RECENT_ERRORS_LIMIT}. Bounded by the caller's byte-limited scan.
     */
    recent: ChatHealthRecentError[];
  };
  blockedCount: number;
  blockedRate: number;
  latency: {
    durationMs: ChatHealthLatencyStat;
    timeToFirstTokenMs: ChatHealthLatencyStat;
  };
  tools: {
    /** Total tool invocations across all turns (volume, not failures). */
    totalCalls: number;
    /** Turns that used at least one tool. */
    messagesUsingTools: number;
    byTool: ChatHealthDistItem[];
  };
  routing: {
    /** Auto-route reason distribution incl. a `pinned` bucket (small, full set). */
    byAutoRouteReason: ChatHealthDistItem[];
    byAgentSlug: ChatHealthDistItem[];
    byModel: ChatHealthModelItem[];
  };
  tokens: { input: number; output: number; total: number };
  costCents: number;
  /** True when the scan stopped at the byte/row budget before the window end. */
  capped: boolean;
  scanned: number;
  /** Inclusive lower bound of the window (ms), or `null` for an unbounded scan. */
  windowStartMs: number | null;
}

export interface ComputeChatHealthOptions {
  windowStartMs: number | null;
  /** Defensive cap; the caller is expected to bound the iterator first. */
  maxScan: number;
}

/**
 * Nearest-rank percentile over an ascending-sorted array. `p` is a fraction in
 * [0,1]. Returns `null` for an empty input. Nearest-rank (not interpolation)
 * keeps the result an actually-observed latency and makes tests deterministic.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const rank = Math.ceil(p * n);
  const idx = Math.min(Math.max(rank - 1, 0), n - 1);
  return sortedAsc[idx] ?? null;
}

function rankDist(
  counts: Map<string, number>,
  limit?: number,
): ChatHealthDistItem[] {
  const arr = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return limit === undefined ? arr : arr.slice(0, limit);
}

export function computeChatHealthStats(
  rows: Iterable<Doc<'messageMetadata'>>,
  opts: ComputeChatHealthOptions,
): ChatHealthStats {
  let totalMessages = 0;
  let errorCount = 0;
  const byErrorType = new Map<string, number>();
  const recentErrors: ChatHealthRecentError[] = [];
  let blockedCount = 0;

  const durationValues: number[] = [];
  const ttftValues: number[] = [];

  let toolTotalCalls = 0;
  let messagesUsingTools = 0;
  const byTool = new Map<string, number>();

  const byReason = new Map<string, number>();
  const byAgent = new Map<string, number>();
  const byModel = new Map<string, ChatHealthModelItem>();

  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensTotal = 0;
  let costCents = 0;

  let scanned = 0;
  let capped = false;

  for (const row of rows) {
    scanned++;
    if (scanned > opts.maxScan) {
      capped = true;
      break;
    }

    totalMessages++;
    if (typeof row.error === 'string' && row.error.length > 0) {
      errorCount++;
      // The raw provider/SDK error string classifies to one of the shared
      // chat-error codes (pure, deterministic — safe in this V8 runtime).
      const code = classifyChatErrorCode(row.error);
      byErrorType.set(code, (byErrorType.get(code) ?? 0) + 1);
      if (recentErrors.length < RECENT_ERRORS_LIMIT) {
        recentErrors.push({
          at: row._creationTime,
          type: code,
          model: row.model,
          agentSlug: row.agentSlug,
        });
      }
    }
    if (row.blockedReason !== undefined) blockedCount++;

    if (typeof row.durationMs === 'number') durationValues.push(row.durationMs);
    if (typeof row.timeToFirstTokenMs === 'number') {
      ttftValues.push(row.timeToFirstTokenMs);
    }

    const tools = row.toolsUsage ?? [];
    if (tools.length > 0) {
      messagesUsingTools++;
      toolTotalCalls += tools.length;
      for (const tool of tools) {
        byTool.set(tool.toolName, (byTool.get(tool.toolName) ?? 0) + 1);
      }
    }

    const reason = row.autoRouteReason ?? PINNED_ROUTE_REASON;
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);

    const agentKey = row.agentSlug ?? UNATTRIBUTED_AGENT_SLUG;
    byAgent.set(agentKey, (byAgent.get(agentKey) ?? 0) + 1);

    if (row.model) {
      const provider = row.provider ?? '';
      const modelKey = `${provider}::${row.model}`;
      const existing = byModel.get(modelKey);
      if (existing) existing.count++;
      else byModel.set(modelKey, { provider, model: row.model, count: 1 });
    }

    tokensInput += row.inputTokens ?? 0;
    tokensOutput += row.outputTokens ?? 0;
    tokensTotal +=
      row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    costCents += row.costEstimateCents ?? 0;
  }

  durationValues.sort((a, b) => a - b);
  ttftValues.sort((a, b) => a - b);

  const topModels = [...byModel.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        `${a.provider}::${a.model}`.localeCompare(`${b.provider}::${b.model}`),
    )
    .slice(0, TOP_N);

  return {
    totalMessages,
    errorCount,
    errorRate: totalMessages === 0 ? 0 : errorCount / totalMessages,
    errors: { byType: rankDist(byErrorType), recent: recentErrors },
    blockedCount,
    blockedRate: totalMessages === 0 ? 0 : blockedCount / totalMessages,
    latency: {
      durationMs: {
        p50: percentile(durationValues, 0.5),
        p95: percentile(durationValues, 0.95),
        count: durationValues.length,
      },
      timeToFirstTokenMs: {
        p50: percentile(ttftValues, 0.5),
        p95: percentile(ttftValues, 0.95),
        count: ttftValues.length,
      },
    },
    tools: {
      totalCalls: toolTotalCalls,
      messagesUsingTools,
      byTool: rankDist(byTool, TOP_N),
    },
    routing: {
      byAutoRouteReason: rankDist(byReason),
      byAgentSlug: rankDist(byAgent, TOP_N),
      byModel: topModels,
    },
    tokens: { input: tokensInput, output: tokensOutput, total: tokensTotal },
    costCents,
    capped,
    scanned,
    windowStartMs: opts.windowStartMs,
  };
}
