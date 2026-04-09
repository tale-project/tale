/**
 * HTTP actions for OpenAI-compatible Chat Completions API.
 *
 * Endpoints:
 *   POST    /api/v1/chat/completions
 *   OPTIONS /api/v1/chat/completions
 *   GET     /api/v1/models
 *   OPTIONS /api/v1/models
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
  formatSSEChunk,
  formatSSEDone,
  openAIErrorResponse,
} from './response_format';

/**
 * Maximum time (ms) to poll for agent generation results.
 * Aligns with the platform hard limit in generate_response.ts (540s / 9 min).
 */
const MAX_POLL_MS = 540_000;
const POLL_INTERVAL_MS = 100;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Organization-Slug, X-Thread-Id',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface ChatCompletionsRequestBody {
  model?: string;
  messages?: OpenAIMessage[];
  stream?: boolean;
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

  // Create synthetic headers for better-auth's apiKey plugin
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

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/chat/completions
// ---------------------------------------------------------------------------

export const chatCompletionsHandler = httpAction(async (ctx, request) => {
  // Rate limit by IP
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

  // Authenticate
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

  // Resolve organization
  const orgSlugHeader =
    request.headers.get('x-organization-slug') ??
    request.headers.get('X-Organization-Slug');

  let orgInfo: { organizationId: string; orgSlug: string };
  try {
    orgInfo = await ctx.runQuery(
      internal.openai_compat.internal_queries.resolveUserOrganization,
      {
        userId: user.userId,
        orgSlug: orgSlugHeader ?? undefined,
      },
    );
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Failed to resolve organization';
    return openAIErrorResponse(msg, 'invalid_request_error', 400);
  }

  // Parse request body
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

  // Validate required fields
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

  // Extract last user message
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

  // Start chat via internal action
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
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start chat';

    // Detect specific error types
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

  if (shouldStream) {
    return streamOpenAIResponse(ctx, chatResult, model);
  }

  return pollOpenAIResponse(ctx, chatResult, model);
});

// ---------------------------------------------------------------------------
// Non-streaming: poll until done
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
// Streaming: SSE with OpenAI chunk format
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
      // First chunk: role announcement
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

      // Final chunk with finish_reason
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

      // Terminate SSE stream
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
  // Authenticate
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

  // Resolve organization
  const orgSlugHeader =
    request.headers.get('x-organization-slug') ??
    request.headers.get('X-Organization-Slug');

  let orgInfo: { organizationId: string; orgSlug: string };
  try {
    orgInfo = await ctx.runQuery(
      internal.openai_compat.internal_queries.resolveUserOrganization,
      {
        userId: user.userId,
        orgSlug: orgSlugHeader ?? undefined,
      },
    );
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Failed to resolve organization';
    return openAIErrorResponse(msg, 'invalid_request_error', 400);
  }

  // List agents
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
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
});

export const modelsOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
});
