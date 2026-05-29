import { anyApi } from 'convex/server';

import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVResponse,
} from '../types';

export async function handleGet(
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
  headOnly: boolean,
): Promise<WebDAVResponse> {
  const resolved = await ctx.convex.query(
    anyApi.webdav.tree_queries.resolvePath,
    {
      organizationId: auth.organizationId,
      namespace: parsed.namespace,
      segments: parsed.segments,
    },
  );
  if (!resolved.exists) {
    return { status: 404, headers: {}, body: 'Not found' };
  }
  if (resolved.kind !== 'document') {
    // GET on a collection: many WebDAV servers return an HTML listing;
    // we return 405 since the SPA UI is the discoverable surface and
    // /dav/ is not a user-browsable URL.
    return {
      status: 405,
      headers: { Allow: 'OPTIONS, PROPFIND' },
      body: 'GET on a collection is not allowed',
    };
  }

  const doc = await ctx.convex.query(
    anyApi.webdav.tree_queries.getDocumentProps,
    {
      organizationId: auth.organizationId,
      documentId: resolved.documentId,
    },
  );
  if (!doc || !doc.fileId) {
    return { status: 404, headers: {}, body: 'Not found' };
  }

  const headers: Record<string, string> = {
    'Content-Type':
      doc.contentType ?? doc.mimeType ?? 'application/octet-stream',
    ETag: `"${doc.contentHash ?? doc._id}"`,
    'Last-Modified': new Date(
      doc.sourceModifiedAt ?? doc.creationTime ?? Date.now(),
    ).toUTCString(),
  };
  if (typeof doc.size === 'number') {
    headers['Content-Length'] = String(doc.size);
  }

  if (headOnly) {
    return { status: 200, headers, body: null };
  }

  // Proxy stream the blob through Convex `/storage`. Going through the
  // existing route (not direct ctx.storage.get — we're outside Convex)
  // means we inherit its sanitation + rate limiting.
  const blobUrl = `${ctx.storageBaseUrl}/storage?id=${encodeURIComponent(doc.fileId)}`;
  const upstream = await fetch(blobUrl);
  if (!upstream.ok || !upstream.body) {
    console.warn('[webdav] GET storage proxy failed', upstream.status);
    return { status: 502, headers: {}, body: 'Storage fetch failed' };
  }

  return { status: 200, headers, body: upstream.body };
}
