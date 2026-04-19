/**
 * Shared citation/source capture logic for integration tools.
 *
 * Used by both `integration_tool` (generic, agent specifies `integrationName`)
 * and `create_bound_integration_tool` (agent-specific tool bound to one
 * integration via `integrationBindings`). Without this shared helper, each
 * tool would need to duplicate the `incrementIntegrationCallCount` + citation
 * derivation + `appendTodoSources` flow — and the bound variant historically
 * skipped all of it entirely, so Tavily runs via the researcher agent lost
 * both counter tracking and sources.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import type { IntegrationToolCitation } from './types';

/**
 * `executeIntegration` wraps the connector's direct output as
 * `{ name, operation, result: <connector return>, duration, version }`.
 * Dig through that wrapper to reach `data.results[...]` where URL-bearing
 * entries live. Accept the unwrapped shape too so callers passing a raw
 * connector result (or future refactors) keep working.
 */
export function connectorResultsOf(result: unknown): unknown[] | undefined {
  if (!isRecord(result)) return undefined;
  const unwrapped = isRecord(result.result) ? result.result : result;
  const data = isRecord(unwrapped.data) ? unwrapped.data : undefined;
  if (!data) return undefined;
  return Array.isArray(data.results) ? data.results : undefined;
}

/**
 * Build structured citations from any integration result that follows the
 * `{ data: { results: [{ url, title?, score? }] } }` convention — shared by
 * Tavily search/extract and any other web-shaped integration. Emitting this at
 * the top level of the tool result lets `generate_response.ts` harvest it into
 * message metadata so `SourceCards` and inline `<cite>` popovers light up
 * without further UI work.
 */
export function deriveCitationsFromResult(
  result: unknown,
): IntegrationToolCitation[] | undefined {
  const results = connectorResultsOf(result);
  if (!results) return undefined;
  const citations: IntegrationToolCitation[] = [];
  let idx = 1;
  for (const r of results) {
    if (!isRecord(r)) continue;
    if (typeof r.url !== 'string' || r.url.length === 0) continue;
    const title =
      typeof r.title === 'string' && r.title.length > 0 ? r.title : r.url;
    const entry: IntegrationToolCitation = {
      index: idx++,
      type: 'web',
      source: title,
      url: r.url,
    };
    if (typeof r.score === 'number') entry.relevance = r.score;
    citations.push(entry);
  }
  return citations.length > 0 ? citations : undefined;
}

function extractPublishedDate(
  results: unknown[],
  url: string,
): { publishedDate?: string } {
  for (const r of results) {
    if (!isRecord(r)) continue;
    if (r.url !== url) continue;
    if (typeof r.published_date === 'string' && r.published_date.length > 0) {
      return { publishedDate: r.published_date };
    }
    return {};
  }
  return {};
}

export function inferCounterKind(
  operation: string,
): 'search' | 'extract' | undefined {
  const lowered = operation.toLowerCase();
  if (lowered.includes('extract') || lowered.includes('fetch')) {
    return 'extract';
  }
  if (lowered.includes('search') || lowered.includes('query')) return 'search';
  return undefined;
}

interface RecordCallArgs {
  ctx: ToolCtx;
  organizationId: string;
  threadId: string;
  integrationName: string;
  operation: string;
  result: unknown;
  activeTodoId: string | undefined;
}

/**
 * Runs after an integration tool executes successfully. Bumps per-run /
 * per-todo counters and appends any URLs Tavily-shaped results returned to
 * the currently-in-progress todo. Returns the derived citations so callers
 * can spread them at the top level of the tool return (message-level
 * `SourceCards` + inline `<cite>` popovers light up automatically).
 */
export async function recordIntegrationCall({
  ctx,
  organizationId,
  threadId,
  integrationName,
  operation,
  result,
  activeTodoId,
}: RecordCallArgs): Promise<IntegrationToolCitation[] | undefined> {
  const citations = deriveCitationsFromResult(result);
  console.log('[capture_sources] result shape:', {
    integration: integrationName,
    operation,
    topLevelKeys: isRecord(result) ? Object.keys(result) : typeof result,
    hasNestedResult:
      isRecord(result) && 'result' in result && isRecord(result.result),
    connectorResultsCount: connectorResultsOf(result)?.length ?? 0,
    citationsCount: citations?.length ?? 0,
    activeTodoId,
  });

  await ctx.runMutation(
    internal.thread_todos.internal_mutations.incrementIntegrationCallCount,
    {
      organizationId,
      threadId,
      delta: 1,
      todoId: activeTodoId,
      counterKind: inferCounterKind(operation),
    },
  );

  if (citations && activeTodoId) {
    const connectorResults = connectorResultsOf(result) ?? [];
    const payload = citations.map((c) => ({
      url: c.url,
      ...(c.source !== c.url ? { title: c.source } : {}),
      ...(c.relevance !== undefined ? { score: c.relevance } : {}),
      ...extractPublishedDate(connectorResults, c.url),
    }));
    console.log('[capture_sources] appending:', {
      threadId,
      todoId: activeTodoId,
      count: payload.length,
      firstUrl: payload[0]?.url,
    });
    await ctx.runMutation(
      internal.thread_todos.internal_mutations.appendTodoSources,
      {
        organizationId,
        threadId,
        todoId: activeTodoId,
        sources: payload,
      },
    );
  } else if (citations && !activeTodoId) {
    console.warn(
      '[capture_sources] citations present but no activeTodoId — skipping',
      { threadId, citationsCount: citations.length },
    );
  } else if (!citations) {
    console.log('[capture_sources] no citations derived', {
      threadId,
      integration: integrationName,
      operation,
    });
  }

  return citations;
}
