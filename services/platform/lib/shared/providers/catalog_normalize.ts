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
 *  - Both spell the prompt-cache prices `pricing.input_cache_read` /
 *    `pricing.input_cache_write` (dollars per token) — read into the entry's
 *    `cacheRead` / `cacheWrite` cents so the gateway bills a cache hit at
 *    the vendor's hit price instead of the plain input rate.
 *
 * The capability facts come from the source — or, for an entry the source
 * names without describing (a gateway's row for a vendor model), from what
 * Tale's own catalogs know about that model (`knownModel`), and otherwise
 * from neutral assumptions. The only local inference is the reasoning KNOB
 * — sources report reasoning yes/no but not which wire parameter the model
 * accepts — and it is always `effort`: a named level is
 * what every wire spells (`reasoning_effort` on an OpenAI-compatible body,
 * `output_config.effort` on the Anthropic one), whatever the model family.
 * The thinking-token budget is the Anthropic wire's legacy manual mode — the
 * generation that only took a budget is behind us, and the current one
 * refuses it outright — so a live listing never infers it; a static catalog
 * declares it deliberately, for a model known to take nothing else. Keying
 * the knob on the model's name instead is how every Claude on OpenRouter
 * ended up declaring a knob its connector could not spell, which silently
 * dropped the user's pick from the body.
 *
 * Chat and embedding entries require a positive context window. Pure STT
 * listings and image generators that write no text may publish zero or no
 * token window; 0 preserves that absence without inventing a conversational
 * budget. STT pricing may be per audio duration, so its generic
 * prompt/completion fields are not token prices.
 *
 * OpenRouter publishes what each image model accepts in a listing of its own
 * (`/api/v1/images/models`), whose `supported_parameters` is an object of
 * descriptors rather than a list of names: {@link readImageGenerationFacts}
 * reads it into the entry's `imageGeneration` facts.
 */

import {
  IMAGE_ASPECT_RATIO_PATTERN,
  IMAGE_GENERATION_TAG,
  modelCatalogEntrySchema,
  modelCatalogImageGenerationSchema,
  type ModelCatalogEntry,
  type ModelCatalogImageGeneration,
} from '@tale/shared/schemas/providers';

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

/** The most a duration-priced transcription can plausibly cost per second
 * of audio, in USD — a listing above it means some other unit, and the
 * entry stays unpriced rather than mispriced. */
const MAX_TRANSCRIPTION_USD_PER_SECOND = 0.01;

/**
 * A speech-to-text entry's price per audio minute, in cents, when its
 * listing bills by duration: OpenRouter publishes such a model's USD per
 * second of audio as its `prompt` price, with a zero `completion` price.
 * A token-billed model (a non-zero `completion`), an implausible per-second
 * figure, or no price at all leaves the entry unpriced: its transcriptions
 * count toward request limits only.
 */
function transcriptionCentsPerAudioMinute(
  pricing: Record<string, unknown> | null,
): number | undefined {
  if (pricing === null) return undefined;
  const perSecond = Number.parseFloat(String(pricing.prompt ?? ''));
  const completion = Number.parseFloat(String(pricing.completion ?? '0'));
  if (
    !Number.isFinite(perSecond) ||
    perSecond <= 0 ||
    perSecond > MAX_TRANSCRIPTION_USD_PER_SECOND ||
    !Number.isFinite(completion) ||
    completion !== 0
  ) {
    return undefined;
  }
  return Math.round(perSecond * 60 * 100 * 1e6) / 1e6;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
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
  isTranscription: boolean;
}): string[] {
  if (args.isTranscription) return ['transcription'];
  // An image GENERATOR — the fact the image-generation resolver and its
  // settings picker select on. Additive: a model that also writes text keeps
  // its chat tag below; the chat Auto pick skips it on `outputsMedia`, and
  // the chat lists skip it when it takes no tools (`answersChatTurns`).
  const generatesImages = args.outputModalities.includes('image');
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
  if (generatesImages) tags.push(IMAGE_GENERATION_TAG);
  return tags;
}

export interface NormalizedCatalog {
  entries: ModelCatalogEntry[];
  /** Listing entries skipped for a missing id/context window or a shape the
   * catalog schema rejected. Callers surface the count; the entries never
   * reach model selection. */
  droppedCount: number;
}

/** What Tale's own catalogs say about a model, by id — the facts a listing
 * that names the model without describing it leaves out. */
export type KnownModel = Pick<
  ModelCatalogEntry,
  'tags' | 'supportsTools' | 'supportsVision' | 'reasoning'
>;

export interface NormalizeCatalogOptions {
  /**
   * The context window for a BARE entry — one the listing describes by id
   * alone, with no `context_length`/`context_window` at all. That is what
   * `/v1/models` looks like on api.openai.com and on most OpenAI-compatible
   * servers (DashScope, DeepSeek, vLLM, Ollama): `id`, `object`, `created`,
   * `owned_by`. Without this option such an entry is dropped, which is right
   * for a catalog that always publishes the window (OpenRouter) and wrong for
   * a custom provider's own listing, whose every model would vanish. It is
   * offered for such a listing only, and also lets an undescribed entry read
   * as tool-capable (see {@link normalizeCatalogModel}).
   */
  readonly defaultContextWindow?: number;
  /**
   * What Tale knows about a model the listing names without describing it
   * (see {@link normalizeCatalogModel}): a gateway lists the vendor models it
   * routes by id, window and price only. Only facts of the MODEL are taken —
   * whether it sees images, takes tools, and whether its reasoning effort can
   * be set — never how one vendor's wire spells them (a reasoning-off value,
   * a Responses-only tool API): a gateway translates the wire its own way.
   * The direct chat call still reads those vendor facts to ask a gateway's
   * own Responses API for such a model, since a gateway's translation back
   * into Chat Completions can lose a tool call's arguments
   * (`backend/core/chat/gateway_wire.ts`).
   */
  readonly knownModel?: (id: string) => KnownModel | undefined;
}

/**
 * Normalize one raw listing entry for `provider`. Returns `null` when the
 * entry lacks a usable id or the context its declared model kind requires.
 */
export function normalizeCatalogModel(
  raw: unknown,
  provider: string,
  options: NormalizeCatalogOptions = {},
): ModelCatalogEntry | null {
  const m = asRecord(raw);
  if (!m || typeof m.id !== 'string' || m.id.length === 0) return null;

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
  // A media GENERATOR (Lyria music, image/video models) — often listed with
  // image input, text among its outputs, and a 0 token price (billing is per
  // artifact), so without this fact it reads as a free vision chat model.
  const outputsMedia = ['audio', 'image', 'video'].some((modality) =>
    outputModalities.includes(modality),
  );
  const entryType = typeof m.type === 'string' ? m.type : undefined;
  // Audio input with text output also describes multimodal chat. Only an
  // explicit STT type or exclusively transcription output declares ASR.
  const isTranscription =
    !outputsMedia &&
    entryType !== 'embedding' &&
    !outputModalities.some(
      (modality) => modality === 'embedding' || modality === 'embeddings',
    ) &&
    (entryType === 'transcription' ||
      (outputModalities.length > 0 &&
        outputModalities.every((modality) => modality === 'transcription')));
  const absentTokenWindow = [m.context_length, m.context_window].every(
    (value) => value === undefined || value === 0 || value === '0',
  );
  const publishedWindow =
    positiveInt(m.context_length) ?? positiveInt(m.context_window);
  // A bare entry: the listing names the model and nothing about its window.
  // With a default on offer it stands in for the window the server did not
  // publish; without one the entry is unusable and dropped.
  const bareEntry =
    !isTranscription &&
    publishedWindow === undefined &&
    absentTokenWindow &&
    options.defaultContextWindow !== undefined;
  // An image generator that writes no text reads a prompt and nothing else,
  // so a listing may publish no window for it (OpenRouter lists Seedream 5.0
  // with 0): kept with 0, like transcription, instead of being dropped.
  const drawsOnly =
    outputModalities.includes('image') &&
    !outputModalities.includes('text') &&
    entryType !== 'language';
  const contextWindow =
    publishedWindow ??
    (isTranscription && absentTokenWindow
      ? 0
      : bareEntry
        ? options.defaultContextWindow
        : drawsOnly && absentTokenWindow
          ? 0
          : undefined);
  if (contextWindow === undefined) return null;

  // An UNDESCRIBED entry: no type, no modalities, no parameters — the listing
  // names the model and says nothing about what it is or takes. A server's
  // bare `/v1/models` row looks like this, and so does a gateway's row for a
  // vendor model it routes (Bifrost publishes a window and a price only).
  // In a custom provider's listing such an entry reads as tool-capable, the
  // same neutral assumption an allowlist entry carries (a server that refuses
  // tools fails loudly on the wire, never silently), and as unable to see
  // images (unknown must read as "cannot", so images reach it as text). Where
  // Tale's own catalogs know the model, their facts replace both assumptions
  // — and a model they know is not a chat model (an embedding, speech or
  // image model) is not offered as one, nor assumed to be anything else.
  const undescribed =
    entryType === undefined &&
    architecture === null &&
    modalities === null &&
    m.supported_parameters === undefined;
  const customListing = options.defaultContextWindow !== undefined;
  const known = undescribed ? options.knownModel?.(m.id) : undefined;
  const knownNotChat = known !== undefined && !known.tags.includes('chat');

  const supportsVision =
    !isTranscription &&
    !knownNotChat &&
    (inputModalities.includes('image') || known?.supportsVision === true);

  const supportedParameters = asStringArray(m.supported_parameters);
  const supportsTools =
    !isTranscription &&
    !knownNotChat &&
    (supportedParameters.includes('tools') ||
      supportedParameters.includes('tool_choice') ||
      (undescribed && (known?.supportsTools ?? customListing)));
  const reportsReasoning =
    !isTranscription &&
    !knownNotChat &&
    (supportedParameters.includes('reasoning') ||
      supportedParameters.includes('reasoning_effort') ||
      supportedParameters.includes('include_reasoning') ||
      // Effort is spelled on every wire; a thinking-token budget is not.
      known?.reasoning?.knob === 'effort');

  const topProvider = asRecord(m.top_provider);
  const rawMaxOutput =
    positiveInt(m.max_output_tokens) ??
    positiveInt(m.max_tokens) ??
    positiveInt(topProvider?.max_completion_tokens);
  // Some catalogs report a "max completion" equal to (or above) the full
  // context window; sending that as max output makes every non-trivial
  // request fail (input + output > context), so treat it as unreported.
  const maxOutputTokens =
    !isTranscription &&
    rawMaxOutput !== undefined &&
    rawMaxOutput < contextWindow
      ? rawMaxOutput
      : undefined;

  const pricing = isTranscription ? null : asRecord(m.pricing);
  const centsPerAudioMinute = isTranscription
    ? transcriptionCentsPerAudioMinute(asRecord(m.pricing))
    : undefined;
  const inputCentsPerMillion = priceToCentsPerMillion(
    pricing?.prompt ?? pricing?.input,
  );
  const outputCentsPerMillion = priceToCentsPerMillion(
    pricing?.completion ?? pricing?.output,
  );
  // Both dialects spell the prompt-cache prices the same way. A hit price
  // above the plain input price is a listing glitch, not a rate — dropped so
  // the gateway bills the hit at the input rate rather than above it; the
  // write price is kept as published (Anthropic-style writes cost MORE than
  // input by design).
  const cacheRead = priceToCentsPerMillion(pricing?.input_cache_read);
  const cacheReadCentsPerMillion =
    cacheRead !== undefined &&
    inputCentsPerMillion !== undefined &&
    cacheRead <= inputCentsPerMillion
      ? cacheRead
      : undefined;
  const cacheWriteCentsPerMillion = priceToCentsPerMillion(
    pricing?.input_cache_write,
  );

  const candidate: ModelCatalogEntry = {
    id: m.id,
    provider,
    tags: knownNotChat
      ? []
      : deriveTags({
          inputModalities,
          outputModalities,
          entryType,
          supportsVision,
          isTranscription,
        }),
    supportsTools,
    supportsVision,
    ...(outputsMedia && { outputsMedia }),
    // The named-level knob, whatever the family — see the module doc.
    ...(reportsReasoning && { reasoning: { knob: 'effort' as const } }),
    contextWindow,
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
    ...(centsPerAudioMinute !== undefined && {
      transcription: { centsPerAudioMinute },
    }),
    ...(inputCentsPerMillion !== undefined &&
      outputCentsPerMillion !== undefined && {
        pricing: {
          inputCentsPerMillion,
          outputCentsPerMillion,
          ...(cacheReadCentsPerMillion !== undefined && {
            cacheReadCentsPerMillion,
          }),
          ...(cacheWriteCentsPerMillion !== undefined && {
            cacheWriteCentsPerMillion,
          }),
        },
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
  options: NormalizeCatalogOptions = {},
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
    const entry = normalizeCatalogModel(raw, provider, options);
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

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * The image facts one entry of OpenRouter's image model listing
 * (`/api/v1/images/models`) publishes, or `null` when it names no model. Its
 * `supported_parameters` maps each request parameter to a descriptor —
 * `{type: 'enum', values}`, `{type: 'range', min, max}` or
 * `{type: 'boolean'}`. Only the facts the image wire acts on are read, and a
 * fact the entry leaves out stays unknown rather than read as "unsupported":
 * the listing omits parameters some models still take (Meta's Muse Image
 * lists none and draws every aspect ratio asked of it).
 */
export function readImageGenerationFacts(
  raw: unknown,
): { id: string; facts: ModelCatalogImageGeneration } | null {
  const m = asRecord(raw);
  if (!m || typeof m.id !== 'string' || m.id.length === 0) return null;
  const parameters = asRecord(m.supported_parameters);
  // Each fact stands on its own: one out of the bounds the schema knows is
  // left unknown, and never takes the others with it — the formats that
  // mark a vector model, say, whatever its list of shapes looks like.
  const shape = modelCatalogImageGenerationSchema.shape;
  const facts: ModelCatalogImageGeneration = {};
  const ratios = asRecord(parameters?.aspect_ratio);
  if (ratios?.type === 'enum') {
    const read = shape.aspectRatios.safeParse([
      ...new Set(
        asStringArray(ratios.values).filter((value) =>
          IMAGE_ASPECT_RATIO_PATTERN.test(value),
        ),
      ),
    ]);
    if (read.success && read.data !== undefined) facts.aspectRatios = read.data;
  }
  const references = asRecord(parameters?.input_references);
  if (references?.type === 'range') {
    const min = nonNegativeInt(references.min) ?? 0;
    const max = nonNegativeInt(references.max);
    const read = shape.referenceImages.safeParse(
      max === undefined ? { min } : { min, max },
    );
    if (read.success && read.data !== undefined) {
      facts.referenceImages = read.data;
    }
  }
  const formats = asRecord(parameters?.output_format);
  if (formats?.type === 'enum') {
    const read = shape.outputFormats.safeParse([
      ...new Set(
        asStringArray(formats.values)
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value !== ''),
      ),
    ]);
    if (read.success && read.data !== undefined) {
      facts.outputFormats = read.data;
    }
  }
  return { id: m.id, facts };
}

/** Every model's image facts in one OpenRouter image model listing
 * (`{ data: [...] }`), keyed by model id; the first entry of an id decides
 * it, and a model that publishes none is left out. */
export function readImageGenerationFactsListing(
  payload: unknown,
): Map<string, ModelCatalogImageGeneration> {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : [];
  const facts = new Map<string, ModelCatalogImageGeneration>();
  const seen = new Set<string>();
  for (const raw of list) {
    const read = readImageGenerationFacts(raw);
    if (read === null || seen.has(read.id)) continue;
    seen.add(read.id);
    if (Object.keys(read.facts).length === 0) continue;
    facts.set(read.id, read.facts);
  }
  return facts;
}
