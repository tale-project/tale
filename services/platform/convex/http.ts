import { httpRouter } from 'convex/server';

import { getString, isRecord } from '../lib/utils/type-utils';
import { components, internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { deleteAgent, getAgent, listAgents, putAgent } from './agents/rest_api';
import { apiGatewayOptions, apiGatewayRun } from './api_gateway';
import { authComponent, createAuth } from './auth';
import {
  automationDeleteActions,
  automationPostActions,
  automationPutActions,
  automationReads,
  getAutomationRun,
  listAutomations,
  runPostActions,
} from './automations/rest_api';
import { automationWebhookHandler } from './automations/triggers';
import {
  mcpHandler,
  mcpMethodNotAllowed,
} from './automations_builder/mcp_http';
import {
  createThread,
  listThreads,
  threadPostActions,
  threadReads,
} from './chat/rest_api';
import { connectorsHostcallHandler } from './connectors/hostcall_http';
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
import { sandboxBlobServeHandler } from './files/sandbox_blob_http';
import {
  connectorsOauth2CallbackHandler,
  connectorsOauth2StartHandler,
  connectorsSlackEventsHandler,
} from './http_connectors/http_actions';
import { searchKnowledge } from './knowledge/rest_api';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  patchKnowledgeEntry,
} from './knowledge_entries/rest_api';
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
  listProducts,
  createProduct,
  getProduct,
  patchProduct,
  deleteProduct,
} from './products/rest_api';
import {
  connectorsExecuteHandler,
  connectorsStatusHandler,
} from './sandbox/connectors_http';
import { toolsExecuteHandler, toolsStatusHandler } from './sandbox/tools_http';
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
import { deleteSkill, getSkill, listSkills, putSkill } from './skills/rest_api';
import { trustedHeadersAuthHandler } from './trusted_headers_auth/http_handlers';
import {
  listWebsites,
  createWebsite,
  getWebsite,
  patchWebsite,
  deleteWebsite,
  websitePostActions,
} from './websites/rest_api';

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
      // Fail closed as 404, never 500: presign throws for a key outside the
      // org's namespace (s3KeyBelongsToOrg) and for an org with no object
      // storage configured — neither is a server fault, and 404 doesn't leak
      // whether the object exists.
      let presigned: string | null;
      try {
        presigned = await ctx.runAction(
          internal.files.blob_actions.presignBlobGet,
          { organizationId: org, ref, filename: filename ?? undefined },
        );
      } catch (error) {
        console.warn(
          `[storage] refused s3 blob serve for org ${org}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        presigned = null;
      }
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

// /api/image-proxy re-registers with the chat rebuild
// image-generation tool rebuild.

// Sandbox staging lane for org-bucket blobs — HMAC-token-gated, streams the
// bytes through so the SSRF-locked session container never sees a bucket
// credential. See files/sandbox_blob_http.ts.
http.route({
  path: '/api/sandbox-blob',
  method: 'GET',
  handler: sandboxBlobServeHandler,
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

// Connector routes. The OAuth2 pair is the consent flow that turns
// a connector into a stored credential: `start` is session-authenticated and
// mints a single-use, server-side state; `callback` consumes it and exchanges
// the code server-to-server. The Slack endpoint is the shared inbound Request
// URL — signature-verified over the raw body, then routed to exactly one
// organization by `team_id`. See http_connectors/.
http.route({
  path: '/api/connectors/oauth2/start',
  method: 'GET',
  handler: connectorsOauth2StartHandler,
});
http.route({
  path: '/api/connectors/oauth2/callback',
  method: 'GET',
  handler: connectorsOauth2CallbackHandler,
});
http.route({
  path: '/api/connectors/slack/events',
  method: 'POST',
  handler: connectorsSlackEventsHandler,
});

// Automation webhook triggers. The token in the path IS the credential: it is
// matched against the stored SHA-256 with a constant-time compare, and the
// organization the run belongs to comes from the trigger row it resolves to —
// never from the request. An unknown or disabled token is a plain 404. See
// automations/triggers.ts.
http.route({
  pathPrefix: '/api/automations/webhook/',
  method: 'POST',
  handler: automationWebhookHandler,
});

// The platform MCP endpoint: the engine's 12-method dispatch as MCP tools
// over streamable HTTP (JSON responses). Org API-key authed like every
// /api/v1 surface. See automations_builder/mcp_http.ts.
http.route({
  path: '/api/v1/mcp',
  method: 'POST',
  handler: mcpHandler,
});
http.route({
  path: '/api/v1/mcp',
  method: 'GET',
  handler: mcpMethodNotAllowed,
});
http.route({
  path: '/api/v1/mcp',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// The in-sandbox connectors bridge: the platform end of the baked
// `tale-connectors-mcp` MCP server, VK-bearer-authed against the session
// token row (org + grants come from the row, never the body). Read-only in V1.
http.route({
  path: '/api/connectors/execute',
  method: 'POST',
  handler: connectorsExecuteHandler,
});
http.route({
  path: '/api/connectors/status',
  method: 'POST',
  handler: connectorsStatusHandler,
});

// The host-call end of a live connector body running out of process: the
// in-sandbox portable façade round-trips each `ctx.http.*` here, authed by a
// one-run HMAC capability token minted at dispatch. See
// connectors/hostcall_http.ts.
http.route({
  path: '/api/connectors/hostcall',
  method: 'POST',
  handler: connectorsHostcallHandler,
});

// The workspace-tool half of the same bridge (the shim's
// `workspace_tool`/`workspace_status` face, reached at the derived
// `…/api/tools` base): first-party ORG reads — knowledge search + the
// Documents hub — run as the turn's user, org-scoped, read-only. Same
// VK-bearer auth; grants (`toolGrants`) come from the token row.
http.route({
  path: '/api/tools/execute',
  method: 'POST',
  handler: toolsExecuteHandler,
});
http.route({
  path: '/api/tools/status',
  method: 'POST',
  handler: toolsStatusHandler,
});

// /api/chat-stream (GET+OPTIONS) re-registers with the chat
// v2 streaming rebuild.

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

// Agent webhook routes (/api/agents/wh/*) re-register with
// the chat rebuild agent-webhooks rebuild.

// The OpenAI-compatible inbound API (/api/v1/chat/completions,
// /api/v1/images/generations, /api/v1/models) re-registers with the chat rebuild.

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

// External-runtime (tale-daemon) REST routes (/api/v1/runtimes/*) re-register
// with the chat rebuild daemon-runs rebuild. NOTE: /api/v1/runs/ now addresses
// AUTOMATION runs (registered below), so the daemon lane needs a path of its
// own — /api/v1/runtimes/{id}/runs — rather than the top-level one it used to
// claim.

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

// Automations. One handler per METHOD dispatches the sub-resources
// (`/versions`, `/runs`, `/triggers`) because the router matches a path prefix,
// not a pattern. An automation's name is a `/`-separated path, so it travels in
// the URL with `__` for the separator — the same codec the app's detail route
// uses. See automations/rest_api.ts.
http.route({
  path: '/api/v1/automations',
  method: 'GET',
  handler: listAutomations,
});
http.route({
  path: '/api/v1/automations',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/automations/',
  method: 'GET',
  handler: automationReads,
});
http.route({
  pathPrefix: '/api/v1/automations/',
  method: 'POST',
  handler: automationPostActions,
});
http.route({
  pathPrefix: '/api/v1/automations/',
  method: 'PUT',
  handler: automationPutActions,
});
http.route({
  pathPrefix: '/api/v1/automations/',
  method: 'DELETE',
  handler: automationDeleteActions,
});
http.route({
  pathPrefix: '/api/v1/automations/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Automation runs. Addressed by run id rather than under the automation,
// because a run id is unique on its own and a caller polling one holds nothing
// else.
http.route({
  pathPrefix: '/api/v1/runs/',
  method: 'GET',
  handler: getAutomationRun,
});
http.route({
  pathPrefix: '/api/v1/runs/',
  method: 'POST',
  handler: runPostActions,
});
http.route({
  pathPrefix: '/api/v1/runs/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Chat threads. A thread is user-private: these see exactly the threads of the
// user the API key belongs to. Sending a message starts a DIRECT turn and
// answers 202; the caller polls `/generation`. See chat/rest_api.ts.
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
  handler: threadReads,
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

// Agents and skills — the org's config tree, not tables. PUT because the slug
// in the path is the identity: the same request creates or updates.
http.route({ path: '/api/v1/agents', method: 'GET', handler: listAgents });
http.route({
  path: '/api/v1/agents',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({ pathPrefix: '/api/v1/agents/', method: 'GET', handler: getAgent });
http.route({ pathPrefix: '/api/v1/agents/', method: 'PUT', handler: putAgent });
http.route({
  pathPrefix: '/api/v1/agents/',
  method: 'DELETE',
  handler: deleteAgent,
});
http.route({
  pathPrefix: '/api/v1/agents/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

http.route({ path: '/api/v1/skills', method: 'GET', handler: listSkills });
http.route({
  path: '/api/v1/skills',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({ pathPrefix: '/api/v1/skills/', method: 'GET', handler: getSkill });
http.route({ pathPrefix: '/api/v1/skills/', method: 'PUT', handler: putSkill });
http.route({
  pathPrefix: '/api/v1/skills/',
  method: 'DELETE',
  handler: deleteSkill,
});
http.route({
  pathPrefix: '/api/v1/skills/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

// Knowledge entries (the curated facts) and knowledge SEARCH (retrieval over
// the org's corpora). The search endpoint runs in a node action because
// retrieval needs a PostgreSQL pool and an embedding client.
http.route({
  path: '/api/v1/knowledge-entries',
  method: 'GET',
  handler: listKnowledgeEntries,
});
http.route({
  path: '/api/v1/knowledge-entries',
  method: 'POST',
  handler: createKnowledgeEntry,
});
http.route({
  path: '/api/v1/knowledge-entries',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});
http.route({
  pathPrefix: '/api/v1/knowledge-entries/',
  method: 'GET',
  handler: getKnowledgeEntry,
});
http.route({
  pathPrefix: '/api/v1/knowledge-entries/',
  method: 'PATCH',
  handler: patchKnowledgeEntry,
});
http.route({
  pathPrefix: '/api/v1/knowledge-entries/',
  method: 'DELETE',
  handler: deleteKnowledgeEntry,
});
http.route({
  pathPrefix: '/api/v1/knowledge-entries/',
  method: 'OPTIONS',
  handler: restOptionsHandler,
});

http.route({
  path: '/api/v1/knowledge/search',
  method: 'POST',
  handler: searchKnowledge,
});
http.route({
  path: '/api/v1/knowledge/search',
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

export default http;
