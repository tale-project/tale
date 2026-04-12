/**
 * HTTP actions for OpenAI-compatible Chat Completions API.
 *
 * Endpoints:
 *   POST    /api/v1/chat/completions
 *   OPTIONS /api/v1/chat/completions
 *   GET     /api/v1/models
 *   OPTIONS /api/v1/models
 *
 * Direct model gateway: routes requests to providers by model ID.
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { httpAction } from '../_generated/server';
import { createAuth } from '../auth';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { extractClientIp } from '../workflows/triggers/helpers/validate';
import {
  buildChatCompletion,
  buildChatCompletionChunk,
  buildChatCompletionWithToolCalls,
  buildStreamingUsageChunk,
  formatSSEChunk,
  formatSSEDone,
  openAIErrorResponse,
  type OpenAIToolCall,
  type OpenAIUsage,
} from './response_format';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Organization-Slug, X-Thread-Id',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatCompletionsRequestBody {
  model?: string;
  messages?: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  response_format?: { type?: string };
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: unknown };
  }>;
  tool_choice?: unknown;
  stream_options?: { include_usage?: boolean } | null;
  seed?: number;
  n?: number;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function authenticateRequest(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
): Promise<{ userId: string; email: string; name: string }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header');
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();
  if (!apiKey) {
    throw new AuthError('Empty API key');
  }

  const syntheticHeaders = new Headers();
  syntheticHeaders.set('x-api-key', apiKey);

  const auth = createAuth(ctx);
  try {
    const session = await auth.api.getSession({
      headers: syntheticHeaders,
    });

    if (!session?.user) {
      throw new AuthError('Invalid API key or session');
    }

    return {
      userId: session.user.id,
      email: session.user.email ?? '',
      name: session.user.name ?? '',
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid API key or session');
  }
}

// ---------------------------------------------------------------------------
// Build generation params from request body
// ---------------------------------------------------------------------------

function buildGenerationParams(body: ChatCompletionsRequestBody) {
  const params: Record<string, unknown> = {};
  if (body.temperature != null) params.temperature = body.temperature;
  if (body.max_tokens != null) params.maxTokens = body.max_tokens;
  if (body.top_p != null) params.topP = body.top_p;
  if (body.frequency_penalty != null)
    params.frequencyPenalty = body.frequency_penalty;
  if (body.presence_penalty != null)
    params.presencePenalty = body.presence_penalty;
  if (body.stop != null) {
    params.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

// ---------------------------------------------------------------------------
// Convert OpenAI messages to AI SDK ModelMessage format for continuation
// ---------------------------------------------------------------------------

function hasToolInteraction(messages: OpenAIMessage[]): boolean {
  return messages.some(
    (m) =>
      (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) ||
      m.role === 'tool',
  );
}

/**
 * Convert the full OpenAI messages array to AI SDK ModelMessage format.
 * Used for tool-calling continuation so the LLM sees the complete conversation
 * including previous tool_calls and tool results.
 */
function convertToModelMessages(
  messages: OpenAIMessage[],
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content ?? '' });
    } else if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content ?? '' });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant message with tool calls
        const content: Array<Record<string, unknown>> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool-call',
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}'),
          });
        }
        result.push({ role: 'assistant', content });
      } else {
        result.push({
          role: 'assistant',
          content: msg.content ?? '',
        });
      }
    } else if (msg.role === 'tool' && msg.tool_call_id) {
      // Look up tool name from the preceding assistant message's tool_calls
      const toolName =
        messages
          .filter(
            (
              m,
            ): m is OpenAIMessage & {
              tool_calls: NonNullable<OpenAIMessage['tool_calls']>;
            } => m.role === 'assistant' && !!m.tool_calls,
          )
          .flatMap((m) => m.tool_calls)
          .find((tc) => tc.id === msg.tool_call_id)?.function.name ?? '';

      result.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: msg.tool_call_id,
            toolName,
            output: { type: 'text', value: msg.content ?? '' },
          },
        ],
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// POST /api/v1/chat/completions
// ---------------------------------------------------------------------------

export const chatCompletionsHandler = httpAction(async (ctx, request) => {
  // Rate limit
  const ip = extractClientIp(request.headers);
  try {
    await checkIpRateLimit(ctx, 'openai:chat', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return openAIErrorResponse(
        'Rate limit exceeded',
        'rate_limit_exceeded',
        429,
        'rate_limit_exceeded',
      );
    }
    throw error;
  }

  // Auth
  let user: { userId: string; email: string; name: string };
  try {
    user = await authenticateRequest(ctx, request);
  } catch (error) {
    if (error instanceof AuthError) {
      return openAIErrorResponse(
        error.message,
        'invalid_request_error',
        401,
        'invalid_api_key',
      );
    }
    throw error;
  }

  // Org
  const orgSlugHeader =
    request.headers.get('x-organization-slug') ??
    request.headers.get('X-Organization-Slug');

  let orgInfo: { organizationId: string; orgSlug: string };
  try {
    orgInfo = await ctx.runQuery(
      internal.openai_compat.internal_queries.resolveUserOrganization,
      { userId: user.userId, orgSlug: orgSlugHeader ?? undefined },
    );
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Failed to resolve organization';
    return openAIErrorResponse(msg, 'invalid_request_error', 400);
  }

  // Parse body
  let body: ChatCompletionsRequestBody;
  try {
    body = await request.json();
  } catch {
    return openAIErrorResponse(
      'Invalid JSON body',
      'invalid_request_error',
      400,
    );
  }

  // Validate
  const model = body.model;
  if (!model || typeof model !== 'string') {
    return openAIErrorResponse(
      'Missing or invalid "model" field',
      'invalid_request_error',
      400,
      'model_required',
    );
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return openAIErrorResponse(
      'Missing or empty "messages" array',
      'invalid_request_error',
      400,
    );
  }

  const lastUserMessage = messages.findLast((m) => m.role === 'user');
  if (!lastUserMessage || typeof lastUserMessage.content !== 'string') {
    return openAIErrorResponse(
      'No user message found in messages array',
      'invalid_request_error',
      400,
    );
  }

  const shouldStream = body.stream === true;
  const includeUsage =
    shouldStream && body.stream_options?.include_usage === true;
  const threadId =
    request.headers.get('x-thread-id') ??
    request.headers.get('X-Thread-Id') ??
    undefined;
  const generationParams = buildGenerationParams(body);
  const responseFormat = body.response_format?.type;

  // -----------------------------------------------------------------------
  // Direct model mode: route to provider via model ID
  // -----------------------------------------------------------------------
  const isContinuation = hasToolInteraction(messages);
  const conversationMessages = isContinuation
    ? convertToModelMessages(messages)
    : undefined;

  // Strip $-prefixed keys from tool parameters (Convex reserves $ prefix)
  const tools = body.tools?.map((t) => ({
    ...t,
    function: {
      ...t.function,
      parameters: t.function.parameters
        ? stripDollarKeys(t.function.parameters)
        : undefined,
    },
  }));

  return handleDirectModelMode(ctx, {
    model,
    messages,
    lastUserMessage: lastUserMessage.content,
    tools,
    toolChoice: body.tool_choice,
    shouldStream,
    includeUsage,
    threadId,
    generationParams,
    responseFormat,
    conversationMessages,
    orgInfo,
    user,
  });
});

/** Recursively strip keys starting with '$' (Convex reserves this prefix). */
function stripDollarKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripDollarKeys);
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!k.startsWith('$')) result[k] = stripDollarKeys(v);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Direct model mode handler
// ---------------------------------------------------------------------------

async function handleDirectModelMode(
  ctx: ActionCtx,
  opts: {
    model: string;
    messages: OpenAIMessage[];
    lastUserMessage: string;
    tools?: ChatCompletionsRequestBody['tools'];
    toolChoice?: unknown;
    shouldStream: boolean;
    includeUsage: boolean;
    threadId?: string;
    generationParams?: Record<string, unknown>;
    responseFormat?: string;
    conversationMessages?: Array<Record<string, unknown>>;
    orgInfo: { organizationId: string; orgSlug: string };
    user: { userId: string; email: string; name: string };
  },
) {
  const created = Math.floor(Date.now() / 1000);

  let result: {
    threadId: string;
    text: string | null;
    toolCalls: OpenAIToolCall[] | null;
    finishReason: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    resolvedModel: string;
  };

  try {
    result = await ctx.runAction(
      internal.openai_compat.internal_actions.chatDirectModel,
      {
        modelId: opts.model,
        organizationId: opts.orgInfo.organizationId,
        userId: opts.user.userId,
        userEmail: opts.user.email,
        userName: opts.user.name,
        message: opts.lastUserMessage,
        threadId: opts.threadId,
        tools: opts.tools,
        toolChoice: opts.toolChoice,
        conversationMessages: opts.conversationMessages,
        generationParams: opts.generationParams,
        responseFormat: opts.responseFormat,
      },
    );
  } catch (error) {
    return handleChatError(error, opts.model);
  }

  const completionId = result.threadId;
  const responseModel = result.resolvedModel ?? opts.model;
  const usage: OpenAIUsage = {
    prompt_tokens: result.inputTokens,
    completion_tokens: result.outputTokens,
    total_tokens: result.totalTokens,
  };

  // Tool calls returned — return them to client
  if (result.toolCalls && result.toolCalls.length > 0) {
    if (opts.shouldStream) {
      return streamToolCallsResponse(
        completionId,
        responseModel,
        result.toolCalls,
        result.text,
        result.threadId,
        created,
        opts.includeUsage ? usage : undefined,
      );
    }

    const response = buildChatCompletionWithToolCalls(
      completionId,
      responseModel,
      result.toolCalls,
      created,
      result.text,
      usage,
    );
    return jsonResponseWithThreadId(response, result.threadId);
  }

  // No tool calls — return text
  if (opts.shouldStream) {
    return streamDirectTextResponse(
      completionId,
      responseModel,
      result.text ?? '',
      result.threadId,
      created,
      opts.includeUsage ? usage : undefined,
    );
  }

  const response = buildChatCompletion(
    completionId,
    responseModel,
    result.text ?? '',
    created,
    [],
    usage,
  );
  return jsonResponseWithThreadId(response, result.threadId);
}

function jsonResponseWithThreadId(body: unknown, threadId: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Thread-Id': threadId,
    },
  });
}

// ---------------------------------------------------------------------------
// Stream tool_calls response (for client tool mode + streaming)
// ---------------------------------------------------------------------------

function streamToolCallsResponse(
  completionId: string,
  model: string,
  toolCalls: OpenAIToolCall[],
  text: string | null,
  threadId: string,
  created: number,
  usage?: OpenAIUsage,
): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  void (async () => {
    try {
      // Role chunk
      const roleChunk = buildChatCompletionChunk(
        completionId,
        model,
        { role: 'assistant' },
        null,
        created,
      );
      await writer.write(encoder.encode(formatSSEChunk(roleChunk)));

      // Text content if any
      if (text) {
        const textChunk = buildChatCompletionChunk(
          completionId,
          model,
          { content: text },
          null,
          created,
        );
        await writer.write(encoder.encode(formatSSEChunk(textChunk)));
      }

      // Tool calls chunk
      const toolCallsChunk = buildChatCompletionChunk(
        completionId,
        model,
        {
          tool_calls: toolCalls.map((tc, index) => ({
            index,
            id: tc.id,
            type: tc.type,
            function: tc.function,
          })),
        },
        null,
        created,
      );
      await writer.write(encoder.encode(formatSSEChunk(toolCallsChunk)));

      // Finish chunk
      const finishChunk = buildChatCompletionChunk(
        completionId,
        model,
        {},
        'tool_calls',
        created,
      );
      await writer.write(encoder.encode(formatSSEChunk(finishChunk)));

      // Usage chunk (only when stream_options.include_usage is true)
      if (usage) {
        const usageChunk = buildStreamingUsageChunk(
          completionId,
          model,
          usage,
          created,
        );
        await writer.write(encoder.encode(formatSSEChunk(usageChunk)));
      }

      await writer.write(encoder.encode(formatSSEDone()));
    } catch (error) {
      console.error('[openai_compat] Tool calls stream error:', error);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Thread-Id': threadId,
      ...CORS_HEADERS,
    },
  });
}

// ---------------------------------------------------------------------------
// Stream direct text response (for client tool mode, text result)
// ---------------------------------------------------------------------------

function streamDirectTextResponse(
  completionId: string,
  model: string,
  text: string,
  threadId: string,
  created: number,
  usage?: OpenAIUsage,
): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  void (async () => {
    try {
      const roleChunk = buildChatCompletionChunk(
        completionId,
        model,
        { role: 'assistant' },
        null,
        created,
      );
      await writer.write(encoder.encode(formatSSEChunk(roleChunk)));

      if (text) {
        const contentChunk = buildChatCompletionChunk(
          completionId,
          model,
          { content: text },
          null,
          created,
        );
        await writer.write(encoder.encode(formatSSEChunk(contentChunk)));
      }

      const finishChunk = buildChatCompletionChunk(
        completionId,
        model,
        {},
        'stop',
        created,
      );
      await writer.write(encoder.encode(formatSSEChunk(finishChunk)));

      // Usage chunk (only when stream_options.include_usage is true)
      if (usage) {
        const usageChunk = buildStreamingUsageChunk(
          completionId,
          model,
          usage,
          created,
        );
        await writer.write(encoder.encode(formatSSEChunk(usageChunk)));
      }

      await writer.write(encoder.encode(formatSSEDone()));
    } catch (error) {
      console.error('[openai_compat] Direct text stream error:', error);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Thread-Id': threadId,
      ...CORS_HEADERS,
    },
  });
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function handleChatError(error: unknown, model: string): Response {
  const msg = error instanceof Error ? error.message : 'Failed to start chat';

  if (msg.includes('Agent not found')) {
    return openAIErrorResponse(
      `Model '${model}' not found`,
      'invalid_request_error',
      404,
      'model_not_found',
    );
  }
  if (msg.includes('Not a member') || msg.includes('disabled')) {
    return openAIErrorResponse(msg, 'permission_error', 403);
  }

  return openAIErrorResponse(msg, 'server_error', 500);
}

// ---------------------------------------------------------------------------
// GET /api/v1/models
// ---------------------------------------------------------------------------

export const modelsListHandler = httpAction(async (ctx, request) => {
  try {
    await authenticateRequest(ctx, request);
  } catch (error) {
    if (error instanceof AuthError) {
      return openAIErrorResponse(
        error.message,
        'invalid_request_error',
        401,
        'invalid_api_key',
      );
    }
    throw error;
  }

  let models: Array<{
    id: string;
    tags: string[];
    providerName: string;
    displayName?: string;
  }>;
  try {
    models = await ctx.runAction(
      internal.providers.file_actions.getAllModelIds,
      {},
    );
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Failed to list models';
    return openAIErrorResponse(msg, 'server_error', 500);
  }

  const created = Math.floor(Date.now() / 1000);
  const data = models.map((m) => ({
    id: m.id,
    object: 'model' as const,
    created,
    owned_by: m.providerName,
  }));

  return new Response(JSON.stringify({ object: 'list', data }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ---------------------------------------------------------------------------
// OPTIONS handlers (CORS preflight)
// ---------------------------------------------------------------------------

export const chatCompletionsOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
});

export const modelsOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
});
