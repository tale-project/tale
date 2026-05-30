import { anyApi } from 'convex/server';

import { lockKeyFromParsed } from './paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
} from './types';
import { buildDavError, DAV_ERROR_HEADERS } from './xml/error-body';
import { type IfHeaderClause, parseIfHeader } from './xml/lock-request';

export type LockCheckResult =
  | { ok: true }
  | {
      ok: false;
      status: 423 | 412;
      reason: string;
      body: string;
      headers: Record<string, string>;
    };

// Per RFC 4918 §9.10: writes on a locked resource need a matching If:
// header with the lock token. We walk ancestor paths so a depth=infinity
// lock on /documents/foo correctly enforces against
// /documents/foo/bar/baz.txt. The exact-path lock at the leaf wins over
// ancestor inheritance (an inner shared/exclusive lock is its own
// authority); ancestor-only matches are honored only when depth=infinity.
export async function checkResourceLock(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<LockCheckResult> {
  const candidates = enumerateLockPaths(parsed);
  return await runLockCheck(req, ctx, auth, candidates);
}

// Used by MKCOL, MOVE source, MOVE dest, COPY dest. Skips the leaf path
// (creating-/non-existing-resource case) and only inspects ancestors —
// where a depth=infinity lock would propagate to a child write. The
// leaf's own lock doesn't apply: we're locking something that doesn't
// exist yet, or the operation explicitly targets the parent.
export async function checkResourceLockOnParents(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: Pick<ParsedPath, 'namespace' | 'segments'>,
): Promise<LockCheckResult> {
  const parents = enumerateAncestorPaths(parsed);
  return await runLockCheck(req, ctx, auth, parents);
}

// RFC 4918 §9.6.1 / §9.9: DELETE/MOVE of a COLLECTION must fail with 423
// if any internal member holds a lock the request doesn't satisfy. The
// per-resource checkResourceLock only inspects the target + ancestors,
// never descendants — this prefix-scans the subtree and 423s on the first
// member lock whose token wasn't submitted in the If: header.
export async function checkCollectionDescendantLocks(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: Pick<ParsedPath, 'namespace' | 'segments'>,
): Promise<LockCheckResult> {
  const clauses = parseIfHeader(req.headers.get('if'));
  const raw: unknown = await ctx.convex.query(
    anyApi.webdav.lock_queries.findLocksUnderPath,
    {
      organizationId: auth.organizationId,
      resourcePath: lockKeyFromParsed(parsed),
    },
  );
  // Narrow each entry via `in` checks (no type assertions) — the query
  // result crosses the ConvexHttpClient boundary as `unknown`.
  const entries: unknown[] = Array.isArray(raw) ? raw : [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (!('lockToken' in entry)) continue;
    const token: unknown = entry.lockToken;
    if (typeof token !== 'string') continue;
    const rp: unknown =
      'resourcePath' in entry ? entry.resourcePath : undefined;
    const resourcePath =
      typeof rp === 'string' ? rp : lockKeyFromParsed(parsed);
    if (clauseSatisfiesToken(clauses, token)) continue;
    // A member is locked and its token wasn't submitted.
    return {
      ok: false,
      status: 423,
      reason: 'A member resource is locked',
      body: buildDavError({
        precondition: 'lock-token-submitted',
        hrefs: [resourcePath],
      }),
      headers: { ...DAV_ERROR_HEADERS },
    };
  }
  return { ok: true };
}

async function runLockCheck(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  candidates: { path: string; requireInfinity: boolean }[],
): Promise<LockCheckResult> {
  const clauses = parseIfHeader(req.headers.get('if'));

  for (const { path, requireInfinity } of candidates) {
    const found = await ctx.convex.query(
      anyApi.webdav.lock_queries.findLockForPath,
      { organizationId: auth.organizationId, resourcePath: path },
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

    if (!found?.lock) continue;
    if (requireInfinity && found.lock.depth !== 'infinity') continue;

    if (clauseSatisfiesToken(clauses, found.lock.lockToken)) {
      return { ok: true };
    }
    if (clauses.length === 0) {
      const lockedHref = path;
      return {
        ok: false,
        status: 423,
        reason: 'Resource locked',
        body: buildDavError({
          precondition: 'lock-token-submitted',
          hrefs: [lockedHref],
        }),
        headers: { ...DAV_ERROR_HEADERS },
      };
    }
    return {
      ok: false,
      status: 412,
      reason: 'Lock token mismatch',
      body: buildDavError({ precondition: 'lock-token-submitted' }),
      headers: { ...DAV_ERROR_HEADERS },
    };
  }

  return { ok: true };
}

// True when at least one clause contains an unnegated condition whose
// token matches. We don't require the clause's resource tag to match —
// real clients (rclone, Office) regularly send No-tag-list form. ETag
// conditions in the same clause are not validated here (TODO: feed in
// the resource's ETag and compare); for v1, we treat unconstrained
// token presence as proof of lock ownership.
function clauseSatisfiesToken(
  clauses: IfHeaderClause[],
  expectedToken: string,
): boolean {
  for (const clause of clauses) {
    for (const cond of clause.conditions) {
      if (cond.not) continue;
      if (cond.token && cond.token === expectedToken) return true;
    }
  }
  return false;
}

// Build the lookup list for `checkResourceLock`. The leaf path comes
// first (any depth match wins), then each ancestor in walk order — for
// ancestors we only accept depth=infinity matches.
function enumerateLockPaths(
  parsed: ParsedPath,
): { path: string; requireInfinity: boolean }[] {
  const out: { path: string; requireInfinity: boolean }[] = [];
  out.push({ path: lockKeyFromParsed(parsed), requireInfinity: false });
  for (const ancestor of enumerateAncestorPaths(parsed)) {
    out.push(ancestor);
  }
  return out;
}

// Ancestor walk only — used by checkResourceLockOnParents. Walks from
// the most-specific parent to /<namespace> root.
function enumerateAncestorPaths(
  parsed: Pick<ParsedPath, 'namespace' | 'segments'>,
): { path: string; requireInfinity: boolean }[] {
  const out: { path: string; requireInfinity: boolean }[] = [];
  for (let i = parsed.segments.length - 1; i >= 0; i--) {
    out.push({
      path: lockKeyFromParsed({
        namespace: parsed.namespace,
        segments: parsed.segments.slice(0, i),
      }),
      requireInfinity: true,
    });
  }
  return out;
}
