import { anyApi } from 'convex/server';

import { checkResourceLock } from '../locks';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';

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
    return {
      status: 405,
      headers: { Allow: 'OPTIONS, PROPFIND' },
      body: 'PUT requires a non-collection target',
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
    // RFC 4918 §9.7.2: 409 if target is a collection
    return { status: 409, headers: {}, body: 'Target is a collection' };
  }

  // Two-step upload:
  // 1) Ask Convex for a presigned URL
  // 2) POST the bytes to that URL — returns { storageId }
  const uploadUrl = await ctx.convex.mutation(
    anyApi.webdav.tree_mutations.generateWebdavUploadUrl,
    {},
  );
  const bytes = await req.readBytes();
  // Re-wrap in an ArrayBuffer-backed Uint8Array so TS sees it as
  // BlobPart-compatible. `readBytes()` returns the wider Uint8Array<ArrayBufferLike>
  // that the Web fetch API doesn't accept directly under strict types.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type':
        req.headers.get('content-type') ?? 'application/octet-stream',
    },
    body: new Blob([buf]),
  });
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

  const result = await ctx.convex.mutation(
    anyApi.webdav.tree_mutations.ingestPutBlob,
    {
      organizationId: auth.organizationId,
      pathSegments: parsed.segments,
      storageId,
      contentType:
        req.headers.get('content-type') ?? 'application/octet-stream',
      size: bytes.byteLength,
      userId: auth.userId,
    },
  );

  return {
    status: result.created ? 201 : 204,
    headers: {},
    body: null,
  };
}

function extractStorageId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('storageId' in payload)) return null;
  const candidate: unknown = payload.storageId;
  return typeof candidate === 'string' ? candidate : null;
}
