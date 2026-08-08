import { anyApi } from 'convex/server';

import { rewriteStorageOrigin } from '../ctx';
import { convexErrorCode } from '../errors';
import { checkResourceLock } from '../locks';
import {
  WEBDAV_MAX_PUT_BYTES,
  WebDAVBodyTooLarge,
  type AuthContext,
  type ParsedPath,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';
import { computeETag, ifNoneMatchMatches } from './get';

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

  // Resolve the target's current ETag once when any conditional needs it:
  // the WebDAV If: header's `[etag]` term (RFC 4918 §10.4.4, evaluated by the
  // lock check below), or the HTTP If-Match / If-None-Match preconditions
  // (RFC 7232) evaluated immediately after. `If-None-Match: *` needs no ETag.
  const docExists = resolved.exists && resolved.kind === 'document';
  const ifHeader = req.headers.get('if');
  const ifMatch = req.headers.get('if-match');
  const ifNoneMatch = req.headers.get('if-none-match');
  let resourceEtag: string | undefined;
  if (
    resolved.exists &&
    resolved.kind === 'document' &&
    ((ifHeader !== null && ifHeader.includes('[')) ||
      ifMatch !== null ||
      (ifNoneMatch !== null && ifNoneMatch.trim() !== '*'))
  ) {
    const props = await ctx.convex.query(
      anyApi.webdav.tree_queries.getDocumentProps,
      { organizationId: auth.organizationId, documentId: resolved.documentId },
    );
    if (props) resourceEtag = computeETag(props);
  }

  // HTTP conditional preconditions (RFC 7232) — distinct from the WebDAV
  // If: header. `If-None-Match: *` is the common "create only if absent"
  // guard; `If-Match` enables a safe optimistic-concurrency overwrite. A
  // failed precondition is 412 and the write does not proceed.
  // (ifNoneMatchMatches doubles as the generic "ETag in list, or *" test.)
  if (
    ifNoneMatch !== null &&
    docExists &&
    ifNoneMatchMatches(ifNoneMatch, resourceEtag ?? '')
  ) {
    return {
      status: 412,
      headers: {},
      body: 'If-None-Match precondition failed',
    };
  }
  if (ifMatch !== null) {
    const matched =
      docExists &&
      (ifMatch.trim() === '*' ||
        (resourceEtag !== undefined &&
          ifNoneMatchMatches(ifMatch, resourceEtag)));
    if (!matched) {
      return {
        status: 412,
        headers: {},
        body: 'If-Match precondition failed',
      };
    }
  }

  // Lock enforcement applies to BOTH overwrite and create:
  //  - overwriting an existing locked document (RFC 4918 §9.7 / §6.4),
  //  - an exact-path lock on an unmapped URL (lock-null reservation, §7.3) —
  //    another principal LOCKed this name; the write needs the token,
  //  - a depth=infinity lock on an ancestor collection (§7.4).
  // checkResourceLock enumerates the leaf (any depth) + ancestors (infinity),
  // so one call covers all three. The previous code gated on resolved.exists
  // and therefore skipped every lock check on a fresh PUT.
  const lockResult = await checkResourceLock(req, ctx, auth, parsed, {
    // A fresh PUT adds a new member to the parent collection, so a depth-0 lock
    // on the direct parent blocks it (RFC 4918 §9.10.4). Overwriting an
    // existing document changes no membership, so leave it false there.
    directParentDepth0: !resolved.exists,
    resourceEtag,
  });
  if (!lockResult.ok) {
    return {
      status: lockResult.status,
      headers: lockResult.headers,
      body: lockResult.body,
    };
  }
  if (resolved.exists && resolved.kind !== 'document') {
    // RFC 4918 §9.7.2: same 405 as PUT-on-collection by URL shape.
    return {
      status: 405,
      headers: { Allow: ALLOW_ON_COLLECTION },
      body: 'Target is a collection',
    };
  }

  const contentType =
    req.headers.get('content-type') ?? 'application/octet-stream';

  // Two-step upload:
  // 1) Ask Convex for an upload target — backend-aware: the org's own S3 bucket
  //    (a presigned PUT) when configured, else Convex `_storage` (a
  //    generateUploadUrl POST). A chunked PUT (no Content-Length) can't target
  //    a presigned S3 PUT — they require a known length — so those fall back to
  //    the Convex `_storage` POST (native chunked ingest); the idempotent
  //    per-org blob backfill relocates such a blob into the bucket later.
  // 2) Stream the bytes to that target.
  // A Convex POST url self-reports an origin (127.0.0.1:3210 self-hosted)
  // unreachable from this container; re-home it onto the reachable backend
  // origin (CONVEX_URL). A presigned S3 PUT already addresses the org's public
  // endpoint — leave it untouched. See ctx.ts.
  let uploadTarget: { url: string; method: 'POST' | 'PUT'; s3Ref?: string };
  if (declaredSize !== null) {
    const handoff: unknown = await ctx.convex.action(
      anyApi.files.blob_actions.generateWebdavBlobUpload,
      { organizationId: auth.organizationId, contentType },
    );
    if (!isUploadHandoff(handoff)) {
      console.error(
        '[webdav] PUT generateWebdavBlobUpload returned malformed handoff',
        handoff,
      );
      return { status: 502, headers: {}, body: 'Upload URL unavailable' };
    }
    uploadTarget = handoff;
  } else {
    const rawUploadUrl: unknown = await ctx.convex.mutation(
      anyApi.webdav.tree_mutations.generateWebdavUploadUrl,
      {},
    );
    if (typeof rawUploadUrl !== 'string') {
      console.error(
        '[webdav] PUT generateWebdavUploadUrl returned non-string',
        rawUploadUrl,
      );
      return { status: 502, headers: {}, body: 'Upload URL unavailable' };
    }
    uploadTarget = { url: rawUploadUrl, method: 'POST' };
  }
  const uploadUrl =
    uploadTarget.method === 'POST'
      ? rewriteStorageOrigin(uploadTarget.url, ctx.convexApiUrl)
      : uploadTarget.url;

  // Wrap the body in a counter so we can fail the request if the
  // client sent more bytes than Content-Length (or no Content-Length)
  // promised. Falls through when there is no body (Length: 0 PUT).
  const { body, sizeOf } = wrapWithCap(req.body, WEBDAV_MAX_PUT_BYTES);

  const uploadHeaders: Record<string, string> = { 'Content-Type': contentType };
  if (declaredSize !== null) {
    uploadHeaders['Content-Length'] = String(declaredSize);
  }

  let upload: Response;
  try {
    upload = await fetch(uploadUrl, {
      method: uploadTarget.method,
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
  // Convex POST returns `{ storageId }` in its body; an S3 PUT returns no body
  // — the ref (the object key) was known up front and handed back as `s3Ref`.
  const storageId =
    uploadTarget.method === 'PUT'
      ? (uploadTarget.s3Ref ?? null)
      : extractStorageId(await upload.json().catch(() => null));
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
    // ingestPutBlob is transactional: on any throw, no documents /
    // fileMetadata row references the already-uploaded blob, so reclaim it
    // to avoid a permanent _storage leak (a missing-parent PUT is a common
    // sync-client race). Fire-and-forget — the client still gets the real
    // error below.
    void ctx.convex
      .mutation(anyApi.webdav.tree_mutations.deleteWebdavBlob, {
        storageId,
        organizationId: auth.organizationId,
      })
      .catch((e: unknown) =>
        console.warn('[webdav] PUT orphan-blob cleanup failed', e),
      );
    const code = convexErrorCode(err);
    if (code === 'LEGAL_HOLD_ACTIVE') {
      // Overwrite of a held document — refuse. 403, not 423 (a legal hold is
      // not a client-clearable WebDAV lock). The orphan blob was reclaimed
      // above.
      return {
        status: 403,
        headers: {},
        body: 'Document is under legal hold',
      };
    }
    if (code === 'DOCUMENT_RECORD_FROZEN') {
      // Overwrite of a controlled record that is in review or approved —
      // refuse like the legal hold; the orphan blob was reclaimed above.
      return {
        status: 403,
        headers: {},
        body: 'Document is a frozen controlled record',
      };
    }
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

// Shape guard for the backend-aware upload handoff returned by
// files.blob_actions.generateWebdavBlobUpload (crosses the ConvexHttpClient
// boundary as `unknown`).
function isUploadHandoff(
  value: unknown,
): value is { url: string; method: 'POST' | 'PUT'; s3Ref?: string } {
  if (typeof value !== 'object' || value === null) return false;
  const url: unknown = (value as { url?: unknown }).url;
  const method: unknown = (value as { method?: unknown }).method;
  return typeof url === 'string' && (method === 'POST' || method === 'PUT');
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
//
// Pull-based on purpose: the wrapped stream reads from the client ONLY
// when its downstream consumer (the upload `fetch` to Convex /storage)
// pulls. A `start(controller)` + `while(true)` loop would drain the
// entire client upload into this stream's internal queue regardless of
// how slowly Convex ingests it, buffering up to `cap` bytes (default
// 5 GB) in platform RAM per PUT — N concurrent slow-ingest PUTs would
// OOM the process. `pull` restores end-to-end backpressure: at most one
// chunk is in flight beyond what the consumer has accepted.
//
// Exported for unit testing (backpressure + cap behaviour).
export function wrapWithCap(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): {
  body: ReadableStream<Uint8Array> | null;
  sizeOf: () => number;
} {
  if (!body) return { body: null, sizeOf: () => 0 };
  let total = 0;
  const reader = body.getReader();
  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let chunk = await reader.read();
        // Skip zero-length chunks without enqueuing (keeps backpressure
        // granular at one real chunk per pull).
        while (!chunk.done && (!chunk.value || chunk.value.byteLength === 0)) {
          chunk = await reader.read();
        }
        if (chunk.done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        total += chunk.value.byteLength;
        if (total > cap) {
          // Named error (this.name === 'WebDAVBodyTooLarge') so put.ts's
          // extractReason() maps it to 413, not the generic 502.
          const tooLarge = new WebDAVBodyTooLarge(cap);
          controller.error(tooLarge);
          // Stop reading the oversized upload from the client.
          await reader.cancel(tooLarge).catch(() => {});
          return;
        }
        controller.enqueue(chunk.value);
      } catch (err) {
        controller.error(err);
        reader.releaseLock();
      }
    },
    cancel(reason) {
      // Downstream aborted (client disconnect / upload failure) — stop
      // pulling from the client so bandwidth isn't wasted end to end.
      return reader.cancel(reason);
    },
  });
  return { body: wrapped, sizeOf: () => total };
}
