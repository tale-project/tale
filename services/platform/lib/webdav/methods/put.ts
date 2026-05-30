import { anyApi } from 'convex/server';

import { convexErrorCode } from '../errors';
import { checkResourceLock } from '../locks';
import {
  WEBDAV_MAX_PUT_BYTES,
  type AuthContext,
  type ParsedPath,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';

const ALLOW_ON_COLLECTION =
  'OPTIONS, PROPFIND, DELETE, MOVE, COPY, PROPPATCH, LOCK';

export async function handlePut(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }
  if (parsed.segments.length === 0 || parsed.isCollection) {
    // RFC 4918 §9.7.2: PUT-on-collection is 405, not 409. The Allow
    // header lists what the collection *does* accept.
    return {
      status: 405,
      headers: { Allow: ALLOW_ON_COLLECTION },
      body: 'PUT not allowed on a collection',
    };
  }

  // Up-front Content-Length cap. Aborts huge uploads before we touch
  // Convex. mid-stream guard below catches Content-Length spoofing.
  const declaredSize = parseContentLength(req.headers.get('content-length'));
  if (declaredSize !== null && declaredSize > WEBDAV_MAX_PUT_BYTES) {
    return {
      status: 413,
      headers: {},
      body: 'Request body too large',
    };
  }

  // Pre-check existence to choose 201 vs 204 (RFC 4918 §9.7.1).
  const resolved = await ctx.convex.query(
    anyApi.webdav.tree_queries.resolvePath,
    {
      organizationId: auth.organizationId,
      namespace: parsed.namespace,
      segments: parsed.segments,
    },
  );

  // Lock check on overwrite — fresh PUT on a non-existent path needs no
  // lock (caller can't lock something that doesn't exist).
  if (resolved.exists && resolved.kind === 'document') {
    const lockResult = await checkResourceLock(req, ctx, auth, parsed);
    if (!lockResult.ok) {
      return {
        status: lockResult.status,
        headers: {},
        body: lockResult.reason,
      };
    }
  }
  if (resolved.exists && resolved.kind !== 'document') {
    // RFC 4918 §9.7.2: same 405 as PUT-on-collection by URL shape.
    return {
      status: 405,
      headers: { Allow: ALLOW_ON_COLLECTION },
      body: 'Target is a collection',
    };
  }

  // Two-step upload:
  // 1) Ask Convex for a presigned URL
  // 2) Stream the bytes to that URL — returns { storageId }
  const uploadUrl = await ctx.convex.mutation(
    anyApi.webdav.tree_mutations.generateWebdavUploadUrl,
    {},
  );

  // Wrap the body in a counter so we can fail the request if the
  // client sent more bytes than Content-Length (or no Content-Length)
  // promised. Falls through when there is no body (Length: 0 PUT).
  const { body, sizeOf } = wrapWithCap(req.body, WEBDAV_MAX_PUT_BYTES);

  const contentType =
    req.headers.get('content-type') ?? 'application/octet-stream';
  const uploadHeaders: Record<string, string> = { 'Content-Type': contentType };
  if (declaredSize !== null) {
    uploadHeaders['Content-Length'] = String(declaredSize);
  }

  let upload: Response;
  try {
    upload = await fetch(uploadUrl, {
      method: 'POST',
      headers: uploadHeaders,
      body: body ?? new Uint8Array(),
      // duplex:'half' is required by undici when the body is a stream.
      // The TS lib doesn't model the option yet, hence the cast.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      ...({ duplex: 'half' } as unknown as RequestInit),
      signal: req.signal,
    });
  } catch (err) {
    // Body-too-large bubbles through the stream as an AbortError on
    // some runtimes; differentiate via the WebDAVBodyTooLarge attached
    // to the controller's `reason`.
    const reason = extractReason(err);
    if (reason === 'WebDAVBodyTooLarge') {
      return { status: 413, headers: {}, body: 'Request body too large' };
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    if ((err as { name?: string }).name === 'AbortError') {
      // Client went away — surface 499-ish via a 5xx since RFC doesn't
      // formalise client-abort. 502 indicates upstream wasn't reached.
      console.warn('[webdav] PUT aborted by client', err);
      return { status: 499, headers: {}, body: 'Client closed request' };
    }
    console.error('[webdav] PUT upload threw', err);
    return { status: 502, headers: {}, body: 'Upload failed' };
  }

  if (!upload.ok) {
    const txt = await upload.text().catch(() => '');
    console.warn('[webdav] PUT upload failed', upload.status, txt);
    return { status: 502, headers: {}, body: 'Upload failed' };
  }
  const uploadResp: unknown = await upload.json().catch(() => null);
  const storageId = extractStorageId(uploadResp);
  if (!storageId) {
    return {
      status: 502,
      headers: {},
      body: 'Upload response missing storageId',
    };
  }

  // X-OC-Mtime (OwnCloud/NextCloud) in unix seconds. Convert to ms.
  // Anything malformed → undefined → mutation falls back to wall clock.
  const xOcMtime = parseMtimeHeader(req.headers.get('x-oc-mtime'));

  try {
    const result = await ctx.convex.mutation(
      anyApi.webdav.tree_mutations.ingestPutBlob,
      {
        organizationId: auth.organizationId,
        pathSegments: parsed.segments,
        storageId,
        contentType,
        size: sizeOf(),
        userId: auth.userId,
        sourceModifiedAtMs: xOcMtime,
      },
    );
    return {
      status: result.created ? 201 : 204,
      headers: {},
      body: null,
    };
  } catch (err) {
    const code = convexErrorCode(err);
    if (code === 'CONFLICT') {
      // Missing parent collection — RFC 4918 §9.7.1.
      return {
        status: 409,
        headers: {},
        body: 'Parent collection does not exist',
      };
    }
    if (code === 'INVALID_PATH') {
      return { status: 400, headers: {}, body: 'Invalid path' };
    }
    console.error('[webdav] PUT ingest failed', err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }
}

function parseContentLength(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseMtimeHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  // Unix seconds. Reject negatives / NaN — caller falls back.
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.trunc(n * 1000);
}

function extractStorageId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('storageId' in payload)) return null;
  const candidate: unknown = payload.storageId;
  return typeof candidate === 'string' ? candidate : null;
}

function extractReason(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  // Walking unknown error shapes — every step is type-guarded by the
  // surrounding `in`/`typeof` checks, so the narrowing assertions are
  // safe even though oxlint can't prove it.
  // oxlint-disable typescript-eslint/no-unsafe-type-assertion
  const cause = (err as { cause?: unknown }).cause;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    typeof (cause as { name?: unknown }).name === 'string'
  ) {
    return (cause as { name: string }).name;
  }
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
  // oxlint-enable typescript-eslint/no-unsafe-type-assertion
}

// Wraps a request body stream with a running byte counter that aborts
// the upload if the cumulative size exceeds `cap`. Returns the stream
// and a sizeOf() closure callers can read once upload completes.
function wrapWithCap(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): {
  body: ReadableStream<Uint8Array> | null;
  sizeOf: () => number;
} {
  if (!body) return { body: null, sizeOf: () => 0 };
  let total = 0;
  const wrapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > cap) {
            controller.error(new Error('WebDAVBodyTooLarge: PUT exceeded cap'));
            return;
          }
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
  return { body: wrapped, sizeOf: () => total };
}
