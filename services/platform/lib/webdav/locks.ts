import { anyApi } from 'convex/server';

import { lockKeyFromParsed } from './paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
} from './types';
import { parseIfHeaderTokens } from './xml/lock-request';

export type LockCheckResult =
  | { ok: true }
  | { ok: false; status: 423 | 412; reason: string };

// Per RFC 4918 §9.10: writes on a locked resource need a matching If:
// header with the lock token. We accept any token in the If list as
// proof — the wire format is "(<opaquelocktoken:UUID>)".
export async function checkResourceLock(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<LockCheckResult> {
  const lockKey = lockKeyFromParsed(parsed);
  const found = await ctx.convex.query(
    anyApi.webdav.lock_queries.findLockForPath,
    { organizationId: auth.organizationId, resourcePath: lockKey },
  );

  if (found?.expiredId) {
    // Fire-and-forget eviction. Lazy cleanup pattern — don't await.
    void ctx.convex
      .mutation(anyApi.webdav.lock_mutations.deleteLockIfStale, {
        id: found.expiredId,
      })
      .catch((err) => {
        console.warn('[webdav] lazy lock evict failed', err);
      });
  }

  if (!found?.lock) return { ok: true };

  const provided = parseIfHeaderTokens(req.headers.get('if'));
  if (provided.length === 0) {
    return { ok: false, status: 423, reason: 'Resource locked' };
  }
  if (!provided.includes(found.lock.lockToken)) {
    return { ok: false, status: 412, reason: 'Lock token mismatch' };
  }
  return { ok: true };
}
