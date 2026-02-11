import { httpRouter } from 'convex/server';

import { httpAction } from './_generated/server';
import { apiGatewayOptions, apiGatewayRun } from './api_gateway';
import { authComponent, createAuth } from './auth';
import {
  agentWebhookHandler,
  agentWebhookOptionsHandler,
} from './custom_agents/webhooks/http_actions';
import { oauth2CallbackHandler } from './email_providers/oauth2_callback';
import { integrationOAuth2CallbackHandler } from './integrations/oauth2_callback';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from './lib/rate_limiter/helpers';
import { toId } from './lib/type_cast_helpers';
import {
  ssoDiscoverHandler,
  ssoAuthorizeHandler,
  ssoCallbackHandler,
  ssoSetSessionHandler,
} from './sso_providers/http_handlers';
import {
  streamChatHttp,
  streamChatHttpOptions,
} from './streaming/http_actions';
import {
  apiTriggerHandler,
  apiTriggerOptionsHandler,
} from './workflows/triggers/api_http';
import {
  webhookHandler,
  webhookOptionsHandler,
} from './workflows/triggers/http_actions';

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
      const blob = await ctx.storage.get(toId<'_storage'>(storageId));
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
  path: '/api/auth/oauth2/callback',
  method: 'GET',
  handler: oauth2CallbackHandler,
});

// Integration OAuth2 Callback
http.route({
  path: '/api/integrations/oauth2/callback',
  method: 'GET',
  handler: integrationOAuth2CallbackHandler,
});

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

// SSO Routes - Dynamic per-organization Microsoft Entra ID authentication
http.route({
  path: '/api/sso/discover',
  method: 'POST',
  handler: ssoDiscoverHandler,
});

http.route({
  path: '/api/sso/authorize',
  method: 'GET',
  handler: ssoAuthorizeHandler,
});

http.route({
  path: '/api/sso/callback',
  method: 'GET',
  handler: ssoCallbackHandler,
});

http.route({
  path: '/api/sso/set-session',
  method: 'GET',
  handler: ssoSetSessionHandler,
});

// Custom Agent Webhook Routes
http.route({
  pathPrefix: '/api/agents/wh/',
  method: 'POST',
  handler: agentWebhookHandler,
});

http.route({
  pathPrefix: '/api/agents/wh/',
  method: 'OPTIONS',
  handler: agentWebhookOptionsHandler,
});

// Workflow Webhook Trigger Routes
http.route({
  pathPrefix: '/api/workflows/wh/',
  method: 'POST',
  handler: webhookHandler,
});

http.route({
  pathPrefix: '/api/workflows/wh/',
  method: 'OPTIONS',
  handler: webhookOptionsHandler,
});

// Workflow API Trigger Route
http.route({
  path: '/api/workflows/trigger',
  method: 'POST',
  handler: apiTriggerHandler,
});

http.route({
  path: '/api/workflows/trigger',
  method: 'OPTIONS',
  handler: apiTriggerOptionsHandler,
});

// API Gateway Routes - Handle /api/run/* paths with session cookie or API key authentication
http.route({
  pathPrefix: '/api/run/',
  method: 'POST',
  handler: apiGatewayRun,
});

http.route({
  pathPrefix: '/api/run/',
  method: 'OPTIONS',
  handler: apiGatewayOptions,
});

const _routes = http.getRoutes();
export default http;
