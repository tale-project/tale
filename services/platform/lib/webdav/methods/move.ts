import { anyApi } from 'convex/server';

import { convexErrorCode } from '../errors';
import { checkResourceLock } from '../locks';
import { parseDavPath } from '../paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';

export async function handleMove(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  return doMoveOrCopy(req, ctx, auth, parsed, 'MOVE');
}

export async function handleCopy(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  return doMoveOrCopy(req, ctx, auth, parsed, 'COPY');
}

async function doMoveOrCopy(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
  op: 'MOVE' | 'COPY',
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }
  if (parsed.segments.length === 0) {
    return { status: 403, headers: {}, body: 'Cannot move/copy the root' };
  }

  const destHeader = req.headers.get('destination');
  if (!destHeader) {
    return { status: 400, headers: {}, body: 'Missing Destination header' };
  }
  const destPathname = (() => {
    try {
      // Destination may be absolute URL or absolute path.
      return new URL(destHeader, 'http://placeholder').pathname;
    } catch {
      return null;
    }
  })();
  if (!destPathname) {
    return { status: 400, headers: {}, body: 'Invalid Destination header' };
  }

  const destParsed = parseDavPath(destPathname);
  if (!destParsed || destParsed.orgSlug !== auth.orgSlug) {
    return {
      status: 502,
      headers: {},
      body: 'Cross-host or cross-org destination not supported',
    };
  }
  if (destParsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Cannot target trash' };
  }
  if (destParsed.segments.length === 0) {
    return { status: 403, headers: {}, body: 'Cannot target root' };
  }

  const overwrite = (req.headers.get('overwrite') ?? 'T').toUpperCase() !== 'F';

  // Lock check on source (and destination if MOVE — destination loses
  // its lock too via collision delete).
  const srcLock = await checkResourceLock(req, ctx, auth, parsed);
  if (!srcLock.ok) {
    return { status: srcLock.status, headers: {}, body: srcLock.reason };
  }
  if (op === 'MOVE') {
    const dstLock = await checkResourceLock(req, ctx, auth, destParsed);
    if (!dstLock.ok) {
      return { status: dstLock.status, headers: {}, body: dstLock.reason };
    }
  }

  const src = await ctx.convex.query(anyApi.webdav.tree_queries.resolvePath, {
    organizationId: auth.organizationId,
    namespace: parsed.namespace,
    segments: parsed.segments,
  });
  if (!src.exists || src.kind === 'root') {
    return { status: 404, headers: {}, body: 'Source not found' };
  }

  const destParentSegments = destParsed.segments.slice(0, -1);
  const destName = destParsed.segments[destParsed.segments.length - 1];
  const srcArg =
    src.kind === 'document'
      ? { kind: 'document' as const, id: src.documentId }
      : { kind: 'folder' as const, id: src.folderId };

  try {
    const result = await ctx.convex.mutation(
      op === 'MOVE'
        ? anyApi.webdav.tree_mutations.moveResource
        : anyApi.webdav.tree_mutations.copyResource,
      {
        organizationId: auth.organizationId,
        src: srcArg,
        destParentSegments,
        destName,
        overwrite,
        userId: auth.userId,
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
      return { status: 412, headers: {}, body: 'Destination exists' };
    }
    if (code === 'NOT_FOUND') {
      return { status: 404, headers: {}, body: 'Not found' };
    }
    console.error(`[webdav] ${op} failed`, err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }
}
