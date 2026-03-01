import type { StreamId } from '@convex-dev/persistent-text-streaming';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { persistentStreaming } from '../../streaming/helpers';
import { extractClientIp } from '../../workflows/triggers/helpers/validate';

/**
 * Maximum time (ms) to poll for agent generation results.
 * Aligns with the platform hard limit in generate_response.ts (540s / 9 min)
 * so the webhook waits long enough for any generation to complete.
 */
const MAX_POLL_MS = 540_000;
const POLL_INTERVAL_MS = 100;

function jsonResponse(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const agentWebhookHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const token = pathParts[pathParts.length - 1];

  if (!token) {
    return jsonResponse({ error: 'Missing webhook token' }, 400);
  }

  const ip = extractClientIp(req.headers);
  try {
    await checkIpRateLimit(ctx, 'agent:webhook', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }
    throw error;
  }

  const webhook = await ctx.runQuery(
    internal.custom_agents.webhooks.internal_queries.getWebhookByToken,
    { token },
  );

  if (!webhook) {
    return jsonResponse({ error: 'Invalid webhook token' }, 404);
  }

  if (!webhook.isActive) {
    return jsonResponse({ error: 'Webhook is disabled' }, 403);
  }

  const contentType = req.headers.get('Content-Type') ?? '';
  const isMultipart = contentType.startsWith('multipart/form-data');

  let message: string;
  let threadId: string | undefined;
  let shouldStream = false;
  let attachment:
    | {
        fileId: Id<'_storage'>;
        fileName: string;
        fileType: string;
        fileSize: number;
      }
    | undefined;

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

  let chatResult: { threadId: string; streamId: string };
  try {
    chatResult = await ctx.runMutation(
      internal.custom_agents.webhooks.internal_mutations.chatViaWebhook,
      {
        customAgentId: webhook.customAgentId,
        organizationId: webhook.organizationId,
        webhookId: webhook._id,
        message,
        threadId,
        enableStreaming: shouldStream,
        attachments: attachment ? [attachment] : undefined,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start chat';
    return jsonResponse({ error: msg }, 500);
  }

  await ctx.runMutation(
    internal.custom_agents.webhooks.internal_mutations
      .updateWebhookLastTriggered,
    { webhookId: webhook._id, lastTriggeredAt: Date.now() },
  );

  if (shouldStream) {
    return streamResponse(ctx, chatResult);
  }

  return pollResponse(ctx, chatResult);
});

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
