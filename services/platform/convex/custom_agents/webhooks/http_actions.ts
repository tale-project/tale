import type { StreamId } from '@convex-dev/persistent-text-streaming';
import type { GenericActionCtx, GenericDataModel } from 'convex/server';

import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { persistentStreaming } from '../../streaming/helpers';
import { extractClientIp } from '../../workflows/triggers/helpers/validate';

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
  const pathParts = url.pathname.split('/');
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

  const webhook = (await ctx.runQuery(
    internal.custom_agents.webhooks.internal_queries.getWebhookByToken,
    { token },
  )) as Doc<'customAgentWebhooks'> | null;

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
    return streamResponse(ctx, req, chatResult);
  }

  return pollResponse(ctx, chatResult);
});

async function pollResponse(
  ctx: ActionCtx,
  chatResult: { threadId: string; streamId: string },
) {
  const streamId = chatResult.streamId as StreamId;
  const maxPolls = 600;
  const pollInterval = 100;

  for (let i = 0; i < maxPolls; i++) {
    const body = await persistentStreaming.getStreamBody(ctx, streamId);

    if (body.status === 'done' || body.status === 'error') {
      return jsonResponse(
        {
          threadId: chatResult.threadId,
          message: body.text,
          status: body.status,
        },
        200,
      );
    }

    if (body.status === 'timeout') {
      return jsonResponse(
        {
          threadId: chatResult.threadId,
          message: body.text,
          status: 'timeout',
        },
        200,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return jsonResponse(
    { error: 'Response timed out', threadId: chatResult.threadId },
    504,
  );
}

async function streamResponse(
  ctx: GenericActionCtx<GenericDataModel>,
  req: Request,
  chatResult: { threadId: string; streamId: string },
) {
  const streamId = chatResult.streamId as StreamId;

  try {
    const response = await persistentStreaming.stream(
      ctx,
      req,
      streamId,
      async (actionCtx, _req, sid, append) => {
        await append(
          `data: ${JSON.stringify({ threadId: chatResult.threadId })}\n\n`,
        );

        let lastLength = 0;
        let pollCount = 0;
        const maxPolls = 600;
        const pollInterval = 100;

        while (pollCount < maxPolls) {
          const body = await persistentStreaming.getStreamBody(actionCtx, sid);

          if (body.text.length > lastLength) {
            const newText = body.text.slice(lastLength);
            await append(newText);
            lastLength = body.text.length;
          }

          if (
            body.status === 'done' ||
            body.status === 'error' ||
            body.status === 'timeout'
          ) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          pollCount++;
        }
      },
    );

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value;
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        ...responseHeaders,
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('[agent:webhook] Stream error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
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
