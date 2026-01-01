/**
 * Persistent Text Streaming Module
 *
 * This module provides optimized text streaming for chat responses with
 * database persistence for reconnection and history.
 *
 * ARCHITECTURE OVERVIEW:
 * =======================
 * We use a hybrid approach that combines Persistent Text Streaming with the
 * existing Agent SDK streaming:
 *
 * 1. Agent SDK (saveStreamDeltas): Handles tool call metadata in real-time
 *    - Shows "Searching...", "Reading..." indicators during tool execution
 *    - Provides UIMessageChunk format with full stream parts
 *
 * 2. Persistent Text Streaming: Handles optimized text content delivery
 *    - Simpler text-only format for better performance
 *    - Database persistence for reconnection/history
 *    - Cleaner state management for typewriter animation
 *
 * DATA FLOW:
 * ==========
 * 1. User sends message → chatWithAgent mutation creates stream + saves message
 * 2. generateAgentResponse action runs AI generation
 * 3. Text chunks are saved to Persistent Text Streaming (for optimized text)
 * 4. Tool calls are saved via Agent SDK's DeltaStreamer (for UI indicators)
 * 5. Frontend combines both sources for complete experience:
 *    - Text content from getChatStreamBody (reactive query)
 *    - Tool call status from useUIMessages
 *
 * WHY HYBRID?
 * ===========
 * - Agent SDK can't be easily extended for HTTP streaming (consumes stream internally)
 * - But Agent SDK is essential for tool call tracking
 * - So we run both in parallel: Agent SDK for tool calls, Persistent for text
 * - Frontend prioritizes Persistent text for display, Agent SDK for tool status
 *
 * STREAMING MODES:
 * ================
 * 1. Query-based (default): Uses reactive query getChatStreamBody
 *    - Simpler implementation
 *    - Works with existing frontend patterns
 *    - Updates every ~50-100ms as chunks are persisted
 *
 * 2. HTTP-based (optional): Uses streamChatHttp action
 *    - Lowest possible latency
 *    - Requires frontend to manage HTTP stream
 *    - Best for real-time typing feel
 */

import {
  PersistentTextStreaming,
  type StreamId,
} from '@convex-dev/persistent-text-streaming';
import { components, internal } from './_generated/api';
import {
  mutation,
  query,
  httpAction,
  internalMutation,
} from './_generated/server';
import { v } from 'convex/values';

// Re-export StreamId type for use in other modules
export type { StreamId };

/**
 * Initialize the Persistent Text Streaming component.
 * This connects to the component defined in convex.config.ts.
 */
export const persistentStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming
);

// ============================================================================
// PUBLIC MUTATIONS & QUERIES
// ============================================================================

/**
 * Create a new stream for a chat message.
 *
 * Call this before starting AI generation. The returned streamId should be:
 * 1. Stored with the message metadata for later retrieval
 * 2. Passed to the frontend for streaming subscription
 *
 * @returns The stream ID to use for streaming and retrieval
 */
export const createChatStream = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const streamId = await persistentStreaming.createStream(ctx);
    return streamId;
  },
});

/**
 * Get the body of a stream from the database.
 *
 * This is the primary way the frontend gets text content. The reactive query
 * automatically updates as new chunks are added.
 *
 * Used by the frontend when:
 * - Displaying streaming content (query updates reactively)
 * - Reconnecting after being away
 * - Loading historical messages
 *
 * @param streamId - The ID of the stream to retrieve
 * @returns The full text content and current status of the stream
 */
export const getChatStreamBody = query({
  args: { streamId: v.string() },
  returns: v.object({
    text: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('streaming'),
      v.literal('done'),
      v.literal('error'),
      v.literal('timeout')
    ),
  }),
  handler: async (ctx, { streamId }) => {
    return persistentStreaming.getStreamBody(ctx, streamId as StreamId);
  },
});

// ============================================================================
// INTERNAL MUTATIONS (called by generateAgentResponse)
// ============================================================================

/**
 * Append a text chunk to an active stream.
 *
 * Called by generateAgentResponse as text chunks arrive from the AI.
 * This persists the chunk to the database, which triggers reactive
 * query updates on the frontend.
 *
 * The component batches chunks internally for efficiency, so calling
 * this frequently is safe and won't overwhelm the database.
 *
 * @param streamId - The ID of the stream to append to
 * @param text - The text chunk to append
 */
export const appendToStream = internalMutation({
  args: {
    streamId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { streamId, text }) => {
    // Use the component's public mutation to add a chunk
    // The component handles batching and persistence
    await ctx.runMutation(components.persistentTextStreaming.public.addChunk, {
      streamId: streamId,
      text,
    });
  },
});

/**
 * Mark a stream as actively streaming.
 *
 * Called when generateAgentResponse starts producing text.
 * Updates the stream status from 'pending' to 'streaming'.
 *
 * @param streamId - The ID of the stream to mark as streaming
 */
export const startStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, { streamId }) => {
    await ctx.runMutation(components.persistentTextStreaming.public.setStatus, {
      streamId: streamId,
      status: 'streaming',
    });
  },
});

/**
 * Mark a stream as complete.
 *
 * Called after generateAgentResponse finishes successfully.
 * Updates the stream status to 'done'.
 *
 * @param streamId - The ID of the stream to complete
 */
export const completeStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, { streamId }) => {
    await ctx.runMutation(components.persistentTextStreaming.public.setStatus, {
      streamId: streamId,
      status: 'done',
    });
  },
});

/**
 * Mark a stream as errored.
 *
 * Called if generateAgentResponse encounters an error.
 * Updates the stream status to 'error'.
 *
 * @param streamId - The ID of the stream to mark as errored
 */
export const errorStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, { streamId }) => {
    await ctx.runMutation(components.persistentTextStreaming.public.setStatus, {
      streamId: streamId,
      status: 'error',
    });
  },
});

// ============================================================================
// HTTP ACTION (Optional - for lowest latency)
// ============================================================================

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

  // Validate required parameters
  if (!streamIdParam) {
    return new Response('Missing streamId parameter', { status: 400 });
  }

  const streamId = streamIdParam as StreamId;

  try {
    // Use the persistent streaming component to create an HTTP stream
    // The component polls the database and streams chunks to the client
    const response = await persistentStreaming.stream(
      ctx,
      request,
      streamId,
      async (actionCtx, _req, sid, append) => {
        // This callback runs while the HTTP connection is open
        // We poll the database for the stream body and send updates
        //
        // Note: The actual content is written to the database by
        // generateAgentResponse via appendToStream mutation.
        // This action just reads and forwards to HTTP.
        let lastLength = 0;
        let pollCount = 0;
        const maxPolls = 600; // 60 seconds at 100ms intervals
        const pollInterval = 100; // ms

        while (pollCount < maxPolls) {
          // Get current stream body
          const body = await persistentStreaming.getStreamBody(
            actionCtx,
            sid
          );

          // Send any new text
          if (body.text.length > lastLength) {
            const newText = body.text.slice(lastLength);
            await append(newText);
            lastLength = body.text.length;
          }

          // Check if stream is complete
          if (body.status === 'done' || body.status === 'error' || body.status === 'timeout') {
            break;
          }

          // Wait before polling again
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          pollCount++;
        }
      }
    );

    // Add CORS headers for cross-origin streaming
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
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
