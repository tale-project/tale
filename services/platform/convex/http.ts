import { httpRouter } from 'convex/server';

import { getString, isRecord } from '../lib/utils/type-guards';
import { components, internal } from './_generated/api';
import { httpAction } from './_generated/server';
import {
  claimRun,
  heartbeatRuntime,
  registerRuntime,
  runSubActions,
} from './agent_runtimes/rest_api';
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
import {
  executeIntegrationHandler,
  integrationStatusHandler,
} from './integrations/dispatch_http';
import { integrationOAuth2CallbackHandler } from './integrations/oauth2_callback';
import { slackEventsHandler } from './integrations/slack/http_actions';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from './lib/rate_limiter/helpers';
import { restOptionsHandler } from './lib/rest/helpers';
import { toId } from './lib/type_cast_helpers';
import { getClientIp, loadTrustedProxies } from './lib/utils/client_ip';
import { sanitizeError } from './lib/utils/sanitize_secrets';
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
  outputUploadUrlAction,
  recordUploadedAction,
} from './sandbox/sandbox_http';
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

      const totalSize = blob.size;
      const contentType = blob.type || 'application/octet-stream';

      const dispositionHeaders: Record<string, string> = {};
      if (filename) {
        const sanitizedFilename = filename.replace(/[^\w\s.-]/g, '_');
        const encodedFilename = encodeURIComponent(filename);
        dispositionHeaders['Content-Disposition'] =
          `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;
      }

      // RFC 7233 single-range support. Multi-range (`bytes=0-9,20-29`) is
      // declined here — caller falls back to a full 200 response.
      const rangeHeader = req.headers.get('range');
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (match) {
          const [, startStr, endStr] = match;
          let start: number;
          let end: number;
          let parseOk = true;
          if (startStr === '' && endStr === '') {
            parseOk = false;
            start = 0;
            end = 0;
          } else if (startStr === '') {
            const suffix = Number(endStr);
            if (!Number.isFinite(suffix) || suffix <= 0) {
              parseOk = false;
              start = 0;
              end = 0;
            } else {
              start = Math.max(0, totalSize - suffix);
              end = totalSize - 1;
            }
          } else {
            start = Number(startStr);
            if (!Number.isFinite(start) || start < 0) {
              parseOk = false;
              end = 0;
            } else if (endStr === '') {
              end = totalSize - 1;
            } else {
              end = Number(endStr);
              if (!Number.isFinite(end) || end < start) {
                parseOk = false;
              } else if (end > totalSize - 1) {
                end = totalSize - 1;
              }
            }
          }

          if (parseOk) {
            if (totalSize === 0 || start >= totalSize) {
              return new Response('Range not satisfiable', {
                status: 416,
                headers: {
                  'Content-Range': `bytes */${totalSize}`,
                  'Accept-Ranges': 'bytes',
                },
              });
            }
            // slice() upper bound is exclusive, byte range end is inclusive.
            const sliced = blob.slice(start, end + 1, contentType);
            return new Response(sliced, {
              status: 206,
              headers: {
                'Content-Type': contentType,
                'Content-Length': String(end - start + 1),
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                ...dispositionHeaders,
              },
            });
          }
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': totalSize.toString(),
        'Accept-Ranges': 'bytes',
        ...dispositionHeaders,
      };

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
 * Designed for the chained `<audio>` playback path. Identity is resolved
 * from the Better Auth session cookie via `auth.api.getSession()` rather
 * than `ctx.auth.getUserIdentity()` — native `<audio>` elements can't
 * attach an `Authorization: Bearer` header, but they do send same-origin
 * cookies, which is what the rest of the cookie-authenticated routes in
 * this file rely on. `Cache-Control: private, max-age=0, must-revalidate`
 * keeps short-lived bytes in the browser disk cache but forces a
 * revalidating round-trip on every replay so a removed member can't
 * keep playing audio they no longer have access to. `Vary: Cookie`
 * binds the cached bytes to the session so a third party intercepting
 * the URL can't replay it. `Accept-Ranges: none` suppresses iOS Safari
 * range probes on `<audio preload="auto">` that would otherwise
 * trigger audible restarts.
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

    // Mirror the `/storage` route: rate-limit BEFORE the session lookup
    // so an unauthenticated attacker hammering this URL can't force a
    // Better Auth DB session-query per request. The IP gate is the only
    // protection against anonymous abuse; membership checks downstream
    // catch authenticated abuse.
    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
    try {
      await checkIpRateLimit(ctx, 'security:tts-audio-fetch', ip);
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

    const auth = createAuth(ctx);
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      // `no-store` + `Vary: Cookie` so a TLS-terminating proxy can't cache
      // the 401 against the URL and starve a freshly-logged-in user. The
      // `WWW-Authenticate: Cookie` is informational — cookie-auth clients
      // ignore it, but it satisfies RFC 7235 hygiene.
      return new Response('Unauthenticated', {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
          'WWW-Authenticate': 'Cookie',
        },
      });
    }

    const chunk = await ctx.runQuery(internal.tts.queries.getChunkForServe, {
      chunkId,
      userId: session.user.id,
      // Email fallback handles mid-migration users (account linking, JWT
      // userId drift) so the audio route stays consistent with the
      // sibling `getMessageChunks` subscription, which already does the
      // same fallback via `getOrganizationMember`.
      email: session.user.email,
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
        // `max-age=0, must-revalidate` (not `no-store`): keep the bytes
        // in the browser's HTTP cache for in-tab replay efficiency, but
        // force a conditional round-trip back to this route on every
        // play so a member who's been removed loses access immediately
        // instead of being able to replay cached audio for 10 minutes.
        'Cache-Control': 'private, max-age=0, must-revalidate',
        // Tell intermediaries not to cache the bytes against the URL
        // alone; the URL is bound to the session cookie which they can't
        // see.
        Vary: 'Cookie',
        // iOS Safari `<audio preload="auto">` probes ranges; without
        // an explicit `Accept-Ranges: none` it may issue partial
        // requests that get a full 200 back from byte 0, audibly
        // restarting playback mid-chunk.
        'Accept-Ranges': 'none',
        // CORP defense-in-depth: blocks third-party pages from embedding
        // this audio in their own `<audio>` element. The session cookie
        // is SameSite=Lax, so a cross-site top-level audio fetch would
        // otherwise send the cookie and play the victim's TTS audio
        // (no byte exfil without CORS, but a privacy surprise).
        'Cross-Origin-Resource-Policy': 'same-origin',
      };
      return new Response(blob, { status: 200, headers });
    } catch (error) {
      // Sanitize before logging — `ctx.storage.get` failures can carry
      // signed URLs / headers / IPs in their `.message` or `.stack`.
      // Other TTS code paths route through `sanitizeError`; this one
      // missed the pattern until round-2 #25.
      console.error('[http /api/tts-audio] error', sanitizeError(error), {
        chunkId,
      });
      return new Response('Internal server error', { status: 500 });
    }
  }),
});

/**
 * Resolve which org slugs a session-authenticated user is allowed to see
 * events for. Consumed by the Bun-side `/events/file` SSE handler so the
 * fan-out can drop events whose `orgSlug` is not in the caller's
 * membership set — before any wire payload reaches the client.
 *
 * Returns `{ userId, orgSlugs }` on success or 401 on missing/invalid
 * session. The 401 carries `Vary: Cookie` so a TLS-terminating proxy
 * can't cache the response against the URL and starve a freshly-logged-
 * in user.
 */
http.route({
  path: '/api/sse/auth',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    // Mirror the `/api/tts-audio` and `/storage` routes: rate-limit
    // BEFORE the session lookup so an anonymous flood can't force a
    // Better Auth DB session-query per request. The browser EventSource
    // hitting this endpoint passes the auth cookie, so the limit applies
    // to anonymous probes only — authenticated SSE handshakes stay
    // unthrottled in practice.
    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
    try {
      await checkIpRateLimit(ctx, 'security:sse-auth', ip);
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

    const auth = createAuth(ctx);
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return new Response('Unauthenticated', {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
          'WWW-Authenticate': 'Cookie',
        },
      });
    }

    const memberships = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        // 256 is a soft cap — there is no hard platform-side limit on
        // per-user memberships. Anyone with >256 active memberships is
        // an operator / service account, not a regular subject. We log
        // when we hit the cap below so silent truncation is observable.
        paginationOpts: { cursor: null, numItems: 256 },
        where: [{ field: 'userId', value: session.user.id, operator: 'eq' }],
      },
    );

    const memberRows: unknown[] = Array.isArray(memberships?.page)
      ? memberships.page
      : [];
    if (memberRows.length === 256) {
      // Surface the soft-cap truncation so an operator with >256 memberships
      // notices instead of silently losing SSE coverage for the excess orgs.
      console.warn(
        '[/api/sse/auth] hit 256-membership soft cap for user; some orgs may be silently truncated',
        { userId: session.user.id },
      );
    }
    // Drop rows where the user is soft-removed via `role = 'disabled'`
    // (matches the canonical filter in lib/rls/organization/get_user_organizations.ts).
    // Without this filter, a disabled member keeps receiving SSE file events
    // for the org they were kicked from until the row is hard-deleted.
    const orgIds: string[] = memberRows
      .filter((row) =>
        isRecord(row) ? getString(row, 'role') !== 'disabled' : false,
      )
      .map((row) =>
        isRecord(row) ? getString(row, 'organizationId') : undefined,
      )
      .filter((s): s is string => typeof s === 'string' && s.length > 0);

    const slugs: string[] = [];
    for (const orgId of orgIds) {
      const orgRow = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'organization',
        where: [{ field: '_id', value: orgId, operator: 'eq' }],
      });
      const slug = isRecord(orgRow) ? getString(orgRow, 'slug') : undefined;
      if (typeof slug === 'string' && slug.length > 0) slugs.push(slug);
    }

    return new Response(
      JSON.stringify({ userId: session.user.id, orgSlugs: slugs }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
        },
      },
    );
  }),
});

/**
 * Read-only download of a single file from a thread's live external-agent
 * sandbox workspace. Powers the chat workspace file explorer's "open /
 * download" affordance. Cookie-authenticated (a `<a download>` / direct fetch
 * can't attach a Bearer header but does send same-origin cookies — same
 * pattern as `/api/tts-audio`).
 *
 * Authorization is the canAccessThread boundary: identity from the Better Auth
 * session cookie → `resolveBrowsableSessionForUser`, which runs the SAME thread
 * RLS as the message queries. A threadId from another org throws there
 * (UnauthorizedError) → 403; cross-org workspace access is impossible.
 *
 * Query params: `threadId` (required), `path` (required), `download` (=1 forces
 * an attachment Content-Disposition). Statuses: 400 missing params, 401 no
 * session, 403 no thread access, 409 no running session, 404 missing/over-cap
 * file, 200 bytes.
 */
http.route({
  path: '/api/sandbox/workspace_file',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const threadId = url.searchParams.get('threadId');
    const path = url.searchParams.get('path');
    const download = url.searchParams.get('download') === '1';
    if (!threadId || !path) {
      return new Response('Missing threadId or path', { status: 400 });
    }
    // Reject path traversal / NUL defensively (runnerd validates too).
    if (path.includes('..') || path.includes('\u0000')) {
      return new Response('Invalid path', { status: 400 });
    }

    // Rate-limit BEFORE the session lookup so an anonymous flood can't force a
    // Better Auth DB session-query per request (mirrors /api/tts-audio).
    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
    try {
      await checkIpRateLimit(ctx, 'security:workspace-file', ip);
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

    const auth = createAuth(ctx);
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return new Response('Unauthenticated', {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
          'WWW-Authenticate': 'Cookie',
        },
      });
    }

    // SAME canAccessThread boundary as the list action, keyed by the Better
    // Auth userId (httpActions don't get identity from ctx.auth via the
    // cookie). Cross-org / no-access throws UnauthorizedError → 403.
    let sessionId: string | null;
    let status: string | null;
    try {
      const sess = await ctx.runQuery(
        internal.sandbox.workspace_files.resolveBrowsableSessionForUser,
        { threadId, userId: session.user.id, email: session.user.email },
      );
      sessionId = sess.sessionId;
      status = sess.status;
    } catch (error) {
      // UnauthorizedError = thread missing OR access denied (conflated by
      // canAccessThread). 403 reveals nothing beyond "you can't have it".
      console.debug('[http /api/sandbox/workspace_file] access denied', {
        threadId,
        userId: session.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' },
      });
    }

    if (!sessionId || status !== 'active') {
      // No running session to read from — the browser shows "resume to browse".
      return new Response(JSON.stringify({ error: 'session_not_running' }), {
        status: 409,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
        },
      });
    }

    const file = await ctx.runAction(
      internal.node_only.sandbox.workspace_files.readWorkspaceFileBytes,
      { sessionId, path },
    );
    if (!file) {
      // null ⇒ the spawner returned 404 for a missing/unsafe path OR a file
      // over runnerd's 20 MB read cap — the two are indistinguishable here, so
      // 404 (a 413 would require the spawner to surface the cap separately).
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' },
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': file.contentType || 'application/octet-stream',
      'Cache-Control': 'no-store',
      Vary: 'Cookie',
    };
    if (download) {
      // Basename for the attachment filename; sanitize to a quoted-string-safe
      // token plus an RFC 5987 fallback for non-ASCII names.
      const base = path.split('/').pop() || 'download';
      const safe = base.replace(/[^\w\s.-]/g, '_');
      headers['Content-Disposition'] =
        `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(base)}`;
    }
    return new Response(file.bytes, { status: 200, headers });
  }),
});

authComponent.registerRoutes(http, createAuth);

// Integration OAuth2 Callback
http.route({
  path: '/api/integrations/oauth2/callback',
  method: 'GET',
  handler: integrationOAuth2CallbackHandler,
});

// Slack Events API — single Request URL for the shared Slack App. Verifies the
// request signature, answers the URL-verification challenge, and routes events
// to the installing org by team_id.
http.route({
  path: '/api/integrations/slack/events',
  method: 'POST',
  handler: slackEventsHandler,
});

// Agent integration dispatch — the in-sandbox MCP bridge calls these so the
// agent can use the org's connected integrations (credentials stay
// server-side). Auth: Authorization: Bearer <per-session VK> (dispatch_http.ts).
http.route({
  path: '/api/integrations/execute',
  method: 'POST',
  handler: executeIntegrationHandler,
});
http.route({
  path: '/api/integrations/status',
  method: 'POST',
  handler: integrationStatusHandler,
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

// External agent runtimes (tale-daemon)
http.route({
  path: '/api/v1/runtimes/register',
  method: 'POST',
  handler: registerRuntime,
});
http.route({
  path: '/api/v1/runtimes/heartbeat',
  method: 'POST',
  handler: heartbeatRuntime,
});
http.route({
  pathPrefix: '/api/v1/runtimes/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  path: '/api/v1/runs/claim',
  method: 'POST',
  handler: claimRun,
});
http.route({
  pathPrefix: '/api/v1/runs/',
  method: 'POST',
  handler: runSubActions,
});
http.route({
  pathPrefix: '/api/v1/runs/',
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

// ---------------------------------------------------------------------------
// Sandbox callback endpoints (sandbox-wobbly-origami plan §2).
//
// The spawner POSTs here from inside docker compose to (a) request more
// presigned upload URLs (EP1) and (b) report each successful upload's
// storageId (EP2). Both are HMAC-authenticated using the same SANDBOX_TOKEN
// the spawner uses for inbound `/v1/execute` — we reuse the secret rather
// than mint a new one.
//
// Routed through Caddy `handle /api/sandbox/*` → convex:3211.
// ---------------------------------------------------------------------------
http.route({
  path: '/api/sandbox/output_upload_url',
  method: 'POST',
  handler: outputUploadUrlAction,
});

http.route({
  path: '/api/sandbox/record_uploaded',
  method: 'POST',
  handler: recordUploadedAction,
});

const _routes = http.getRoutes();
export default http;
