import { anyApi } from 'convex/server';

import { backendErrorCode } from '../errors';
import { checkCollectionDescendantLocks, checkResourceLock } from '../locks';
import { lockKeyFromParsed } from '../paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';

export async function handleDelete(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }
  if (parsed.segments.length === 0) {
    return { status: 403, headers: {}, body: 'Cannot delete the root' };
  }

  // DELETE removes the leaf from its parent collection, so a depth-0 lock on
  // the direct parent must also block it (RFC 4918 §9.10.4).
  const lockResult = await checkResourceLock(req, ctx, auth, parsed, {
    directParentDepth0: true,
  });
  if (!lockResult.ok) {
    return {
      status: lockResult.status,
      headers: lockResult.headers,
      body: lockResult.body,
    };
  }

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

  try {
    if (resolved.kind === 'document') {
      await ctx.convex.mutation(
        anyApi.webdav.tree_mutations.softDeleteDocument,
        {
          organizationId: auth.organizationId,
          documentId: resolved.documentId,
        },
      );
    } else if (resolved.kind === 'folder') {
      // RFC 4918 §9.6.1: deleting a collection must fail if any internal
      // member is locked without the token. checkResourceLock above only
      // covered the collection + ancestors.
      const descendantLock = await checkCollectionDescendantLocks(
        req,
        ctx,
        auth,
        parsed,
      );
      if (!descendantLock.ok) {
        return {
          status: descendantLock.status,
          headers: descendantLock.headers,
          body: descendantLock.body,
        };
      }
      await ctx.convex.mutation(
        anyApi.webdav.tree_mutations.deleteFolderCascade,
        {
          organizationId: auth.organizationId,
          folderId: resolved.folderId,
        },
      );
    }
  } catch (err) {
    const code = backendErrorCode(err);
    if (code === 'LEGAL_HOLD_ACTIVE') {
      // The org or a descendant doc's author is on a legal hold — refuse.
      // 403, not 423 (a legal hold is not a client-clearable WebDAV lock).
      return { status: 403, headers: {}, body: 'Resource is under legal hold' };
    }
    if (code === 'DOCUMENT_RECORD_PROTECTED') {
      // A controlled record in review/approved state (here or in the
      // subtree) — resolve the review or open a revision first. 403 like
      // the legal hold: not a client-clearable WebDAV lock.
      return {
        status: 403,
        headers: {},
        body: 'Resource is a protected controlled record',
      };
    }
    if (code === 'SUBTREE_TOO_LARGE') {
      // The folder subtree exceeds what one transaction can delete safely.
      // 507 rather than crash mid-cascade (which could half-trash the tree).
      return {
        status: 507,
        headers: {},
        body: 'Folder is too large to delete in a single request',
      };
    }
    throw err;
  }

  // Removing a resource removes its locks (RFC 4918 §9.6.1) — drop the
  // lock row(s) for this path and any descendants so a stale lock can't
  // 423 a later recreate of the same name.
  await ctx.convex
    .mutation(anyApi.webdav.lock_mutations.deleteLocksUnderPath, {
      organizationId: auth.organizationId,
      resourcePath: lockKeyFromParsed(parsed),
    })
    .catch((err: unknown) =>
      console.warn('[webdav] DELETE lock cleanup failed', err),
    );

  return { status: 204, headers: {}, body: null };
}
