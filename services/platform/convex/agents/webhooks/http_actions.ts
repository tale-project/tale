import type { StreamId } from '@convex-dev/persistent-text-streaming';

import { isRecord } from '../../../lib/utils/type-guards';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { httpAction } from '../../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import {
  buildChatCompletion,
  openAIErrorResponse,
  ZERO_USAGE,
  type OpenAIUsage,
} from '../../openai_compat/response_format';
import { persistentStreaming } from '../../streaming/helpers';
import { hashSecret } from '../../workflows/triggers/helpers/crypto';
import { extractClientIp } from '../../workflows/triggers/helpers/validate';

/**
 * Maximum time (ms) to poll for agent generation results.
 * Aligns with the platform hard limit in generate_response.ts (540s / 9 min)
 * so the webhook waits long enough for any generation to complete.
 */
const MAX_POLL_MS = 540_000;
const POLL_INTERVAL_MS = 100;

/**
 * Upper bound on the concatenated client-side `system` message text length.
 * Rejected with 413 on overflow; prevents a token-holder from flooding the
 * model's context window via the OpenAI-compat path.
 * ~12.5k tokens at 4 chars/token — well below typical context budgets.
 */
const MAX_CLIENT_SYSTEM_CHARS = 50_000;

/** Webhook token format — 32 random bytes hex-encoded. */
const TOKEN_REGEX = /^[0-9a-f]{64}$/;

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

type Attachment = {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type WebhookRecord = {
  _id: Id<'agentWebhooks'>;
  organizationId: string;
  agentSlug: string;
  isActive: boolean;
  createdByUserId?: string;
};

type RouteMode = 'legacy' | 'openai';

/**
 * Parse `/api/agents/wh/<TOKEN>` (legacy) or
 * `/api/agents/wh/<TOKEN>/chat/completions` (OpenAI-compat).
 * Token is always at fixed index 3; suffix determines the wire format.
 */
function parseWebhookPath(
  pathname: string,
): { token: string; mode: RouteMode } | { error: string; status: number } {
  const parts = pathname.split('/').filter(Boolean);
  if (
    parts.length < 4 ||
    parts[0] !== 'api' ||
    parts[1] !== 'agents' ||
    parts[2] !== 'wh'
  ) {
    return { error: 'Invalid webhook URL', status: 400 };
  }
  const token = parts[3];
  const suffix = parts.slice(4);
  if (suffix.length === 0) {
    return { token, mode: 'legacy' };
  }
  if (
    suffix.length === 2 &&
    suffix[0] === 'chat' &&
    suffix[1] === 'completions'
  ) {
    return { token, mode: 'openai' };
  }
  return { error: 'Unknown webhook sub-path', status: 404 };
}

export const agentWebhookHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const parsed = parseWebhookPath(url.pathname);
  if ('error' in parsed) {
    return jsonResponse({ error: parsed.error }, parsed.status);
  }
  const { token, mode } = parsed;

  // Early token-format rejection — defense-in-depth against malformed probes.
  if (!TOKEN_REGEX.test(token)) {
    if (mode === 'openai') {
      return openAIErrorResponse(
        'Invalid webhook token',
        'invalid_request_error',
        401,
        'invalid_api_key',
      );
    }
    return jsonResponse({ error: 'Invalid webhook token' }, 401);
  }

  const ip = extractClientIp(req.headers);
  try {
    await checkIpRateLimit(ctx, 'agent:webhook', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      if (mode === 'openai') {
        return openAIErrorResponse(
          'Rate limit exceeded',
          'rate_limit_error',
          429,
          'rate_limit_exceeded',
        );
      }
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }
    throw error;
  }

  const webhook = (await ctx.runQuery(
    internal.agents.webhooks.internal_queries.getWebhookByToken,
    { token },
  )) as WebhookRecord | null;

  if (!webhook) {
    if (mode === 'openai') {
      return openAIErrorResponse(
        'Invalid webhook token',
        'invalid_request_error',
        401,
        'invalid_api_key',
      );
    }
    return jsonResponse({ error: 'Invalid webhook token' }, 404);
  }

  if (!webhook.isActive) {
    if (mode === 'openai') {
      return openAIErrorResponse(
        'Webhook is disabled',
        'permission_error',
        403,
      );
    }
    return jsonResponse({ error: 'Webhook is disabled' }, 403);
  }

  if (mode === 'openai') {
    return handleOpenAIRequest(ctx, req, webhook);
  }
  return handleLegacyRequest(ctx, req, webhook);
});

// ---------------------------------------------------------------------------
// Legacy handler — unchanged wire format: { message, threadId?, stream? }
// ---------------------------------------------------------------------------

async function handleLegacyRequest(
  ctx: ActionCtx,
  req: Request,
  webhook: WebhookRecord,
) {
  const contentType = req.headers.get('Content-Type') ?? '';
  const isMultipart = contentType.startsWith('multipart/form-data');

  let message: string;
  let threadId: string | undefined;
  let shouldStream = false;
  let attachment: Attachment | undefined;

  if (isMultipart) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonResponse({ error: 'Invalid multipart form data' }, 400);
    }

    const msgField = formData.get('message');
    if (!msgField || typeof msgField !== 'string') {
      return jsonResponse({ error: 'Missing or invalid "message" field' }, 400);
    }
    message = msgField;

    const tidField = formData.get('threadId');
    if (tidField && typeof tidField === 'string') {
      threadId = tidField;
    }

    const streamField = formData.get('stream');
    shouldStream = streamField === 'true';

    const file = formData.get('file');
    if (file instanceof File) {
      const storageId = await ctx.storage.store(file);
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.saveFileMetadata,
        {
          organizationId: webhook.organizationId,
          storageId,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          source: 'agent',
        },
      );
      attachment = {
        fileId: storageId,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
      };
    }
  } else {
    let body: {
      message?: string;
      threadId?: string;
      stream?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.message || typeof body.message !== 'string') {
      return jsonResponse({ error: 'Missing or invalid "message" field' }, 400);
    }
    message = body.message;
    threadId = body.threadId;
    shouldStream = body.stream === true;
  }

  await ctx.runMutation(
    internal.agents.webhooks.internal_mutations.updateWebhookLastTriggered,
    { webhookId: webhook._id, lastTriggeredAt: Date.now() },
  );

  let chatResult: { threadId: string; streamId: string };
  try {
    chatResult = await ctx.runAction(
      internal.agents.webhooks.internal_actions.chatViaWebhook,
      {
        agentSlug: webhook.agentSlug,
        organizationId: webhook.organizationId,
        webhookId: webhook._id,
        message,
        threadId,
        enableStreaming: shouldStream,
        attachments: attachment ? [attachment] : undefined,
        chatOwnerId: webhook.createdByUserId,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start chat';
    const status = isOrgBoundaryError(msg) ? 403 : 500;
    return jsonResponse({ error: msg }, status);
  }

  if (shouldStream) {
    return streamResponse(ctx, chatResult);
  }
  return pollResponse(ctx, chatResult);
}

// ---------------------------------------------------------------------------
// OpenAI-compat handler — standard ChatCompletion wire format
// ---------------------------------------------------------------------------

type OpenAIMessage = {
  role?: unknown;
  content?: unknown;
};

type OpenAIRequestBody = {
  model?: unknown;
  messages?: unknown;
  /**
   * Legacy end-user identifier (OpenAI spec). Deprecated in favor of
   * `safety_identifier`; still accepted for backward compat. When both are
   * present, `safety_identifier` wins.
   */
  user?: unknown;
  /** Current OpenAI end-user identifier (2025+), replaces `user`. */
  safety_identifier?: unknown;
  stream?: unknown;
};

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    if (raw.type === 'text' && typeof raw.text === 'string') {
      parts.push(raw.text);
    }
  }
  return parts.join('');
}

function isMessage(m: unknown): m is OpenAIMessage {
  return isRecord(m);
}

function extractLastUserMessage(messages: OpenAIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return contentToString(messages[i].content);
    }
  }
  return null;
}

function collectSystemPrompts(messages: OpenAIMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role !== 'system') continue;
    const text = contentToString(m.content).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

function randomRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isOrgBoundaryError(msg: string): boolean {
  return msg.includes("does not belong to this webhook's organization");
}

async function handleOpenAIRequest(
  ctx: ActionCtx,
  req: Request,
  webhook: WebhookRecord,
) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return openAIErrorResponse(
      'Invalid JSON body',
      'invalid_request_error',
      400,
    );
  }

  if (!isRecord(rawBody)) {
    return openAIErrorResponse(
      'Request body must be a JSON object',
      'invalid_request_error',
      400,
    );
  }
  const body: OpenAIRequestBody = rawBody;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return openAIErrorResponse(
      'Missing or empty "messages" array',
      'invalid_request_error',
      400,
    );
  }

  const messages = body.messages.filter(isMessage);
  const userMessage = extractLastUserMessage(messages);
  if (userMessage === null) {
    return openAIErrorResponse(
      'No user message found in "messages" array',
      'invalid_request_error',
      400,
    );
  }
  if (userMessage.length === 0) {
    return openAIErrorResponse(
      'User message is empty',
      'invalid_request_error',
      400,
    );
  }

  const clientSystemText = collectSystemPrompts(messages);
  if (clientSystemText.length > MAX_CLIENT_SYSTEM_CHARS) {
    return openAIErrorResponse(
      `Client system text exceeds ${MAX_CLIENT_SYSTEM_CHARS} characters`,
      'invalid_request_error',
      413,
      'context_length_exceeded',
    );
  }

  // Prefer the current OpenAI end-user identifier (`safety_identifier`) and
  // fall back to the deprecated `user` field. Both are standard OpenAI
  // request fields documented as stable per-caller identifiers. When both
  // are present, `safety_identifier` wins.
  const rawIdentifier =
    typeof body.safety_identifier === 'string' &&
    body.safety_identifier.length > 0
      ? body.safety_identifier
      : typeof body.user === 'string' && body.user.length > 0
        ? body.user
        : undefined;
  const userHash = rawIdentifier ? await hashSecret(rawIdentifier) : undefined;

  await ctx.runMutation(
    internal.agents.webhooks.internal_mutations.updateWebhookLastTriggered,
    { webhookId: webhook._id, lastTriggeredAt: Date.now() },
  );

  let chatResult: { threadId: string; streamId: string };
  try {
    chatResult = await ctx.runAction(
      internal.agents.webhooks.internal_actions.chatViaWebhook,
      {
        agentSlug: webhook.agentSlug,
        organizationId: webhook.organizationId,
        webhookId: webhook._id,
        message: userMessage,
        enableStreaming: false,
        additionalSystemPrompt: clientSystemText || undefined,
        userHash,
        agentType: 'openai_webhook',
        chatOwnerId: webhook.createdByUserId,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start chat';
    if (isOrgBoundaryError(msg)) {
      return openAIErrorResponse(msg, 'permission_error', 403);
    }
    return openAIErrorResponse(msg, 'server_error', 500, 'agent_error');
  }

  return pollOpenAIResponse(ctx, chatResult);
}

async function fetchUsageForThread(
  ctx: ActionCtx,
  threadId: string,
): Promise<{ usage: OpenAIUsage; model: string | null }> {
  try {
    const meta = await ctx.runQuery(
      api.message_metadata.queries.getMessageMetadata,
      {
        messageId: '',
        threadId,
      },
    );
    if (!meta) {
      return { usage: ZERO_USAGE, model: null };
    }
    const prompt = meta.inputTokens ?? 0;
    const completion = meta.outputTokens ?? 0;
    const total = meta.totalTokens ?? prompt + completion;
    return {
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
      },
      model: meta.model ?? null,
    };
  } catch (error) {
    console.warn(
      '[agent:webhook:openai] Failed to fetch messageMetadata for usage:',
      error,
    );
    return { usage: ZERO_USAGE, model: null };
  }
}

async function pollOpenAIResponse(
  ctx: ActionCtx,
  chatResult: { threadId: string; streamId: string },
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamId is a branded string from the persistent-streaming SDK; runMutation returns plain string
  const streamId = chatResult.streamId as StreamId;
  const maxPolls = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);
  const created = Math.floor(Date.now() / 1000);

  for (let i = 0; i < maxPolls; i++) {
    const body = await persistentStreaming.getStreamBody(ctx, streamId);

    if (body.status === 'done') {
      const { usage, model } = await fetchUsageForThread(
        ctx,
        chatResult.threadId,
      );
      const payload = buildChatCompletion(
        randomRequestId(),
        model ?? 'agent',
        body.text ?? '',
        created,
        undefined,
        usage,
      );
      return jsonResponse(payload, 200);
    }

    if (body.status === 'error') {
      return openAIErrorResponse(
        body.text || 'Agent generation failed',
        'server_error',
        500,
        'agent_error',
      );
    }

    if (body.status === 'timeout') {
      return openAIErrorResponse(
        'Agent generation timed out',
        'server_error',
        500,
        'timeout',
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return openAIErrorResponse(
    'Response timed out',
    'server_error',
    500,
    'timeout',
  );
}

// ---------------------------------------------------------------------------
// Shared poll + stream response helpers (legacy path)
// ---------------------------------------------------------------------------

async function pollResponse(
  ctx: ActionCtx,
  chatResult: { threadId: string; streamId: string },
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamId is a branded string from the persistent-streaming SDK; runMutation returns plain string
  const streamId = chatResult.streamId as StreamId;
  const maxPolls = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);

  for (let i = 0; i < maxPolls; i++) {
    const body = await persistentStreaming.getStreamBody(ctx, streamId);

    if (
      body.status === 'done' ||
      body.status === 'error' ||
      body.status === 'timeout'
    ) {
      return jsonResponse(
        {
          threadId: chatResult.threadId,
          message: body.text,
          status: body.status,
        },
        200,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return jsonResponse(
    { error: 'Response timed out', threadId: chatResult.threadId },
    504,
  );
}

/**
 * Stream the agent response over HTTP using a manual ReadableStream.
 *
 * We avoid `persistentStreaming.stream()` because it requires the stream
 * status to be "pending" at call time. Since the generation action is
 * scheduled asynchronously, a race condition can cause the status to
 * transition to "streaming" before the HTTP handler runs, resulting in
 * an empty 205 response.
 */
async function streamResponse(
  ctx: ActionCtx,
  chatResult: { threadId: string; streamId: string },
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamId is a branded string from the persistent-streaming SDK; runMutation returns plain string
  const streamId = chatResult.streamId as StreamId;
  const encoder = new TextEncoder();
  const maxPolls = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  void (async () => {
    try {
      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({ threadId: chatResult.threadId })}\n\n`,
        ),
      );

      let lastLength = 0;
      for (let i = 0; i < maxPolls; i++) {
        const body = await persistentStreaming.getStreamBody(ctx, streamId);

        if (body.text.length > lastLength) {
          await writer.write(encoder.encode(body.text.slice(lastLength)));
          lastLength = body.text.length;
        }

        if (
          body.status === 'done' ||
          body.status === 'error' ||
          body.status === 'timeout'
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      console.error('[agent:webhook] Stream polling error:', error);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export const agentWebhookOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
});

// Exported for unit tests.
export const __test = {
  parseWebhookPath,
  extractLastUserMessage,
  collectSystemPrompts,
  contentToString,
  TOKEN_REGEX,
  MAX_CLIENT_SYSTEM_CHARS,
};
