/**
 * OpenAI Chat Completions API response format helpers.
 *
 * Pure functions for building OpenAI-compatible JSON responses
 * for both streaming (SSE) and non-streaming modes.
 */

import type { Citation } from './citations';

// ---------------------------------------------------------------------------
// Non-streaming response
// ---------------------------------------------------------------------------

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export const ZERO_USAGE: OpenAIUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Generated-image entry attached to an assistant chat message. Matches the
 * OpenRouter / Vercel-Gateway `choices[0].message.images[]` convention (and
 * what `fetchChatCompletionImages` already parses) so image-producing chat
 * models surface their output instead of having it silently dropped.
 */
export interface OpenAIChatImage {
  type: 'image_url';
  image_url: { url: string };
}

type FinishReason = 'stop' | 'length' | 'tool_calls';

/**
 * Map an AI SDK `finishReason` to the OpenAI `finish_reason` enum so the
 * completion reports what actually happened (e.g. a truncated `length` finish)
 * instead of a hardcoded `stop`.
 */
export function mapFinishReason(
  aiFinishReason: string | undefined,
): FinishReason {
  switch (aiFinishReason) {
    case 'length':
      return 'length';
    case 'tool-calls':
    case 'tool_calls':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      images?: OpenAIChatImage[];
    };
    finish_reason: FinishReason;
  }>;
  usage: OpenAIUsage;
  citations: Citation[];
}

export function buildChatCompletion(
  id: string,
  model: string,
  content: string,
  created: number,
  citations: Citation[] = [],
  usage: OpenAIUsage = ZERO_USAGE,
  opts: { finishReason?: FinishReason; images?: OpenAIChatImage[] } = {},
): ChatCompletionResponse {
  const hasImages = opts.images != null && opts.images.length > 0;
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(hasImages ? { images: opts.images } : {}),
        },
        finish_reason: opts.finishReason ?? 'stop',
      },
    ],
    usage,
    citations,
  };
}

/**
 * Build a non-streaming response with tool_calls.
 */
export function buildChatCompletionWithToolCalls(
  id: string,
  model: string,
  toolCalls: OpenAIToolCall[],
  created: number,
  content: string | null = null,
  usage: OpenAIUsage = ZERO_USAGE,
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, tool_calls: toolCalls },
        finish_reason: 'tool_calls',
      },
    ],
    usage,
    citations: [],
  };
}

// ---------------------------------------------------------------------------
// Streaming chunk
// ---------------------------------------------------------------------------

interface ChatCompletionChunkDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
  images?: OpenAIChatImage[];
}

interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: ChatCompletionChunkDelta;
    finish_reason: FinishReason | null;
  }>;
  usage?: OpenAIUsage | null;
}

export function buildChatCompletionChunk(
  id: string,
  model: string,
  delta: ChatCompletionChunkDelta,
  finishReason: FinishReason | null,
  created: number,
): ChatCompletionChunk {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/**
 * Build a streaming usage-only chunk (emitted as the final chunk before [DONE]
 * when stream_options.include_usage is true). Per OpenAI spec, this chunk has
 * an empty choices array and a populated usage field.
 */
export function buildStreamingUsageChunk(
  id: string,
  model: string,
  usage: OpenAIUsage,
  created: number,
): ChatCompletionChunk {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [],
    usage,
  };
}

// ---------------------------------------------------------------------------
// SSE formatting
// ---------------------------------------------------------------------------

export function formatSSEChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function formatSSEDone(): string {
  return 'data: [DONE]\n\n';
}

export function formatSSECitations(citations: Citation[]): string {
  return `data: ${JSON.stringify({ citations })}\n\n`;
}

// ---------------------------------------------------------------------------
// Images generations response (OpenAI `/v1/images/generations` format)
// ---------------------------------------------------------------------------

export interface OpenAIImageDatum {
  /** Present when `response_format: 'url'` (default). */
  url?: string;
  /** Present when `response_format: 'b64_json'`. */
  b64_json?: string;
}

interface ImagesGenerationsResponse {
  created: number;
  data: OpenAIImageDatum[];
}

export function buildImagesGenerationsResponse(
  created: number,
  data: OpenAIImageDatum[],
): ImagesGenerationsResponse {
  return { created, data };
}

// ---------------------------------------------------------------------------
// Error response (OpenAI format)
// ---------------------------------------------------------------------------

interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export function buildOpenAIErrorBody(
  message: string,
  type: string,
  code: string | null = null,
): OpenAIErrorBody {
  return {
    error: { message, type, param: null, code },
  };
}

export function openAIErrorResponse(
  message: string,
  type: string,
  status: number,
  code: string | null = null,
): Response {
  return new Response(
    JSON.stringify(buildOpenAIErrorBody(message, type, code)),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
