import { httpRouter } from 'convex/server';

import { getString, isRecord } from '../lib/utils/type-utils';
import { components, internal } from './_generated/api';
import { httpAction } from './_generated/server';
import {
  claimRun,
  heartbeatRuntime,
  registerRuntime,
  runSubActions,
} from './agent_runtimes/rest_api';
import {
  executeToolHandler,
  toolStatusHandler,
} from './agent_tools/dispatch_http';
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
  listContacts,
  createContact,
  getContact,
  patchContact,
  deleteContact,
  contactPostActions,
} from './contacts/rest_api';
import {
  listDocuments,
  createDocument,
  getDocument,
  patchDocument,
  deleteDocument,
  documentSubActions,
} from './documents/rest_api';
import {
  ssoDiscoverHandler,
  ssoAuthorizeHandler,
  ssoCallbackHandler,
  ssoSetSessionHandler,
  samlMetadataHandler,
  samlLoginHandler,
  samlAcsHandler,
} from './enterprise_sso/http_handlers';
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
import { isS3Ref } from './lib/storage/blob_ref';
import { toId } from './lib/type_cast_helpers';
import { getClientIp, loadTrustedProxies } from './lib/utils/client_ip';
import { sanitizeError } from './lib/utils/sanitize_secrets';
import {
  chatCompletionsHandler,
  chatCompletionsOptionsHandler,
  imagesGenerationsHandler,
  imagesGenerationsOptionsHandler,
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
  scimGroupResourceHandler,
  scimGroupsHandler,
  scimOptionsHandler,
  scimResourceTypesHandler,
  scimSchemasHandler,
  scimServiceProviderConfigHandler,
  scimUserResourceHandler,
  scimUsersHandler,
} from './scim/http_actions';
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
    // `ref` is the universal blob reference (a `_storage` id or an `s3:` ref);
    // `id` is the legacy param (always a `_storage` id) still used by
    // `buildDownloadUrl`. Either identifies the blob.
    const ref = url.searchParams.get('ref') ?? url.searchParams.get('id');
    const filename = url.searchParams.get('filename');

    if (!ref) {
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

    // S3-backed blob: a V8 httpAction can't presign, so delegate to the node
    // action and 302-redirect the browser to the short-lived presigned GET. The
    // `org` param identifies which bucket (the ref alone doesn't).
    if (isS3Ref(ref)) {
      const org = url.searchParams.get('org');
      if (!org) {
        return new Response('Missing org for S3 blob', { status: 400 });
      }
      const presigned: string | null = await ctx.runAction(
        internal.files.blob_actions.presignBlobGet,
        { organizationId: org, ref, filename: filename ?? undefined },
      );
      if (!presigned) {
        return new Response('File not found', { status: 404 });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: presigned },
      });
    }

    try {
      const blob = await ctx.storage.get(toId<'_storage'>(ref));
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
      // Resolve the bytes from whichever backend owns them. An `s3:`-backed
      // chunk is read through the node lane and STREAMED through this
      // response — deliberately NOT a 302 to a presigned URL: this route's
      // security model is a per-request cookie-bound membership check, and a
      // presigned URL would be bearer-replayable by anyone who intercepts it.
      let body: Blob | ArrayBuffer;
      let contentType: string;
      let contentLength: number;
      if (isS3Ref(chunk.storageId)) {
        const bytes: ArrayBuffer | null = await ctx.runAction(
          internal.files.blob_actions.readOrgBlob,
          { organizationId: chunk.organizationId, ref: chunk.storageId },
        );
        if (!bytes) {
          return new Response('Not found', { status: 404 });
        }
        body = bytes;
        contentType = chunk.contentType;
        contentLength = bytes.byteLength;
      } else {
        const blob = await ctx.storage.get(toId<'_storage'>(chunk.storageId));
        if (!blob) {
          return new Response('Not found', { status: 404 });
        }
        body = blob;
        contentType = blob.type || 'application/octet-stream';
        contentLength = blob.size;
      }
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': contentLength.toString(),
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
      return new Response(body, { status: 200, headers });
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
    if (file.status === 'gone') {
      // The session's backend is gone (phantom row read 'active'). Tell the
      // browser to show "resume to browse", not "file missing" — same 409 the
      // session-not-active gate above returns.
      return new Response(JSON.stringify({ error: 'session_not_running' }), {
        status: 409,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
        },
      });
    }
    if (file.status === 'missing') {
      // Spawner 404 with a live session: missing/unsafe path OR a file over
      // runnerd's 20 MB read cap (indistinguishable here, so 404).
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

/**
 * Authorization oracle for the platform server's browser-facing screencast
 * WebSocket (`/screencast/:threadId`). The platform's own Bun server (server.ts)
 * terminates that WS but can't run Convex queries directly, so it forwards the
 * request's Cookie header here BEFORE upgrading. We resolve identity from the
 * Better Auth session cookie (a WS upgrade can't carry a Bearer header but does
 * send same-origin cookies — same pattern as `/api/tts-audio`,
 * `/api/sandbox/workspace_file`) and run the SAME `canAccessThread` boundary the
 * workspace-file download route uses, so cross-org screencast access is
 * impossible.
 *
 * Query param: `threadId` (required). Statuses: 400 missing threadId, 401 no
 * session, 403 no thread access, 409 no running session, 200 `{ sessionId }`.
 * `Vary: Cookie` + `Cache-Control: no-store` so a TLS-terminating proxy can't
 * cache the answer against the URL and starve / over-grant a different session.
 */
http.route({
  path: '/api/sandbox/screencast-auth',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const threadId = url.searchParams.get('threadId');
    if (!threadId) {
      return new Response('Missing threadId', { status: 400 });
    }

    // Rate-limit BEFORE the session lookup so an anonymous flood can't force a
    // Better Auth DB session-query per request (mirrors /api/sandbox/workspace_file).
    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
    try {
      await checkIpRateLimit(ctx, 'security:screencast-auth', ip);
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

    // SAME canAccessThread boundary as the workspace-file route, keyed by the
    // Better Auth userId (httpActions don't get identity from ctx.auth via the
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
      console.debug('[http /api/sandbox/screencast-auth] access denied', {
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
      // No running session to stream from — the browser shows "resume to view".
      // Only 'active' (not 'creating'/'degraded') gets a live screencast: the
      // runnerd raw-VNC tunnel is only reachable once the session is up.
      return new Response(JSON.stringify({ error: 'session_not_running' }), {
        status: 409,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
        },
      });
    }

    // Writable control (`?control=1`) is a SEPARATE, stricter grant than view:
    // it's available to the thread OWNER at any time, so a human can grab the
    // wheel whenever the session is active. A denied control request (a non-owner
    // streams read-only (control:false) — the pane just stays a mirror — so a
    // second viewer can watch while the owner drives.
    let control = false;
    if (url.searchParams.get('control') === '1') {
      try {
        const lease = await ctx.runMutation(
          internal.approvals.human_control_mutations.claimHumanControlLease,
          { threadId, userId: session.user.id },
        );
        control = lease.ok;
      } catch (error) {
        console.warn('[http /api/sandbox/screencast-auth] lease claim failed', {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return new Response(JSON.stringify({ sessionId, control }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Vary: 'Cookie',
      },
    });
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

// Workspace-tool dispatch — the same bridge calls these so an external agent
// can use the platform tools its config grants (`toolNames`); execution and
// grants stay server-side (agent_tools/dispatch_http.ts).
http.route({
  path: '/api/tools/execute',
  method: 'POST',
  handler: executeToolHandler,
});
http.route({
  path: '/api/tools/status',
  method: 'POST',
  handler: toolStatusHandler,
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

// SAML 2.0 (SP metadata + SP-initiated login + Assertion Consumer Service)
http.route({
  path: '/api/sso/saml/metadata',
  method: 'GET',
  handler: samlMetadataHandler,
});
http.route({
  path: '/api/sso/saml/login',
  method: 'GET',
  handler: samlLoginHandler,
});
http.route({
  path: '/api/sso/saml/acs',
  method: 'POST',
  handler: samlAcsHandler,
});

// SCIM 2.0 provisioning (RFC 7643/7644). Bearer-token authenticated; the
// org is resolved from the token row inside each handler. See scim/.
http.route({
  path: '/scim/v2/ServiceProviderConfig',
  method: 'GET',
  handler: scimServiceProviderConfigHandler,
});
http.route({
  path: '/scim/v2/ResourceTypes',
  method: 'GET',
  handler: scimResourceTypesHandler,
});
http.route({
  path: '/scim/v2/Schemas',
  method: 'GET',
  handler: scimSchemasHandler,
});
for (const method of ['GET', 'POST'] as const) {
  http.route({ path: '/scim/v2/Users', method, handler: scimUsersHandler });
  http.route({ path: '/scim/v2/Groups', method, handler: scimGroupsHandler });
}
for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
  http.route({
    pathPrefix: '/scim/v2/Users/',
    method,
    handler: scimUserResourceHandler,
  });
  http.route({
    pathPrefix: '/scim/v2/Groups/',
    method,
    handler: scimGroupResourceHandler,
  });
}
http.route({
  path: '/scim/v2/Users',
  method: 'OPTIONS',
  handler: scimOptionsHandler,
});
http.route({
  path: '/scim/v2/Groups',
  method: 'OPTIONS',
  handler: scimOptionsHandler,
});
http.route({
  pathPrefix: '/scim/v2/Users/',
  method: 'OPTIONS',
  handler: scimOptionsHandler,
});
http.route({
  pathPrefix: '/scim/v2/Groups/',
  method: 'OPTIONS',
  handler: scimOptionsHandler,
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
  path: '/api/v1/images/generations',
  method: 'POST',
  handler: imagesGenerationsHandler,
});

http.route({
  path: '/api/v1/images/generations',
  method: 'OPTIONS',
  handler: imagesGenerationsOptionsHandler,
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

// Contacts
http.route({
  path: '/api/v1/contacts',
  method: 'GET',
  handler: listContacts,
});
http.route({
  path: '/api/v1/contacts',
  method: 'POST',
  handler: createContact,
});
http.route({
  path: '/api/v1/contacts',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/contacts/',
  method: 'GET',
  handler: getContact,
});
http.route({
  pathPrefix: '/api/v1/contacts/',
  method: 'PATCH',
  handler: patchContact,
});
http.route({
  pathPrefix: '/api/v1/contacts/',
  method: 'DELETE',
  handler: deleteContact,
});
http.route({
  pathPrefix: '/api/v1/contacts/',
  method: 'POST',
  handler: contactPostActions,
});
http.route({
  pathPrefix: '/api/v1/contacts/',
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
