import { anyRefs } from '../../shared/handlers/function-refs';
import { backendErrorCode } from '../errors';
import { checkCollectionDescendantLocks, checkResourceLock } from '../locks';
import { buildDavPath, lockKeyFromParsed, parseDavPath } from '../paths';
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

  // RFC 4918 §9.8/§9.9: MOVE requires Depth: infinity (or absent),
  // COPY accepts 0 or infinity (absent → infinity for collections).
  const depthErr = validateDepth(req.headers.get('depth'), op);
  if (depthErr) return depthErr;

  const destHeader = req.headers.get('destination');
  if (!destHeader) {
    return { status: 400, headers: {}, body: 'Missing Destination header' };
  }

  // Destination may be absolute URL or absolute path. If absolute URL,
  // host must match the request host (cross-host → 502 per RFC).
  const reqHost = hostOf(req);
  const destParsedUrl = (() => {
    try {
      // Use a placeholder origin so relative paths still parse — we
      // examine .protocol to tell them apart from absolute URLs below.
      return new URL(destHeader, `http://${reqHost ?? 'placeholder'}`);
    } catch {
      return null;
    }
  })();
  if (!destParsedUrl) {
    return { status: 400, headers: {}, body: 'Invalid Destination header' };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(destHeader)) {
    // Absolute URL — host must match.
    if (!reqHost || destParsedUrl.host !== reqHost) {
      return {
        status: 502,
        headers: {},
        body: 'Cross-host destination not supported',
      };
    }
  }
  const destPathname = destParsedUrl.pathname;

  const destParsed = parseDavPath(destPathname);
  if (!destParsed) {
    return { status: 400, headers: {}, body: 'Invalid Destination header' };
  }
  if (destParsed.orgSlug !== auth.orgSlug) {
    // Same host, different org — this is an authorization boundary,
    // not a cross-host hop. RFC §9.8.5 lists 403 for "the source and
    // destination URIs are in different namespaces".
    return {
      status: 403,
      headers: {},
      body: 'Cross-org destination not allowed',
    };
  }
  if (destParsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Cannot target trash' };
  }
  if (destParsed.segments.length === 0) {
    return { status: 403, headers: {}, body: 'Cannot target root' };
  }

  const overwrite = (req.headers.get('overwrite') ?? 'T').toUpperCase() !== 'F';

  // Source lock: ONLY MOVE needs it. MOVE removes the source, so a lock on it
  // must be satisfied (RFC 4918 §9.9.4). COPY does not modify the source, so
  // per §9.8.5 it MUST NOT require the source lock token — enforcing it here
  // wrongly blocked copying out of a locked tree.
  if (op === 'MOVE') {
    const srcLock = await checkResourceLock(req, ctx, auth, parsed, {
      // MOVE removes the source from its parent collection, so a depth-0 lock
      // on the source's direct parent must block it too (RFC 4918 §9.10.4).
      directParentDepth0: true,
    });
    if (!srcLock.ok) {
      return {
        status: srcLock.status,
        headers: srcLock.headers,
        body: srcLock.body,
      };
    }
  }
  // Destination lock — required for BOTH MOVE and COPY: with Overwrite: T
  // (the default) either can destroy a locked destination, so the token
  // must be submitted (RFC 4918 §9.8.5 / §9.9.4). The destination is also a
  // NEW member of its parent collection, so a depth-0 lock on the
  // destination's direct parent must block it too (§9.10.4 — membership).
  const dstLock = await checkResourceLock(req, ctx, auth, destParsed, {
    directParentDepth0: true,
  });
  if (!dstLock.ok) {
    return {
      status: dstLock.status,
      headers: dstLock.headers,
      body: dstLock.body,
    };
  }
  if (op === 'MOVE') {
    // MOVE removes the source subtree — any locked internal member blocks
    // it (RFC 4918 §9.9). No-op for a document source (no descendants).
    const srcDescLock = await checkCollectionDescendantLocks(
      req,
      ctx,
      auth,
      parsed,
    );
    if (!srcDescLock.ok) {
      return {
        status: srcDescLock.status,
        headers: srcDescLock.headers,
        body: srcDescLock.body,
      };
    }
  }

  const src = await ctx.backend.query(anyRefs.webdav.tree_queries.resolvePath, {
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
    const mutationArgs =
      op === 'MOVE'
        ? {
            organizationId: auth.organizationId,
            src: srcArg,
            srcSegments: parsed.segments,
            destParentSegments,
            destName,
            overwrite,
            userId: auth.userId,
          }
        : {
            organizationId: auth.organizationId,
            src: srcArg,
            destParentSegments,
            destName,
            overwrite,
            userId: auth.userId,
          };
    const result = await ctx.backend.mutation(
      op === 'MOVE'
        ? anyRefs.webdav.tree_mutations.moveResource
        : anyRefs.webdav.tree_mutations.copyResource,
      mutationArgs,
    );

    // The source path no longer exists after a MOVE — drop its lock
    // row(s) and any under it so a stale lock can't 423 a later recreate
    // (RFC 4918 §9.9: MOVE relocates the resource and its locks don't
    // follow in v1). COPY leaves the source intact, so nothing to clean.
    if (op === 'MOVE') {
      await ctx.backend
        .mutation(anyRefs.webdav.lock_mutations.deleteLocksUnderPath, {
          organizationId: auth.organizationId,
          resourcePath: lockKeyFromParsed(parsed),
        })
        .catch((err: unknown) =>
          console.warn('[webdav] MOVE lock cleanup failed', err),
        );
    }

    const headers: Record<string, string> = {};
    if (result.created) {
      headers['Location'] = buildDavPath({
        orgSlug: auth.orgSlug,
        namespace: destParsed.namespace,
        segments: destParsed.segments,
        isCollection: src.kind === 'folder',
      });
    }
    return {
      status: result.created ? 201 : 204,
      headers,
      body: null,
    };
  } catch (err) {
    const code = backendErrorCode(err);
    if (code === 'LEGAL_HOLD_ACTIVE') {
      // Overwrite trashed a held destination (MOVE/COPY over an existing
      // doc/folder) — refuse. 403, not 423: 423 implies a retriable WebDAV
      // lock token, but a legal hold is not client-clearable.
      return {
        status: 403,
        headers: {},
        body: 'Destination is under legal hold',
      };
    }
    if (code === 'DOCUMENT_RECORD_PROTECTED') {
      // Overwrite would trash a controlled record in review/approved state —
      // refuse like the legal hold (not client-clearable).
      return {
        status: 403,
        headers: {},
        body: 'Destination is a protected controlled record',
      };
    }
    if (code === 'DEST_EXISTS') {
      // Destination exists and Overwrite: F (RFC 4918 §9.8.5/§9.9.4).
      return {
        status: 412,
        headers: {},
        body: 'Destination exists (Overwrite: F)',
      };
    }
    if (code === 'SELF_DESTINATION') {
      // Source and destination are the same resource — not retriable.
      return {
        status: 403,
        headers: {},
        body: 'Source and destination are the same',
      };
    }
    if (code === 'DEST_IS_DESCENDANT') {
      // A collection moved/copied into its own subtree (RFC §9.9.4).
      return {
        status: 403,
        headers: {},
        body: 'Cannot move or copy a collection into itself',
      };
    }
    if (code === 'DEST_PARENT_MISSING') {
      // Intermediate collection absent; the server does not auto-vivify.
      return {
        status: 409,
        headers: {},
        body: 'Destination parent collection does not exist',
      };
    }
    if (code === 'CONFLICT') {
      // Residual conflict (e.g. folder depth cap).
      return { status: 409, headers: {}, body: 'Conflict' };
    }
    if (code === 'NOT_FOUND') {
      return { status: 404, headers: {}, body: 'Not found' };
    }
    if (code === 'SUBTREE_TOO_LARGE') {
      // The source subtree exceeds what one transaction can copy/move-fixup
      // safely — 507 rather than a partial, inconsistent tree.
      return {
        status: 507,
        headers: {},
        body: 'Folder is too large to move or copy in a single request',
      };
    }
    console.error(`[webdav] ${op} failed`, err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }
}

function validateDepth(
  raw: string | null,
  op: 'MOVE' | 'COPY',
): WebDAVResponse | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  if (op === 'MOVE') {
    // RFC 4918 §9.9.3: MOVE is always Depth: infinity. We accept
    // absent or explicit infinity; anything else is malformed.
    if (v === 'infinity') return null;
    return { status: 400, headers: {}, body: 'Invalid Depth for MOVE' };
  }
  // COPY
  if (v === '0' || v === 'infinity') return null;
  return { status: 400, headers: {}, body: 'Invalid Depth for COPY' };
}

function hostOf(req: WebDAVRequest): string | null {
  const fromHeader = req.headers.get('host');
  if (fromHeader) return fromHeader;
  try {
    return new URL(req.url).host;
  } catch {
    return null;
  }
}
