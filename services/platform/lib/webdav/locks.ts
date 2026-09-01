import { anyRefs } from '../shared/handlers/function-refs';
import { lockKeyFromParsed } from './paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
} from './types';
import { buildDavError, DAV_ERROR_HEADERS } from './xml/error-body';
import { type IfHeaderClause, parseIfHeader } from './xml/lock-request';

type LockCheckResult =
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
// `directParentDepth0`: when the operation ADDS or REMOVES the leaf as a
// member of its parent collection (DELETE, MKCOL, a fresh PUT, MOVE of the
// source), a depth-0 lock on the DIRECT parent must also block it — RFC 4918
// §9.10.4/§7.4: a write lock on a collection (even Depth 0) governs its
// membership. Pure content overwrite of an existing member changes no
// membership, so callers leave this false there to avoid over-enforcing.
interface LockScanOpts {
  directParentDepth0?: boolean;
  // Current ETag of the Request-URI resource. Lets the If: header's `[etag]`
  // conditions be evaluated (RFC 4918 §10.4.4). Pass it for conditional writes
  // (PUT/PROPPATCH overwrite); when absent, `[etag]` conditions cannot be
  // verified and the containing List fails closed (a precondition we cannot
  // confirm is treated as unmet).
  resourceEtag?: string;
}

export async function checkResourceLock(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
  opts: LockScanOpts = {},
): Promise<LockCheckResult> {
  const candidates = enumerateLockPaths(parsed, opts);
  return await runLockCheck(req, ctx, auth, candidates, opts.resourceEtag);
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
  const raw: unknown = await ctx.backend.query(
    anyRefs.webdav.lock_queries.findLocksUnderPath,
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
    if (clauseSatisfiesLock(clauses, token)) continue;
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
  resourceEtag?: string,
): Promise<LockCheckResult> {
  const clauses = parseIfHeader(req.headers.get('if'));

  for (const { path, requireInfinity } of candidates) {
    const found = await ctx.backend.query(
      anyRefs.webdav.lock_queries.findLockForPath,
      { organizationId: auth.organizationId, resourcePath: path },
    );

    if (found?.expiredId) {
      // Fire-and-forget eviction. Lazy cleanup pattern — don't await.
      void ctx.backend
        .mutation(anyRefs.webdav.lock_mutations.deleteLockIfStale, {
          id: found.expiredId,
        })
        .catch((err) => {
          console.warn('[webdav] lazy lock evict failed', err);
        });
    }

    if (!found?.lock) continue;
    if (requireInfinity && found.lock.depth !== 'infinity') continue;

    if (clauseSatisfiesLock(clauses, found.lock.lockToken, resourceEtag)) {
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

  // RFC 4918 §10.4.2: the If: header is a general precondition evaluated even
  // when the resource is UNLOCKED — the lock loop above only enforces it
  // against a found lock. The lost-update case it protects is an `[etag]`
  // optimistic-concurrency condition on an unlocked file. We enforce that case
  // only when (a) the caller resolved the current ETag and (b) some List
  // carries an `[etag]` term: then the write proceeds only if at least one
  // List is satisfied by the current state. A pure lock-token If: on an
  // unlocked resource stays lenient (its lock has expired/released; failing it
  // would surprise clients that resubmit the token they last held), and
  // callers that don't resolve an ETag (PROPPATCH/MOVE/DELETE) are unaffected.
  if (
    resourceEtag !== undefined &&
    clauses.some((c) => c.conditions.some((cond) => cond.etag !== undefined))
  ) {
    const anySatisfied = clauses.some((clause) =>
      clause.conditions.every((cond) =>
        evalIfCondition(cond, '', resourceEtag),
      ),
    );
    if (!anySatisfied) {
      return {
        ok: false,
        status: 412,
        reason: 'If: precondition failed',
        body: buildDavError({ precondition: 'lock-token-submitted' }),
        headers: { ...DAV_ERROR_HEADERS },
      };
    }
  }

  return { ok: true };
}

// Does the If: header prove the client may write a resource locked with
// `expectedToken`? RFC 4918 §10.4.3: conditions within a List are AND-ed, and
// Lists are OR-ed; §9.10: the lock token must appear in a List that evaluates
// true. So a List grants access iff (a) EVERY one of its conditions holds AND
// (b) it contains a positive (non-Not) state-token equal to `expectedToken`.
//
// We don't require the List's resource tag to match — real clients (rclone,
// Office) send the No-tag-list form against the Request-URI. Conditions are
// evaluated against what we can observe: the lock token at this path
// (expectedToken) and, for `[etag]` terms, the Request-URI resource ETag.
//
// This fixes the prior token-only check, which let `(<correctToken> [wrongEtag])`
// wrongly satisfy the lock by ignoring the AND-ed (and non-matching) ETag.
function clauseSatisfiesLock(
  clauses: IfHeaderClause[],
  expectedToken: string,
  resourceEtag?: string,
): boolean {
  for (const clause of clauses) {
    let allTrue = true;
    let provesToken = false;
    for (const cond of clause.conditions) {
      if (!evalIfCondition(cond, expectedToken, resourceEtag)) {
        allTrue = false;
        break;
      }
      if (
        !cond.not &&
        cond.token !== undefined &&
        cond.token === expectedToken
      ) {
        provesToken = true;
      }
    }
    if (allTrue && provesToken) return true;
  }
  return false;
}

// Evaluate a single If: condition against the observable state. A positive
// state-token is true only when it equals the lock token at this path — we
// can't confirm an unrelated token is held, so such a List simply won't grant
// access (safe). A `[etag]` term is evaluated against the Request-URI ETag;
// when that ETag is unknown the term fails closed.
function evalIfCondition(
  cond: IfHeaderClause['conditions'][number],
  expectedToken: string,
  resourceEtag?: string,
): boolean {
  if (cond.token !== undefined) {
    const held = cond.token === expectedToken;
    return cond.not ? !held : held;
  }
  if (cond.etag !== undefined) {
    if (resourceEtag === undefined) return false;
    const match = etagMatches(resourceEtag, cond.etag);
    return cond.not ? !match : match;
  }
  return false;
}

// Compare an emitted ETag (e.g. `"hash"` or `W/"size-mtime"`) with an If:
// header entity-tag (already quote-stripped by the parser). Weak comparison
// per RFC 7232 §2.3.2: strip the optional `W/` and surrounding quotes from
// both, then compare the opaque value.
function etagMatches(resourceEtag: string, condEtag: string): boolean {
  const norm = (s: string) => s.replace(/^W\//, '').replace(/^"|"$/g, '');
  return norm(resourceEtag) === norm(condEtag);
}

// Build the lookup list for `checkResourceLock`. The leaf path comes
// first (any depth match wins), then each ancestor in walk order — for
// ancestors we only accept depth=infinity matches.
function enumerateLockPaths(
  parsed: ParsedPath,
  opts: LockScanOpts = {},
): { path: string; requireInfinity: boolean }[] {
  const out: { path: string; requireInfinity: boolean }[] = [];
  out.push({ path: lockKeyFromParsed(parsed), requireInfinity: false });
  for (const ancestor of enumerateAncestorPaths(parsed, opts)) {
    out.push(ancestor);
  }
  return out;
}

// Ancestor walk only — used by enumerateLockPaths to append ancestors after
// the leaf. Walks from the most-specific parent to /<namespace> root. By
// default every ancestor is honored only at depth=infinity; with
// `directParentDepth0` the immediate parent is also honored at depth 0
// (membership-changing ops — see LockScanOpts).
function enumerateAncestorPaths(
  parsed: Pick<ParsedPath, 'namespace' | 'segments'>,
  opts: LockScanOpts = {},
): { path: string; requireInfinity: boolean }[] {
  const out: { path: string; requireInfinity: boolean }[] = [];
  const directParentIdx = parsed.segments.length - 1;
  for (let i = parsed.segments.length - 1; i >= 0; i--) {
    const isDirectParent = i === directParentIdx;
    out.push({
      path: lockKeyFromParsed({
        namespace: parsed.namespace,
        segments: parsed.segments.slice(0, i),
      }),
      // Direct parent honors depth-0 locks for membership-changing ops; every
      // other ancestor matches only at depth=infinity.
      requireInfinity: !(opts.directParentDepth0 && isDirectParent),
    });
  }
  return out;
}
