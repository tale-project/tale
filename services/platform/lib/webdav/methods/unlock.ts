import { anyApi } from 'convex/server';

import { convexErrorCode } from '../errors';
import type {
  AuthContext,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';

export async function handleUnlock(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
): Promise<WebDAVResponse> {
  const tokenHeader = req.headers.get('lock-token');
  if (!tokenHeader) {
    return { status: 400, headers: {}, body: 'Missing Lock-Token header' };
  }
  // Wire form: "<opaquelocktoken:UUID>". Strip the wrapper.
  const m = tokenHeader.match(/<\s*opaquelocktoken:([^>]+)\s*>/);
  if (!m) {
    return { status: 400, headers: {}, body: 'Malformed Lock-Token header' };
  }
  const token = m[1].trim();

  try {
    await ctx.convex.mutation(anyApi.webdav.lock_mutations.releaseLock, {
      lockToken: token,
      ownerUserId: auth.userId,
    });
  } catch (err) {
    if (convexErrorCode(err) === 'FORBIDDEN') {
      return {
        status: 403,
        headers: {},
        body: 'Lock owned by another user',
      };
    }
    console.error('[webdav] UNLOCK failed', err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }
  return { status: 204, headers: {}, body: null };
}
