import { isRecord } from '../../../lib/utils/type-utils';
import { estimateCostCents } from '../../governance/cost_estimation';

/**
 * Safely stringify a value with truncation.
 * Returns `[unserializable]` if JSON.stringify throws.
 */
export function safeStringify(value: unknown, maxLen = 10240): string {
  if (value === undefined || value === null) return '';
  try {
    const json = JSON.stringify(value);
    if (json.length > maxLen) {
      return json.slice(0, maxLen) + '[truncated]';
    }
    return json;
  } catch (serializeError) {
    console.error('[safeStringify] Serialization failed:', serializeError);
    return '[unserializable]';
  }
}

export const DUPLICATE_TOOL_RESULT_FIELDS = new Set([
  'output',
  'usage',
  'model',
  'provider',
  'citations',
]);

export function stripDuplicateToolResultFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!DUPLICATE_TOOL_RESULT_FIELDS.has(key)) result[key] = val;
  }
  return result;
}

/**
 * Extract tool calls and tool usage from AI SDK steps.
 * Tracks ALL tool calls (not just delegation tools).
 */
export function extractToolCallsFromSteps(steps: unknown[]): {
  toolCalls: Array<{ toolName: string; status: string }>;
  toolsUsage: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
    costEstimateCents?: number;
  }>;
  citations: Array<{
    index: number;
    type: 'rag' | 'web';
    source: string;
    fileId?: string;
    url?: string;
    page?: number;
    relevance?: number;
  }>;
} {
  type StepWithTools = {
    toolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      // AI SDK uses 'input'; @convex-dev/agent normalizes to 'args'
      input?: unknown;
      args?: unknown;
    }>;
    toolResults?: Array<{
      toolCallId: string;
      toolName: string;
      result?: unknown;
      output?: unknown;
    }>;
  };

  const toolCalls: Array<{ toolName: string; status: string }> = [];
  const toolsUsage: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
    costEstimateCents?: number;
  }> = [];
  const allCitations: Array<{
    index: number;
    type: 'rag' | 'web';
    source: string;
    fileId?: string;
    url?: string;
    page?: number;
    relevance?: number;
  }> = [];
  // Track running offset so citations from different tool calls get unique indices.
  // Without this, both rag_search and web tools start at index 1, and the frontend
  // Map<number, CitationInfo> keyed by index would let later tools overwrite earlier ones.
  let citationIndexOffset = 0;

  for (const rawStep of steps) {
    if (!isRecord(rawStep)) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- AI SDK step arrays are typed as unknown[]; structure is verified by isRecord guard above
    const stepToolCalls = (
      Array.isArray(rawStep.toolCalls) ? rawStep.toolCalls : []
    ) as StepWithTools['toolCalls'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as stepToolCalls above
    const stepToolResults = (
      Array.isArray(rawStep.toolResults) ? rawStep.toolResults : []
    ) as StepWithTools['toolResults'];

    // Extract tool call statuses and usage for ALL tools
    for (const toolCall of stepToolCalls ?? []) {
      const matchingResult = stepToolResults?.find(
        (r) => r.toolCallId === toolCall.toolCallId,
      );
      const resultRecord = isRecord(matchingResult?.result)
        ? matchingResult.result
        : undefined;
      const outputRecord = isRecord(matchingResult?.output)
        ? matchingResult.output
        : undefined;
      const directSuccess =
        typeof resultRecord?.success === 'boolean'
          ? resultRecord.success
          : undefined;
      const outputSuccess =
        typeof outputRecord?.success === 'boolean'
          ? outputRecord.success
          : undefined;
      const isSuccess = directSuccess ?? outputSuccess ?? true;
      toolCalls.push({
        toolName: toolCall.toolName,
        status: isSuccess ? 'completed' : 'failed',
      });

      // Extract structured citations from raw tool result before safeStringify truncation.
      // The result may be the direct return value, or wrapped as {value: {...}} by @convex-dev/agent.
      const rawOutput = matchingResult?.output ?? matchingResult?.result;
      const citationSource =
        isRecord(rawOutput) && Array.isArray(rawOutput.citations)
          ? rawOutput.citations
          : isRecord(rawOutput) &&
              isRecord(rawOutput.value) &&
              Array.isArray(rawOutput.value.citations)
            ? rawOutput.value.citations
            : undefined;
      if (Array.isArray(citationSource)) {
        let maxIndexThisToolCall = 0;
        for (const c of citationSource) {
          if (
            isRecord(c) &&
            typeof c.index === 'number' &&
            typeof c.type === 'string' &&
            (c.type === 'rag' || c.type === 'web')
          ) {
            const citationType: 'rag' | 'web' = c.type;
            const adjustedIndex =
              (typeof c.index === 'number' ? c.index : 0) + citationIndexOffset;
            // Convex validators reject explicit `undefined` — omit undefined fields
            const entry: (typeof allCitations)[number] = {
              index: adjustedIndex,
              type: citationType,
              source: typeof c.source === 'string' ? c.source : 'Unknown',
            };
            if (typeof c.fileId === 'string') entry.fileId = c.fileId;
            if (typeof c.url === 'string') entry.url = c.url;
            if (typeof c.page === 'number') entry.page = c.page;
            if (typeof c.relevance === 'number') entry.relevance = c.relevance;
            allCitations.push(entry);
            if (adjustedIndex > maxIndexThisToolCall) {
              maxIndexThisToolCall = adjustedIndex;
            }
          }
        }
        // Advance offset so the next tool call's citations don't collide
        if (maxIndexThisToolCall > 0) {
          citationIndexOffset = maxIndexThisToolCall;
        }
      }

      const inputStr = safeStringify(toolCall.input ?? toolCall.args);
      // Keep the full tool output so the message-info dialog can show what a
      // tool actually returned. Strip only fields that duplicate info captured
      // elsewhere in the metadata (tokens/model/provider live on `usageEntry`,
      // citations on `allCitations`) and `output` which is a self-reference.
      // safeStringify truncates at 10KB so oversize payloads are capped.
      const rawForOutput = matchingResult?.output ?? matchingResult?.result;
      // Unwrap {value: {...}} wrapper if present (from @convex-dev/agent)
      const unwrapped =
        isRecord(rawForOutput) && isRecord(rawForOutput.value)
          ? rawForOutput.value
          : isRecord(rawForOutput)
            ? rawForOutput
            : undefined;
      const outputStr = safeStringify(
        unwrapped ? stripDuplicateToolResultFields(unwrapped) : rawForOutput,
      );

      const usageEntry: (typeof toolsUsage)[number] = {
        toolName: toolCall.toolName,
        input: inputStr,
        output: outputStr,
      };

      if (matchingResult) {
        type ToolResultData = {
          model?: string;
          provider?: string;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
            durationSeconds?: number;
          };
        };

        const extractToolResultData = (
          val: unknown,
        ): ToolResultData | undefined => {
          if (!isRecord(val)) return undefined;
          return {
            model: typeof val.model === 'string' ? val.model : undefined,
            provider:
              typeof val.provider === 'string' ? val.provider : undefined,
            usage: isRecord(val.usage)
              ? {
                  inputTokens:
                    typeof val.usage.inputTokens === 'number'
                      ? val.usage.inputTokens
                      : undefined,
                  outputTokens:
                    typeof val.usage.outputTokens === 'number'
                      ? val.usage.outputTokens
                      : undefined,
                  totalTokens:
                    typeof val.usage.totalTokens === 'number'
                      ? val.usage.totalTokens
                      : undefined,
                  durationSeconds:
                    typeof val.usage.durationSeconds === 'number'
                      ? val.usage.durationSeconds
                      : undefined,
                }
              : undefined,
          };
        };

        const directResult = extractToolResultData(matchingResult.result);
        const outputDirect = extractToolResultData(matchingResult.output);
        const outputValueRaw = isRecord(matchingResult.output)
          ? matchingResult.output.value
          : undefined;
        const outputValue = extractToolResultData(outputValueRaw);

        const hasRelevantData = (d: ToolResultData | undefined) =>
          d?.model !== undefined || d?.usage !== undefined;
        const toolData = hasRelevantData(directResult)
          ? directResult
          : hasRelevantData(outputDirect)
            ? outputDirect
            : outputValue;
        const toolUsage = toolData?.usage;

        usageEntry.model = toolData?.model;
        usageEntry.provider = toolData?.provider;
        usageEntry.inputTokens = toolUsage?.inputTokens;
        usageEntry.outputTokens = toolUsage?.outputTokens;
        usageEntry.totalTokens = toolUsage?.totalTokens;
        usageEntry.durationMs = toolUsage?.durationSeconds
          ? Math.round(toolUsage.durationSeconds * 1000)
          : undefined;

        if (
          usageEntry.model &&
          (usageEntry.inputTokens || usageEntry.outputTokens)
        ) {
          usageEntry.costEstimateCents = estimateCostCents(
            usageEntry.model,
            usageEntry.inputTokens ?? 0,
            usageEntry.outputTokens ?? 0,
          );
        }
      }

      toolsUsage.push(usageEntry);
    }
  }

  return { toolCalls, toolsUsage, citations: allCitations };
}

/**
 * Extract unique tool names from AI SDK steps for fallback messages.
 */
export function extractToolNamesFromSteps(steps: unknown[]): string[] {
  type StepWithToolCalls = { toolCalls?: Array<{ toolName: string }> };
  const names = new Set<string>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  for (const step of steps as StepWithToolCalls[]) {
    for (const tc of step.toolCalls ?? []) {
      names.add(tc.toolName);
    }
  }
  return [...names];
}

/**
 * Walks the SDK's `savedMessages` array (one entry per saved chat
 * message during this generation) and returns the (toolCallId →
 * messageId) pairs for the named tool. Used by the post-generation hook
 * to backfill `userMemories.sourceMessageId` once the assistant turn
 * has been persisted (the convex-agent SDK does not surface the
 * assistant message id at tool-execute time).
 */
export function extractToolCallMessageMapping(
  savedMessages: unknown,
  toolName: string,
): Array<{ toolCallId: string; messageId: string }> {
  if (!Array.isArray(savedMessages)) return [];
  const mappings: Array<{ toolCallId: string; messageId: string }> = [];
  for (const entry of savedMessages) {
    if (!isRecord(entry)) continue;
    const messageId = typeof entry._id === 'string' ? entry._id : undefined;
    if (!messageId) continue;
    const message = entry.message;
    if (!isRecord(message)) continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part.type !== 'tool-call') continue;
      if (part.toolName !== toolName) continue;
      const toolCallId =
        typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
      if (!toolCallId) continue;
      mappings.push({ toolCallId, messageId });
    }
  }
  return mappings;
}
