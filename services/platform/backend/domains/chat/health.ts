import type { Sql } from 'postgres';

import {
  classifyChatErrorCode,
  decodeChatError,
} from '../../../lib/shared/chat-errors.ts';
import {
  DAY_MS,
  dailyKeys,
  utcDateKey,
} from '../../../lib/shared/metrics-window.ts';

/**
 * Org-wide chat health for the metrics page — the 0.4 `getOrgChatHealth`
 * fold verbatim over ONE bounded newest-first SQL page of `app.messages`
 * (assistant rows are the turns; agent attribution resolves through the
 * threads join after the walk).
 */
const CHAT_HEALTH_MAX_SCAN = 5000;
const CHAT_HEALTH_TOP_N = 10;
const CHAT_HEALTH_RECENT_ERRORS = 20;
const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

function readTokenUsage(usage: unknown): {
  input: number;
  output: number;
  total: number;
} {
  if (usage === null || typeof usage !== 'object') {
    return { input: 0, output: 0, total: 0 };
  }
  const input =
    'inputTokens' in usage && typeof usage.inputTokens === 'number'
      ? usage.inputTokens
      : 0;
  const output =
    'outputTokens' in usage && typeof usage.outputTokens === 'number'
      ? usage.outputTokens
      : 0;
  const total =
    'totalTokens' in usage && typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : input + output;
  return { input, output, total };
}

function classifyStoredChatError(error: string): string {
  const decoded = decodeChatError(error);
  return decoded.code ?? classifyChatErrorCode(decoded.raw ?? error);
}

export async function getOrgChatHealth(
  sql: Sql,
  organizationId: string,
  args: { periodDays: 1 | 7 | 30 },
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const windowStart = now - args.periodDays * DAY_MS;

  const anyRow = await sql<{ id: string }[]>`
    SELECT id FROM app.messages WHERE org_id = ${organizationId} LIMIT 1
  `;
  const sawAnyRow = anyRow.length > 0;

  const rows = await sql<
    {
      threadId: string;
      role: string;
      model: string | null;
      providerSlug: string | null;
      usage: unknown;
      blockedReason: string | null;
      error: string | null;
      createdAt: number;
    }[]
  >`
    SELECT thread_id AS "threadId", role, model,
           provider_slug AS "providerSlug", usage,
           blocked_reason AS "blockedReason", error,
           created_at_ms::float8 AS "createdAt"
    FROM app.messages
    WHERE org_id = ${organizationId} AND created_at_ms >= ${windowStart}
    ORDER BY created_at_ms DESC
    LIMIT ${CHAT_HEALTH_MAX_SCAN + 1}
  `;
  const capped = rows.length > CHAT_HEALTH_MAX_SCAN;
  const walk = rows.slice(0, CHAT_HEALTH_MAX_SCAN);

  let totalTurns = 0;
  let errorCount = 0;
  let blockedCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  const seriesMap = new Map(
    dailyKeys(args.periodDays, now).map((dateKey) => [
      dateKey,
      { dateKey, turns: 0, errors: 0, blocked: 0 },
    ]),
  );
  const modelCounts = new Map<
    string,
    { provider: string; model: string; count: number }
  >();
  const threadTurns = new Map<string, number>();
  const errorTypeCounts = new Map<string, number>();
  const recentErrors: Array<{
    at: number;
    type: string;
    model?: string;
    threadId: string;
  }> = [];

  for (const message of walk) {
    if (message.role !== 'assistant') continue;
    totalTurns++;
    const seriesPoint = seriesMap.get(utcDateKey(message.createdAt));
    if (seriesPoint) seriesPoint.turns++;

    const usage = readTokenUsage(message.usage);
    inputTokens += usage.input;
    outputTokens += usage.output;
    totalTokens += usage.total;

    threadTurns.set(
      message.threadId,
      (threadTurns.get(message.threadId) ?? 0) + 1,
    );

    if (message.model !== null) {
      const provider = message.providerSlug ?? '';
      const key = `${provider} ${message.model}`;
      const entry = modelCounts.get(key);
      if (entry) entry.count++;
      else modelCounts.set(key, { provider, model: message.model, count: 1 });
    }

    if (message.blockedReason !== null) {
      blockedCount++;
      if (seriesPoint) seriesPoint.blocked++;
    }

    if (message.error !== null) {
      errorCount++;
      if (seriesPoint) seriesPoint.errors++;
      const type = classifyStoredChatError(message.error);
      errorTypeCounts.set(type, (errorTypeCounts.get(type) ?? 0) + 1);
      if (recentErrors.length < CHAT_HEALTH_RECENT_ERRORS) {
        recentErrors.push({
          at: message.createdAt,
          type,
          ...(message.model !== null ? { model: message.model } : {}),
          threadId: message.threadId,
        });
      }
    }
  }

  // Agent attribution — one bounded IN query over the seen threads.
  const agentByThread = new Map<string, string>();
  const threadIds = [...threadTurns.keys()];
  if (threadIds.length > 0) {
    const threads = await sql<{ id: string; agentSlug: string | null }[]>`
      SELECT thread_id AS id, agent_slug AS "agentSlug"
      FROM app.thread_metadata
      WHERE org_id = ${organizationId} AND thread_id = ANY(${threadIds})
    `;
    for (const thread of threads) {
      agentByThread.set(thread.id, thread.agentSlug ?? UNATTRIBUTED_AGENT_SLUG);
    }
  }
  const agentCounts = new Map<string, number>();
  for (const [threadId, count] of threadTurns) {
    const slug = agentByThread.get(threadId) ?? UNATTRIBUTED_AGENT_SLUG;
    agentCounts.set(slug, (agentCounts.get(slug) ?? 0) + count);
  }

  return {
    summary: {
      totalTurns,
      errorCount,
      errorRate: totalTurns > 0 ? errorCount / totalTurns : 0,
      blockedCount,
      blockedRate: totalTurns > 0 ? blockedCount / totalTurns : 0,
      tokens: { input: inputTokens, output: outputTokens, total: totalTokens },
      capped,
      hasAnyData: sawAnyRow,
    },
    series: [...seriesMap.values()],
    byModel: [...modelCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, CHAT_HEALTH_TOP_N),
    byAgent: [...agentCounts]
      .map(([agentSlug, count]) => ({ agentSlug, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, CHAT_HEALTH_TOP_N),
    errorsByType: [...errorTypeCounts]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    recentErrors: recentErrors.map((entry) => {
      const agentSlug = agentByThread.get(entry.threadId);
      const out: {
        at: number;
        type: string;
        model?: string;
        agentSlug?: string;
      } = { at: entry.at, type: entry.type };
      if (entry.model !== undefined) out.model = entry.model;
      if (agentSlug !== undefined && agentSlug !== UNATTRIBUTED_AGENT_SLUG) {
        out.agentSlug = agentSlug;
      }
      return out;
    }),
  };
}
