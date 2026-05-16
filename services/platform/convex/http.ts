import { httpRouter } from 'convex/server';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import {
  listAgents as listAgentsRest,
  getAgent,
  patchAgent,
} from './agents/rest_api';
import {
  agentWebhookHandler,
  agentWebhookOptionsHandler,
} from './agents/webhooks/http_actions';
import { apiGatewayOptions, apiGatewayRun } from './api_gateway';
import { authComponent, createAuth } from './auth';
import {
  listCustomers,
  createCustomer,
  getCustomer,
  patchCustomer,
  deleteCustomer,
  customerPostActions,
} from './customers/rest_api';
import {
  listDocuments,
  createDocument,
  getDocument,
  patchDocument,
  deleteDocument,
  documentSubActions,
} from './documents/rest_api';
import { imageProxyHandler } from './images/http_actions';
import { integrationOAuth2CallbackHandler } from './integrations/oauth2_callback';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from './lib/rate_limiter/helpers';
import { restOptionsHandler } from './lib/rest/helpers';
import { toId } from './lib/type_cast_helpers';
import { getClientIp, loadTrustedProxies } from './lib/utils/client_ip';
import {
  chatCompletionsHandler,
  chatCompletionsOptionsHandler,
  modelsListHandler,
  modelsOptionsHandler,
} from './openai_compat/http_actions';
import {
  listProducts,
  createProduct,
  getProduct,
  patchProduct,
  deleteProduct,
} from './products/rest_api';
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
  listThreads,
  createThread,
  getThread,
  patchThread,
  deleteThread,
  threadPostActions,
} from './threads/rest_api';
import { trustedHeadersAuthHandler } from './trusted_headers_auth/http_handlers';
import {
  listVendors,
  createVendor,
  bulkCreateVendors,
  getVendor,
  patchVendor,
  deleteVendor,
} from './vendors/rest_api';
import {
  listWebsites,
  createWebsite,
  getWebsite,
  patchWebsite,
  deleteWebsite,
  websitePostActions,
} from './websites/rest_api';
import {
  getWorkflow,
  postWorkflow,
  patchWorkflow,
  deleteWorkflow,
} from './workflows/rest_api';
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

    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
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

http.route({
  path: '/api/image-proxy',
  method: 'GET',
  handler: imageProxyHandler,
});

/**
 * Authenticated TTS audio fetch. Replaces the bearer-replayable
 * `/storage?id=…` path that previously served voice audio: the chunk row
 * carries `organizationId` + `threadId`, so we can require the caller to
 * be a current member of the chunk's org before streaming the blob.
 *
 * Designed for the chained `<audio>` playback path — `Cache-Control:
 * private, max-age=600` lets the browser keep a short cache, but the URL
 * is bound to the session cookie so a third party intercepting the URL
 * can't replay it. Revocation on member removal is instantaneous (the
 * GDPR cascade has already deleted the row by then).
 */
http.route({
  path: '/api/tts-audio',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const chunkId = url.searchParams.get('chunkId');
    if (!chunkId) {
      return new Response('Missing chunkId', { status: 400 });
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.subject) {
      return new Response('Unauthenticated', { status: 401 });
    }

    const chunk = await ctx.runQuery(internal.tts.queries.getChunkForServe, {
      chunkId,
      userId: identity.subject,
    });
    if (!chunk) {
      // Either the chunk doesn't exist or the caller isn't a member of
      // the chunk's org. Conflate the two so probing reveals nothing.
      return new Response('Not found', { status: 404 });
    }

    try {
      const blob = await ctx.storage.get(toId<'_storage'>(chunk.storageId));
      if (!blob) {
        return new Response('Not found', { status: 404 });
      }
      const headers: Record<string, string> = {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': blob.size.toString(),
        'Cache-Control': 'private, max-age=600',
        // Tell intermediaries not to cache the bytes against the URL
        // alone; the URL is bound to the session cookie which they can't
        // see.
        Vary: 'Cookie',
      };
      return new Response(blob, { status: 200, headers });
    } catch (error) {
      console.error('[http /api/tts-audio] error:', error);
      return new Response('Internal server error', { status: 500 });
    }
  }),
});

authComponent.registerRoutes(http, createAuth);

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

// Trusted Headers Authentication
// For deployments behind an authenticating reverse proxy (Authelia, Authentik, oauth2-proxy).
// The proxy sets identity headers; this endpoint reads them and creates a session.
http.route({
  path: '/api/trusted-headers/authenticate',
  method: 'GET',
  handler: trustedHeadersAuthHandler,
});

// Agent Webhook Routes
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

// OpenAI-Compatible API Routes
http.route({
  path: '/api/v1/chat/completions',
  method: 'POST',
  handler: chatCompletionsHandler,
});

http.route({
  path: '/api/v1/chat/completions',
  method: 'OPTIONS',
  handler: chatCompletionsOptionsHandler,
});

http.route({
  path: '/api/v1/models',
  method: 'GET',
  handler: modelsListHandler,
});

http.route({
  path: '/api/v1/models',
  method: 'OPTIONS',
  handler: modelsOptionsHandler,
});

// ---------------------------------------------------------------------------
// REST API v1 Routes
// ---------------------------------------------------------------------------

// Documents
http.route({
  path: '/api/v1/documents',
  method: 'GET',
  handler: listDocuments,
});
http.route({
  path: '/api/v1/documents',
  method: 'POST',
  handler: createDocument,
});
http.route({
  path: '/api/v1/documents',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/documents/',
  method: 'GET',
  handler: getDocument,
});
http.route({
  pathPrefix: '/api/v1/documents/',
  method: 'PATCH',
  handler: patchDocument,
});
http.route({
  pathPrefix: '/api/v1/documents/',
  method: 'DELETE',
  handler: deleteDocument,
});
http.route({
  pathPrefix: '/api/v1/documents/',
  method: 'POST',
  handler: documentSubActions,
});
http.route({
  pathPrefix: '/api/v1/documents/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Websites
http.route({ path: '/api/v1/websites', method: 'GET', handler: listWebsites });
http.route({
  path: '/api/v1/websites',
  method: 'POST',
  handler: createWebsite,
});
http.route({
  path: '/api/v1/websites',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/websites/',
  method: 'GET',
  handler: getWebsite,
});
http.route({
  pathPrefix: '/api/v1/websites/',
  method: 'PATCH',
  handler: patchWebsite,
});
http.route({
  pathPrefix: '/api/v1/websites/',
  method: 'DELETE',
  handler: deleteWebsite,
});
http.route({
  pathPrefix: '/api/v1/websites/',
  method: 'POST',
  handler: websitePostActions,
});
http.route({
  pathPrefix: '/api/v1/websites/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Products
http.route({ path: '/api/v1/products', method: 'GET', handler: listProducts });
http.route({
  path: '/api/v1/products',
  method: 'POST',
  handler: createProduct,
});
http.route({
  path: '/api/v1/products',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/products/',
  method: 'GET',
  handler: getProduct,
});
http.route({
  pathPrefix: '/api/v1/products/',
  method: 'PATCH',
  handler: patchProduct,
});
http.route({
  pathPrefix: '/api/v1/products/',
  method: 'DELETE',
  handler: deleteProduct,
});
http.route({
  pathPrefix: '/api/v1/products/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Customers
http.route({
  path: '/api/v1/customers',
  method: 'GET',
  handler: listCustomers,
});
http.route({
  path: '/api/v1/customers',
  method: 'POST',
  handler: createCustomer,
});
http.route({
  path: '/api/v1/customers',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/customers/',
  method: 'GET',
  handler: getCustomer,
});
http.route({
  pathPrefix: '/api/v1/customers/',
  method: 'PATCH',
  handler: patchCustomer,
});
http.route({
  pathPrefix: '/api/v1/customers/',
  method: 'DELETE',
  handler: deleteCustomer,
});
http.route({
  pathPrefix: '/api/v1/customers/',
  method: 'POST',
  handler: customerPostActions,
});
http.route({
  pathPrefix: '/api/v1/customers/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Vendors
http.route({ path: '/api/v1/vendors', method: 'GET', handler: listVendors });
http.route({ path: '/api/v1/vendors', method: 'POST', handler: createVendor });
http.route({
  path: '/api/v1/vendors',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/vendors/',
  method: 'GET',
  handler: getVendor,
});
http.route({
  pathPrefix: '/api/v1/vendors/',
  method: 'PATCH',
  handler: patchVendor,
});
http.route({
  pathPrefix: '/api/v1/vendors/',
  method: 'DELETE',
  handler: deleteVendor,
});
http.route({
  pathPrefix: '/api/v1/vendors/',
  method: 'POST',
  handler: bulkCreateVendors,
});
http.route({
  pathPrefix: '/api/v1/vendors/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Threads
http.route({ path: '/api/v1/threads', method: 'GET', handler: listThreads });
http.route({ path: '/api/v1/threads', method: 'POST', handler: createThread });
http.route({
  path: '/api/v1/threads',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/threads/',
  method: 'GET',
  handler: getThread,
});
http.route({
  pathPrefix: '/api/v1/threads/',
  method: 'PATCH',
  handler: patchThread,
});
http.route({
  pathPrefix: '/api/v1/threads/',
  method: 'DELETE',
  handler: deleteThread,
});
http.route({
  pathPrefix: '/api/v1/threads/',
  method: 'POST',
  handler: threadPostActions,
});
http.route({
  pathPrefix: '/api/v1/threads/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Agents
http.route({ path: '/api/v1/agents', method: 'GET', handler: listAgentsRest });
http.route({
  path: '/api/v1/agents',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({ pathPrefix: '/api/v1/agents/', method: 'GET', handler: getAgent });
http.route({
  pathPrefix: '/api/v1/agents/',
  method: 'PATCH',
  handler: patchAgent,
});
http.route({
  pathPrefix: '/api/v1/agents/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Workflows (triggers + executions)
http.route({
  pathPrefix: '/api/v1/workflows/',
  method: 'GET',
  handler: getWorkflow,
});
http.route({
  pathPrefix: '/api/v1/workflows/',
  method: 'POST',
  handler: postWorkflow,
});
http.route({
  pathPrefix: '/api/v1/workflows/',
  method: 'PATCH',
  handler: patchWorkflow,
});
http.route({
  pathPrefix: '/api/v1/workflows/',
  method: 'DELETE',
  handler: deleteWorkflow,
});
http.route({
  pathPrefix: '/api/v1/workflows/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// ---------------------------------------------------------------------------
// API Gateway Routes - Handle /api/run/* paths with session cookie or API key authentication
// ---------------------------------------------------------------------------
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
