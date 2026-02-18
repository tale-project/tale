/**
 * Helper: browserOperate
 *
 * Delegates browser automation to the Operator service.
 * Uses Playwright for browser control with AI-driven navigation.
 *
 * Timeout strategy:
 * - CLIENT_TIMEOUT_MS (300s): hard abort for the HTTP request
 * - OPERATOR_TIMEOUT_S (270s): sent to operator so it can gracefully
 *   terminate and return partial results before the client aborts
 */

import type { ToolCtx } from '@convex-dev/agent';

import type { WebBrowserOperateResult, OperatorChatResponse } from './types';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { createDebugLog } from '../../../lib/debug_log';
import { getOperatorServiceUrl } from './get_operator_service_url';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const CLIENT_TIMEOUT_MS = 300_000;
const OPERATOR_TIMEOUT_S = 270;

export async function browserOperate(
  ctx: ToolCtx,
  args: {
    instruction: string;
  },
): Promise<WebBrowserOperateResult> {
  const operatorUrl = getOperatorServiceUrl(ctx.variables);
  const apiUrl = `${operatorUrl}/api/v1/chat`;

  debugLog('tool:web:browser_operate start', {
    instruction: args.instruction.slice(0, 100),
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: args.instruction,
        timeout_seconds: OPERATOR_TIMEOUT_S,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Operator service error: ${response.status} ${errorText}`,
      );
    }

    const result = await fetchJson<OperatorChatResponse>(response);

    if (!result.success) {
      debugLog('tool:web:browser_operate failed', {
        error: result.error,
        partial: result.partial,
      });
      return {
        operation: 'browser_operate',
        success: false,
        response: result.response || '',
        error: result.error || 'Operator request failed',
        sources: result.sources,
      };
    }

    debugLog('tool:web:browser_operate success', {
      hasResponse: !!result.response,
      partial: result.partial,
      sourcesCount: result.sources?.length ?? 0,
    });

    return {
      operation: 'browser_operate',
      success: true,
      response: result.response || '',
      sources: result.sources,
      usage: result.token_usage
        ? {
            inputTokens: result.token_usage.input_tokens,
            outputTokens: result.token_usage.output_tokens,
            totalTokens: result.token_usage.total_tokens,
            durationSeconds: result.duration_seconds,
          }
        : undefined,
    };
  } catch (error) {
    const isAborted = error instanceof Error && error.name === 'AbortError';
    const errorMessage = isAborted
      ? 'Request timed out after 5 minutes. The operator did not respond in time.'
      : error instanceof Error
        ? error.message
        : 'Unknown error';
    console.error('[tool:web:browser_operate] error', {
      error: errorMessage,
    });
    return {
      operation: 'browser_operate',
      success: false,
      response: '',
      error: errorMessage,
    };
  }
}
