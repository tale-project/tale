import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { UpstreamWire } from './wires.ts';

/**
 * What a call used, in the one shape every wire is read into: input that no
 * cache served, input read from and written to the vendor's prompt cache,
 * and output (reasoning included, as every vendor bills it).
 */
export interface RelayUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export const NO_USAGE: RelayUsage = Object.freeze({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
});

function count(
  record: Record<string, unknown> | undefined,
  key: string,
): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function child(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

/** Anthropic counts cache reads and writes apart from `input_tokens`. */
function anthropicUsage(usage: Record<string, unknown>): Partial<RelayUsage> {
  const partial: Partial<RelayUsage> = {};
  if ('input_tokens' in usage)
    partial.inputTokens = count(usage, 'input_tokens');
  if ('cache_read_input_tokens' in usage) {
    partial.cacheReadTokens = count(usage, 'cache_read_input_tokens');
  }
  if ('cache_creation_input_tokens' in usage) {
    partial.cacheWriteTokens = count(usage, 'cache_creation_input_tokens');
  }
  if ('output_tokens' in usage)
    partial.outputTokens = count(usage, 'output_tokens');
  return partial;
}

/** OpenAI counts cached input inside `prompt_tokens` / `input_tokens`. */
function openAiUsage(
  usage: Record<string, unknown>,
  inputKey: 'prompt_tokens' | 'input_tokens',
  outputKey: 'completion_tokens' | 'output_tokens',
  detailsKey: 'prompt_tokens_details' | 'input_tokens_details',
): Partial<RelayUsage> {
  const input = count(usage, inputKey);
  const cached = Math.min(
    count(child(usage, detailsKey), 'cached_tokens'),
    input,
  );
  return {
    inputTokens: input - cached,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: count(usage, outputKey),
  };
}

/** The usage a whole (non-streamed) answer reports, or null without one. */
export function usageOfAnswer(
  wire: UpstreamWire,
  body: unknown,
): Partial<RelayUsage> | null {
  const usage = isRecord(body) ? child(body, 'usage') : undefined;
  if (usage === undefined) return null;
  switch (wire) {
    case 'anthropic':
      return anthropicUsage(usage);
    case 'openai-chat':
      return openAiUsage(
        usage,
        'prompt_tokens',
        'completion_tokens',
        'prompt_tokens_details',
      );
    case 'openai-responses':
      return openAiUsage(
        usage,
        'input_tokens',
        'output_tokens',
        'input_tokens_details',
      );
    default: {
      const _exhaustive: never = wire;
      return _exhaustive;
    }
  }
}

/**
 * The usage one streamed event reports, or null. Anthropic reports input on
 * `message_start` and the output so far on each `message_delta`; Chat
 * Completions reports both on its closing usage chunk; the Responses API on
 * the event that ends the response, however it ended.
 */
export function usageOfEvent(
  wire: UpstreamWire,
  event: Record<string, unknown>,
): Partial<RelayUsage> | null {
  switch (wire) {
    case 'anthropic': {
      if (event.type === 'message_start') {
        const usage = child(child(event, 'message'), 'usage');
        return usage === undefined ? null : anthropicUsage(usage);
      }
      if (event.type === 'message_delta') {
        const usage = child(event, 'usage');
        return usage === undefined ? null : anthropicUsage(usage);
      }
      return null;
    }
    case 'openai-chat': {
      const usage = child(event, 'usage');
      return usage === undefined
        ? null
        : openAiUsage(
            usage,
            'prompt_tokens',
            'completion_tokens',
            'prompt_tokens_details',
          );
    }
    case 'openai-responses': {
      if (
        event.type !== 'response.completed' &&
        event.type !== 'response.incomplete' &&
        event.type !== 'response.failed'
      ) {
        return null;
      }
      const usage = child(child(event, 'response'), 'usage');
      return usage === undefined
        ? null
        : openAiUsage(
            usage,
            'input_tokens',
            'output_tokens',
            'input_tokens_details',
          );
    }
    default: {
      const _exhaustive: never = wire;
      return _exhaustive;
    }
  }
}

/** Fold a reading into the running usage. Every vendor reports totals so
 * far, never increments, and a later report never counts less: the larger
 * figure stands, field by field (a closing event that leaves a field out or
 * reports it as 0 keeps what an earlier one said). */
export function foldUsage(
  running: RelayUsage,
  reading: Partial<RelayUsage>,
): RelayUsage {
  return {
    inputTokens: Math.max(reading.inputTokens ?? 0, running.inputTokens),
    cacheReadTokens: Math.max(
      reading.cacheReadTokens ?? 0,
      running.cacheReadTokens,
    ),
    cacheWriteTokens: Math.max(
      reading.cacheWriteTokens ?? 0,
      running.cacheWriteTokens,
    ),
    outputTokens: Math.max(reading.outputTokens ?? 0, running.outputTokens),
  };
}

/**
 * What a call cost, in cents, at the model's catalog prices: uncached input
 * at the input price, cache reads and writes at their own prices where the
 * catalog names them (else the input price), output at the output price.
 * Rounded to a millionth of a cent, the scale the ledger books. A model the
 * catalog prices at nothing costs nothing, as on the chat path.
 */
export function costCents(
  usage: RelayUsage,
  pricing: ModelCatalogEntry['pricing'] | undefined,
): number {
  if (pricing === undefined) return 0;
  const perToken = (centsPerMillion: number) => centsPerMillion / 1_000_000;
  const cents =
    usage.inputTokens * perToken(pricing.inputCentsPerMillion) +
    usage.cacheReadTokens *
      perToken(
        pricing.cacheReadCentsPerMillion ?? pricing.inputCentsPerMillion,
      ) +
    usage.cacheWriteTokens *
      perToken(
        pricing.cacheWriteCentsPerMillion ?? pricing.inputCentsPerMillion,
      ) +
    usage.outputTokens * perToken(pricing.outputCentsPerMillion);
  return Math.round(cents * 1e6) / 1e6;
}
