/**
 * Normalizes raw model listings from live catalog endpoints into
 * `ModelCatalogEntry` — the one model vocabulary downstream code reads.
 *
 * One tolerant reader covers both wire dialects, because their fields are
 * near-aliases of each other:
 *
 *  - OpenRouter `/api/v1/models`: `context_length`,
 *    `architecture.{input,output}_modalities`, `pricing.{prompt,completion}`
 *    (dollars per token, as strings), `top_provider.max_completion_tokens`,
 *    `supported_parameters`.
 *  - OpenAI-compatible `/models` listings with capability metadata (e.g. the
 *    Vercel AI Gateway): `context_window`, `max_tokens`,
 *    `modalities.{input,output}`, `pricing.{input,output}`, `type`,
 *    `supported_parameters`.
 *
 * The capability facts come from the source. The only local inference is the
 * reasoning KNOB — sources report reasoning yes/no but not which wire
 * parameter the model accepts: Anthropic-family models take a thinking
 * budget, everything else the openai-style effort parameter.
 *
 * Entries without a usable id or a positive context window are dropped and
 * counted, never guessed: the catalog contract requires both, and a model the
 * platform cannot budget context for is not selectable.
 */

import type { ModelCatalogEntry } from '../schemas/providers';
import { modelCatalogEntrySchema } from '../schemas/providers';
import { stripProviderPrefix } from '../utils/model-ref';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Live catalogs price in dollars PER TOKEN, usually as strings
 * (`"0.000003"`). Cents per million tokens = $/token × 1e6 tokens × 100
 * cents = ×1e8, rounded to 6 decimals to shed binary-float noise (the
 * sources publish at most that much decimal precision). `undefined` for
 * missing or unparseable values; a `"0"` price means free and is kept as 0.
 */
function priceToCentsPerMillion(raw: unknown): number | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const dollarsPerToken =
    typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(dollarsPerToken) || dollarsPerToken < 0)
    return undefined;
  return Math.round(dollarsPerToken * 1e8 * 1e6) / 1e6;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/**
 * The reasoning-control knob for a model the source reports as
 * reasoning-capable. Anthropic-family models expect a thinking token budget;
 * everything else on an openai-compatible surface takes the effort parameter.
 */
function reasoningKnobFor(modelId: string): 'effort' | 'budget-tokens' {
  return stripProviderPrefix(modelId).startsWith('claude-')
    ? 'budget-tokens'
    : 'effort';
}

/**
 * Role tags derived from the source's modality/type signals. A listing with
 * no signal at all is assumed to be a chat model — these are LLM catalog
 * endpoints, and chat is their default population.
 */
function deriveTags(args: {
  inputModalities: string[];
  outputModalities: string[];
  entryType: string | undefined;
  supportsVision: boolean;
}): string[] {
  const tags: string[] = [];
  // OpenRouter spells the output modality PLURAL ('embeddings'); other
  // sources and the entry-type vocabulary use the singular. Accept both —
  // missing this is how an embedding model ends up invisible or, worse,
  // offered as a chat model.
  const isEmbedding =
    args.entryType === 'embedding' ||
    args.outputModalities.includes('embedding') ||
    args.outputModalities.includes('embeddings');
  const emitsText =
    args.outputModalities.includes('text') || args.entryType === 'language';
  const noSignal =
    args.outputModalities.length === 0 && args.entryType === undefined;
  if (isEmbedding) {
    tags.push('embedding');
  } else if (emitsText || noSignal) {
    tags.push('chat');
  }
  if (args.supportsVision) tags.push('vision');
  return tags;
}

export interface NormalizedCatalog {
  entries: ModelCatalogEntry[];
  /** Listing entries skipped for a missing id/context window or a shape the
   * catalog schema rejected. Callers surface the count; the entries never
   * reach model selection. */
  droppedCount: number;
}

/**
 * Normalize one raw listing entry for `provider`. Returns `null` when the
 * entry lacks a usable id or a positive context window.
 */
export function normalizeCatalogModel(
  raw: unknown,
  provider: string,
): ModelCatalogEntry | null {
  const m = asRecord(raw);
  if (!m || typeof m.id !== 'string' || m.id.length === 0) return null;

  const contextWindow =
    positiveInt(m.context_length) ?? positiveInt(m.context_window);
  if (contextWindow === undefined) return null;

  const architecture = asRecord(m.architecture);
  const modalities = asRecord(m.modalities);
  const inputModalities = [
    ...asStringArray(architecture?.input_modalities),
    ...asStringArray(modalities?.input),
  ];
  const outputModalities = [
    ...asStringArray(architecture?.output_modalities),
    ...asStringArray(modalities?.output),
  ];
  const supportsVision = inputModalities.includes('image');

  const supportedParameters = asStringArray(m.supported_parameters);
  const supportsTools =
    supportedParameters.includes('tools') ||
    supportedParameters.includes('tool_choice');
  const reportsReasoning =
    supportedParameters.includes('reasoning') ||
    supportedParameters.includes('reasoning_effort') ||
    supportedParameters.includes('include_reasoning');

  const topProvider = asRecord(m.top_provider);
  const rawMaxOutput =
    positiveInt(m.max_output_tokens) ??
    positiveInt(m.max_tokens) ??
    positiveInt(topProvider?.max_completion_tokens);
  // Some catalogs report a "max completion" equal to (or above) the full
  // context window; sending that as max output makes every non-trivial
  // request fail (input + output > context), so treat it as unreported.
  const maxOutputTokens =
    rawMaxOutput !== undefined && rawMaxOutput < contextWindow
      ? rawMaxOutput
      : undefined;

  const pricing = asRecord(m.pricing);
  const inputCentsPerMillion = priceToCentsPerMillion(
    pricing?.prompt ?? pricing?.input,
  );
  const outputCentsPerMillion = priceToCentsPerMillion(
    pricing?.completion ?? pricing?.output,
  );

  const candidate: ModelCatalogEntry = {
    id: m.id,
    provider,
    tags: deriveTags({
      inputModalities,
      outputModalities,
      entryType: typeof m.type === 'string' ? m.type : undefined,
      supportsVision,
    }),
    supportsTools,
    supportsVision,
    ...(reportsReasoning && { reasoning: { knob: reasoningKnobFor(m.id) } }),
    contextWindow,
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
    ...(inputCentsPerMillion !== undefined &&
      outputCentsPerMillion !== undefined && {
        pricing: { inputCentsPerMillion, outputCentsPerMillion },
      }),
  };
  const parsed = modelCatalogEntrySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Normalize a whole listing payload (`{ data: [...] }` or a bare array) for
 * `provider`. Ids are deduplicated first-wins so a duplicated listing row
 * cannot produce two catalog entries.
 */
export function normalizeCatalogPayload(
  payload: unknown,
  provider: string,
): NormalizedCatalog {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : [];
  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();
  let droppedCount = 0;
  for (const raw of list) {
    const entry = normalizeCatalogModel(raw, provider);
    if (entry === null) {
      droppedCount += 1;
      continue;
    }
    if (seen.has(entry.id)) {
      droppedCount += 1;
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
  }
  return { entries, droppedCount };
}
