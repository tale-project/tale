/**
 * Build humanInputContext string from responded approvals for prompt injection.
 */

import type { Id } from '../../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../../_generated/server';

import { internal } from '../../../../../_generated/api';
import { createDebugLog } from '../../../../../lib/debug_log';
import { toId } from '../../../../../lib/type_cast_helpers';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[LLMNode]');

export async function buildHumanInputContext(
  ctx: ActionCtx,
  executionId: string | Id<'wfExecutions'>,
): Promise<string> {
  const respondedApprovals = await ctx.runQuery(
    internal.approvals.internal_queries.listRespondedForExecution,
    { executionId: toId<'wfExecutions'>(executionId) },
  );

  if (respondedApprovals.length === 0) return '';

  debugLog('Built humanInputContext for prompt variables', {
    responseCount: respondedApprovals.length,
  });

  const escapeForContext = (value: string) =>
    value.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const formatResponse = (response: string | string[]) =>
    Array.isArray(response)
      ? response.map(escapeForContext).join(', ')
      : escapeForContext(response);

  return [
    '<human_input_context>',
    'The following information was provided by the user during this workflow. Use these values for the EXACT questions listed below — do not re-ask these specific questions. If you need NEW or DIFFERENT information not covered here, you MUST call request_human_input again.',
    ...respondedApprovals.map(
      (a: { question: string; response: string | string[] }) =>
        `- Q: "${escapeForContext(a.question)}" → A: "${formatResponse(a.response)}"`,
    ),
    '</human_input_context>',
  ].join('\n');
}
