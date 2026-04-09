/**
 * HTTP actions for OpenAI-compatible Chat Completions API.
 *
 * Endpoints:
 *   POST    /api/v1/chat/completions
 *   OPTIONS /api/v1/chat/completions
 *   GET     /api/v1/models
 *   OPTIONS /api/v1/models
 *
 * Two modes:
 * - Agent mode (no `tools` param): uses server-side agent tools, async generation
 * - Client tool mode (`tools` param present): uses client-defined tools, direct streamText
 */

import type { StreamId } from '@convex-dev/persistent-text-streaming';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { httpAction } from '../_generated/server';
import { createAuth } from '../auth';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { persistentStreaming } from '../streaming/helpers';
import { extractClientIp } from '../workflows/triggers/helpers/validate';
import {
  buildChatCompletion,
  buildChatCompletionChunk,
  buildChatCompletionWithToolCalls,
  formatSSEChunk,
  formatSSEDone,
  openAIErrorResponse,
  type OpenAIToolCall,
} from './response_format';

const MAX_POLL_MS = 540_000;
const POLL_INTERVAL_MS = 100;

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
// Build tool messages for continuation requests
// ---------------------------------------------------------------------------

function extractToolMessages(messages: OpenAIMessage[]) {
  const toolMessages: Array<{ role: string; content: unknown }> = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      // Save the assistant message with tool_calls
      toolMessages.push({
        role: 'assistant',
        content: msg.tool_calls.map((tc) => ({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        })),
      });
    } else if (msg.role === 'tool' && msg.tool_call_id) {
      // Save the tool result message
      toolMessages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: msg.tool_call_id,
            toolName: '',
            result: msg.content,
          },
        ],
      });
    }
  }

  return toolMessages.length > 0 ? toolMessages : undefined;
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
  const threadId =
    request.headers.get('x-thread-id') ??
    request.headers.get('X-Thread-Id') ??
    undefined;
  const generationParams = buildGenerationParams(body);
  const responseFormat = body.response_format?.type;
  const hasClientTools = Array.isArray(body.tools) && body.tools.length > 0;

  // -----------------------------------------------------------------------
  // Client tool mode: direct streamText with client-defined tools
  // -----------------------------------------------------------------------
  if (hasClientTools) {
    return handleToolCallingMode(ctx, {
      model,
      messages,
      lastUserMessage: lastUserMessage.content,
      tools: body.tools ?? [],
      shouldStream,
      threadId,
      generationParams,
      responseFormat,
      orgInfo,
      user,
    });
  }

  // -----------------------------------------------------------------------
  // Agent mode: server-side tools, async generation via persistent stream
  // -----------------------------------------------------------------------
  let chatResult: { threadId: string; streamId: string };
  try {
    chatResult = await ctx.runAction(
      internal.openai_compat.internal_actions.chatViaOpenAI,
      {
        agentSlug: model,
        organizationId: orgInfo.organizationId,
        userId: user.userId,
        userEmail: user.email,
        userName: user.name,
        message: lastUserMessage.content,
        threadId,
        enableStreaming: shouldStream,
        generationParams,
        responseFormat,
      },
    );
  } catch (error) {
    return handleChatError(error, model);
  }

  if (shouldStream) {
    return streamOpenAIResponse(ctx, chatResult, model);
  }
  return pollOpenAIResponse(ctx, chatResult, model);
});

// ---------------------------------------------------------------------------
// Client tool calling mode handler
// ---------------------------------------------------------------------------

async function handleToolCallingMode(
  ctx: ActionCtx,
  opts: {
    model: string;
    messages: OpenAIMessage[];
    lastUserMessage: string;
    tools: ChatCompletionsRequestBody['tools'];
    shouldStream: boolean;
    threadId?: string;
    generationParams?: Record<string, unknown>;
    responseFormat?: string;
    orgInfo: { organizationId: string; orgSlug: string };
    user: { userId: string; email: string; name: string };
  },
) {
  const toolMessages = extractToolMessages(opts.messages);
  const created = Math.floor(Date.now() / 1000);

  let result: {
    threadId: string;
    text: string | null;
    toolCalls: OpenAIToolCall[] | null;
    finishReason: string;
  };

  try {
    result = await ctx.runAction(
      internal.openai_compat.internal_actions.chatViaOpenAIWithTools,
      {
        agentSlug: opts.model,
        organizationId: opts.orgInfo.organizationId,
        userId: opts.user.userId,
        userEmail: opts.user.email,
        userName: opts.user.name,
        message: opts.lastUserMessage,
        threadId: opts.threadId,
        tools: opts.tools,
        toolMessages,
        generationParams: opts.generationParams,
        responseFormat: opts.responseFormat,
      },
    );
  } catch (error) {
    return handleChatError(error, opts.model);
  }

  const completionId = result.threadId;

  // Tool calls returned — return them to client
  if (result.toolCalls && result.toolCalls.length > 0) {
    if (opts.shouldStream) {
      return streamToolCallsResponse(
        completionId,
        opts.model,
        result.toolCalls,
        result.text,
        result.threadId,
        created,
      );
    }

    const response = buildChatCompletionWithToolCalls(
      completionId,
      opts.model,
      result.toolCalls,
      created,
      result.text,
    );
    return jsonResponseWithThreadId(response, result.threadId);
  }

  // No tool calls — return text
  if (opts.shouldStream) {
    return streamDirectTextResponse(
      completionId,
      opts.model,
      result.text ?? '',
      result.threadId,
      created,
    );
  }

  const response = buildChatCompletion(
    completionId,
    opts.model,
    result.text ?? '',
    created,
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
// Agent mode: poll until done (non-streaming)
// ---------------------------------------------------------------------------

async function pollOpenAIResponse(
  ctx: ActionCtx,
  chatResult: { threadId: string; streamId: string },
  model: string,
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamId is a branded string from the persistent-streaming SDK; runMutation returns plain string
  const streamId = chatResult.streamId as StreamId;
  const maxPolls = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);
  const created = Math.floor(Date.now() / 1000);

  for (let i = 0; i < maxPolls; i++) {
    const body = await persistentStreaming.getStreamBody(ctx, streamId);

    if (body.status === 'done') {
      const response = buildChatCompletion(
        chatResult.streamId,
        model,
        body.text,
        created,
      );
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (body.status === 'error' || body.status === 'timeout') {
      return openAIErrorResponse('Generation failed', 'server_error', 500);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return openAIErrorResponse(
    'Response timed out',
    'server_error',
    504,
    'timeout',
  );
}

// ---------------------------------------------------------------------------
// Agent mode: SSE streaming
// ---------------------------------------------------------------------------

async function streamOpenAIResponse(
  ctx: ActionCtx,
  chatResult: { threadId: string; streamId: string },
  model: string,
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamId is a branded string from the persistent-streaming SDK; runMutation returns plain string
  const streamId = chatResult.streamId as StreamId;
  const encoder = new TextEncoder();
  const maxPolls = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);
  const created = Math.floor(Date.now() / 1000);
  const completionId = chatResult.streamId;

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

      let lastLength = 0;
      let streamDone = false;

      for (let i = 0; i < maxPolls; i++) {
        const body = await persistentStreaming.getStreamBody(ctx, streamId);

        if (body.text.length > lastLength) {
          const delta = body.text.slice(lastLength);
          const chunk = buildChatCompletionChunk(
            completionId,
            model,
            { content: delta },
            null,
            created,
          );
          await writer.write(encoder.encode(formatSSEChunk(chunk)));
          lastLength = body.text.length;
        }

        if (
          body.status === 'done' ||
          body.status === 'error' ||
          body.status === 'timeout'
        ) {
          streamDone = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (streamDone) {
        const finalChunk = buildChatCompletionChunk(
          completionId,
          model,
          {},
          'stop',
          created,
        );
        await writer.write(encoder.encode(formatSSEChunk(finalChunk)));
      }

      await writer.write(encoder.encode(formatSSEDone()));
    } catch (error) {
      console.error('[openai_compat] Stream polling error:', error);
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
      ...CORS_HEADERS,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/models
// ---------------------------------------------------------------------------

export const modelsListHandler = httpAction(async (ctx, request) => {
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

  // oxlint-disable-next-line typescript/no-explicit-any -- listVisibleAgents returns v.any(); shape is validated at runtime
  let agents: any[];
  try {
    agents = await ctx.runAction(
      internal.openai_compat.internal_actions.listVisibleAgents,
      { orgSlug: orgInfo.orgSlug },
    );
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Failed to list models';
    return openAIErrorResponse(msg, 'server_error', 500);
  }

  const created = Math.floor(Date.now() / 1000);
  const data = agents.map((agent) => ({
    id: String(agent.name ?? ''),
    object: 'model' as const,
    created,
    owned_by: orgInfo.orgSlug,
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
