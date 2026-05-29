import { anyApi } from 'convex/server';

import { checkResourceLock } from '../locks';
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

  const lockResult = await checkResourceLock(req, ctx, auth, parsed);
  if (!lockResult.ok) {
    return { status: lockResult.status, headers: {}, body: lockResult.reason };
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

  if (resolved.kind === 'document') {
    await ctx.convex.mutation(anyApi.webdav.tree_mutations.softDeleteDocument, {
      organizationId: auth.organizationId,
      documentId: resolved.documentId,
    });
  } else if (resolved.kind === 'folder') {
    await ctx.convex.mutation(
      anyApi.webdav.tree_mutations.deleteFolderCascade,
      {
        organizationId: auth.organizationId,
        folderId: resolved.folderId,
      },
    );
  }
  return { status: 204, headers: {}, body: null };
}
