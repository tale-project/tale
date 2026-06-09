/**
 * Normalize a raw model entry from a proven catalog source (OpenRouter's
 * `/api/v1/models`, or any OpenAI-compatible `/v1/models` that returns the same
 * rich shape) into Tale's capability shape.
 *
 * This is what replaces hand-maintaining capability facts: the *facts* (pricing,
 * context window, modalities, whether reasoning/tools are supported) come from
 * the source; only the small, stable family→knob / family→caching mapping is
 * still inferred locally (`./infer` helpers), because the unified catalog
 * reports "reasoning: yes/no" but not which wire knob a model accepts.
 *
 * Pure and dependency-light so it's unit-testable against fixture payloads.
 */

import type {
  PromptCachingCapabilityConfig,
  ReasoningCapabilityConfig,
} from '../../../../lib/shared/schemas/providers';
import { inferPromptCachingMode, inferReasoningKnob } from './infer';

/** The capability fields a catalog sync can populate for one model. */
export interface NormalizedCapability {
  modelId: string;
  /** Human catalog name (`m.name`), used by the model-sync bot to seed a new
   *  model's `displayName`. */
  displayName?: string;
  /** Whether the model emits text (a chat model) vs. embedding/image-only.
   *  Used by the model-sync bot to only auto-add chat models. Undefined when
   *  the source doesn't report output modalities. */
  isChat?: boolean;
  reasoning?: ReasoningCapabilityConfig;
  promptCaching?: PromptCachingCapabilityConfig;
  inputCentsPerMillion?: number;
  outputCentsPerMillion?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainRecord(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * OpenRouter prices are dollars PER TOKEN as strings (e.g. "0.000003").
 * cents per million tokens = $/token × 1e6 tokens × 100 cents = ×1e8.
 * Returns undefined for missing / unparseable / non-positive values (a "0"
 * price means free, which we keep as 0).
 */
function priceToCentsPerMillion(raw: unknown): number | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n * 1e8;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/**
 * Normalize one raw catalog entry. Returns `null` when the entry has no usable
 * `id`. Capability fields are only set when the source actually reports them,
 * so a sparse `/v1/models` (just `{id}`) yields a near-empty entry; operator
 * provider-config values then take precedence over whatever the cache holds.
 */
export function normalizeCatalogModel(
  raw: unknown,
): NormalizedCapability | null {
  const m = asRecord(raw);
  if (!m || typeof m.id !== 'string' || m.id.length === 0) return null;
  const modelId = m.id;

  const out: NormalizedCapability = { modelId };
  if (typeof m.name === 'string' && m.name.length > 0) out.displayName = m.name;

  const pricing = asRecord(m.pricing);
  if (pricing) {
    out.inputCentsPerMillion = priceToCentsPerMillion(pricing.prompt);
    out.outputCentsPerMillion = priceToCentsPerMillion(pricing.completion);
  }

  out.contextWindow =
    positiveInt(m.context_length) ?? positiveInt(m.context_window);
  const topProvider = asRecord(m.top_provider);
  out.maxOutputTokens =
    positiveInt(m.max_output_tokens) ??
    positiveInt(topProvider?.max_completion_tokens);

  const architecture = asRecord(m.architecture);
  const inputModalities = asStringArray(architecture?.input_modalities);
  if (inputModalities.length > 0) {
    out.supportsVision = inputModalities.includes('image');
  }
  const outputModalities = asStringArray(architecture?.output_modalities);
  if (outputModalities.length > 0) {
    out.isChat = outputModalities.includes('text');
  }

  const supportedParams = asStringArray(m.supported_parameters);
  if (supportedParams.length > 0) {
    out.supportsTools =
      supportedParams.includes('tools') ||
      supportedParams.includes('tool_choice');
    const reportsReasoning =
      supportedParams.includes('reasoning') ||
      supportedParams.includes('reasoning_effort') ||
      supportedParams.includes('include_reasoning');
    if (reportsReasoning) out.reasoning = inferReasoningKnob(modelId);
  }

  // Caching mode has no catalog field — infer by family.
  out.promptCaching = inferPromptCachingMode(modelId);

  return out;
}

/** Normalize a whole `{ data: [...] }` (or bare array) catalog payload. */
export function normalizeCatalogPayload(
  payload: unknown,
): NormalizedCapability[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : [];
  const out: NormalizedCapability[] = [];
  for (const raw of list) {
    const norm = normalizeCatalogModel(raw);
    if (norm) out.push(norm);
  }
  return out;
}
