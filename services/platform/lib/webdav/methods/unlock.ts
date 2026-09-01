import { anyRefs } from '../../shared/handlers/function-refs';
import { backendErrorCode } from '../errors';
import { lockKeyFromParsed, parseDavPath } from '../paths';
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

  // Parse the request path so we can pass the canonical resourcePath
  // to the mutation. Lets the mutation enforce "token applies to this
  // URL" — surfaces wrong-URL UNLOCK attempts as 409 instead of 204.
  let resourcePath: string | undefined;
  const parsed = parseDavPath(new URL(req.url, 'http://placeholder').pathname);
  if (parsed) {
    resourcePath = lockKeyFromParsed(parsed);
  }

  try {
    await ctx.backend.mutation(anyRefs.webdav.lock_mutations.releaseLock, {
      lockToken: token,
      ownerUserId: auth.userId,
      organizationId: auth.organizationId,
      resourcePath,
    });
  } catch (err) {
    const code = backendErrorCode(err);
    if (code === 'FORBIDDEN') {
      return {
        status: 403,
        headers: {},
        body: 'Lock owned by another user',
      };
    }
    if (code === 'NOT_FOUND') {
      // RFC 4918 §9.11.1: unknown token → 409 Conflict, not 204. The
      // wrong-URL case lands here too.
      return { status: 409, headers: {}, body: 'Lock token not found' };
    }
    console.error('[webdav] UNLOCK failed', err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }
  return { status: 204, headers: {}, body: null };
}
