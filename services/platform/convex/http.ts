import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { httpAction } from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from './lib/rate_limiter/helpers';
import { streamChatHttp, streamChatHttpOptions } from './streaming/http_actions';

const http = httpRouter();

http.route({
  path: '/ping',
  method: 'GET',
  handler: httpAction(async () => new Response('ok', { status: 200 })),
});

http.route({
  path: '/storage',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const storageId = url.searchParams.get('id');
    const filename = url.searchParams.get('filename');

    if (!storageId) {
      return new Response('Missing storage ID', { status: 400 });
    }

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    try {
      await checkIpRateLimit(ctx, 'security:storage-access', ip);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(error.retryAfter / 1000)),
          },
        });
      }
      throw error;
    }

    try {
      const blob = await ctx.storage.get(storageId as Id<'_storage'>);
      if (!blob) {
        return new Response('File not found', { status: 404 });
      }

      const headers: Record<string, string> = {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': blob.size.toString(),
      };

      if (filename) {
        const sanitizedFilename = filename.replace(/[^\w\s.-]/g, '_');
        const encodedFilename = encodeURIComponent(filename);
        headers['Content-Disposition'] =
          `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;
      }

      return new Response(blob, { status: 200, headers });
    } catch (error) {
      console.error('[http /storage] error:', error);
      return new Response('Internal server error', { status: 500 });
    }
  }),
});

authComponent.registerRoutes(http, createAuth);

http.route({
  path: '/api/chat-stream',
  method: 'GET',
  handler: streamChatHttp,
});

http.route({
  path: '/api/chat-stream',
  method: 'OPTIONS',
  handler: streamChatHttpOptions,
});

const _routes = http.getRoutes();
export default http;
