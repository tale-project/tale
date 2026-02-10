/**
 * HTTP actions for streaming domain
 */

import { type StreamId } from '@convex-dev/persistent-text-streaming';

import type { ActionCtx } from '../_generated/server';

import { httpAction } from '../_generated/server';
import { persistentStreaming } from './helpers';

/**
 * HTTP Action for streaming text content directly to the client.
 *
 * This provides the lowest latency path for text delivery by streaming
 * directly over HTTP rather than through database queries.
 *
 * URL: /api/chat-stream?streamId={streamId}
 *
 * The action will:
 * 1. Start an HTTP streaming response
 * 2. Poll the database for new chunks
 * 3. Stream each chunk directly to the client as it arrives
 *
 * This is complementary to the database streaming - both write to the
 * same stream, so reconnection works seamlessly.
 *
 * CORS headers are included for cross-origin requests.
 *
 * NOTE: The frontend can choose between:
 * - This HTTP action (lowest latency, requires EventSource handling)
 * - The getChatStreamBody query (simpler, reactive updates)
 */
export const streamChatHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const streamIdParam = url.searchParams.get('streamId');

  if (!streamIdParam) {
    return new Response('Missing streamId parameter', { status: 400 });
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id type
  const streamId = streamIdParam as StreamId;

  try {
    const response = await persistentStreaming.stream(
      ctx,
      request,
      streamId,
      async (
        actionCtx: ActionCtx,
        _req: Request,
        sid: StreamId,
        append: (text: string) => Promise<void>,
      ) => {
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    console.error('[streaming] HTTP stream error:', error);
    return new Response('Internal server error', { status: 500 });
  }
});

/**
 * Handle CORS preflight requests for the streaming endpoint.
 */
export const streamChatHttpOptions = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
});
