/**
 * The mock's model catalog, as `GET /v1/models` lists it.
 *
 * Entries carry the fields the platform's catalog normalizer reads
 * (`context_length`, `supported_parameters`, `architecture` modalities,
 * `max_output_tokens`, `pricing` as dollars-per-token strings), so a
 * deployment pointed at the mock offers these models in its pickers, picks
 * a thinking-free one for titles, and books a non-zero cost for every turn.
 */

export interface MockModel {
  readonly id: string;
  readonly name: string;
  readonly kind: 'chat' | 'embedding';
  readonly contextLength: number;
  readonly maxOutputTokens?: number;
  readonly reasoning: boolean;
  readonly vision: boolean;
  /** Dollars per prompt token, as the listing spells it. */
  readonly promptPrice: string;
  /** Dollars per completion token. */
  readonly completionPrice: string;
  /** Dollars per cached prompt token. */
  readonly cacheReadPrice?: string;
}

const MOCK_MODELS: readonly MockModel[] = [
  {
    id: 'load-chat-fast',
    name: 'Load Chat Fast',
    kind: 'chat',
    contextLength: 128_000,
    maxOutputTokens: 16_384,
    reasoning: false,
    vision: false,
    promptPrice: '0.0000005',
    completionPrice: '0.0000015',
    cacheReadPrice: '0.00000025',
  },
  {
    id: 'load-chat-reasoning',
    name: 'Load Chat Reasoning',
    kind: 'chat',
    contextLength: 200_000,
    maxOutputTokens: 32_768,
    reasoning: true,
    vision: false,
    promptPrice: '0.000002',
    completionPrice: '0.000008',
    cacheReadPrice: '0.0000005',
  },
  {
    id: 'load-chat-vision',
    name: 'Load Chat Vision',
    kind: 'chat',
    contextLength: 128_000,
    maxOutputTokens: 16_384,
    reasoning: false,
    vision: true,
    promptPrice: '0.0000025',
    completionPrice: '0.00001',
    cacheReadPrice: '0.00000125',
  },
  {
    id: 'load-embed',
    name: 'Load Embed',
    kind: 'embedding',
    contextLength: 8192,
    reasoning: false,
    vision: false,
    promptPrice: '0.00000002',
    completionPrice: '0',
  },
];

/** The reply ceiling of a model the catalog does not know. */
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

const BY_ID = new Map(MOCK_MODELS.map((model) => [model.id, model]));

export function findMockModel(id: string): MockModel | undefined {
  return BY_ID.get(id);
}

/**
 * Whether `id` reasons when asked to. A model the catalog does not list
 * (a deployment that names its own ids against the mock) is taken at its
 * request's word: the platform only sends a reasoning control to a model
 * its catalog declares as reasoning.
 */
export function modelSupportsReasoning(id: string): boolean {
  return BY_ID.get(id)?.reasoning ?? true;
}

/** The reply ceiling of `id`. */
export function maxOutputTokensOf(id: string): number {
  return BY_ID.get(id)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

/** Fixed listing timestamp: 2026-01-01, so listings are byte-stable. */
const CREATED = 1_767_225_600;

/** One model as an OpenAI/OpenRouter-style listing entry. */
export function listingEntry(model: MockModel): Record<string, unknown> {
  const chat = model.kind === 'chat';
  return {
    id: model.id,
    object: 'model',
    created: CREATED,
    owned_by: 'tale-load',
    name: model.name,
    ...(chat ? {} : { type: 'embedding' }),
    context_length: model.contextLength,
    ...(model.maxOutputTokens !== undefined
      ? { max_output_tokens: model.maxOutputTokens }
      : {}),
    supported_parameters: chat
      ? [
          'max_tokens',
          'temperature',
          'stream',
          'stream_options',
          'tools',
          'tool_choice',
          'response_format',
          ...(model.reasoning
            ? ['reasoning', 'reasoning_effort', 'include_reasoning']
            : []),
        ]
      : ['dimensions', 'encoding_format'],
    architecture: {
      input_modalities: model.vision ? ['text', 'image'] : ['text'],
      output_modalities: chat ? ['text'] : ['embedding'],
    },
    pricing: {
      prompt: model.promptPrice,
      completion: model.completionPrice,
      ...(model.cacheReadPrice !== undefined
        ? { input_cache_read: model.cacheReadPrice }
        : {}),
    },
  };
}

/** The `GET /v1/models` body. */
export function modelsListing(): { object: 'list'; data: unknown[] } {
  return { object: 'list', data: MOCK_MODELS.map(listingEntry) };
}
