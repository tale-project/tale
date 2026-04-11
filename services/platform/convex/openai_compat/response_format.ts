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

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type FinishReason = 'stop' | 'length' | 'tool_calls';

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
    };
    finish_reason: FinishReason;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  citations: Citation[];
}

export function buildChatCompletion(
  id: string,
  model: string,
  content: string,
  created: number,
  citations: Citation[] = [],
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
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
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
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
