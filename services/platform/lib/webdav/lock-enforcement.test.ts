// Lock ENFORCEMENT coverage. The main handler suite stubs findLockForPath
// to always return { lock: null }, so runLockCheck's 423 / 412 / token-match
// / depth-infinity-ancestor branches (locks.ts) never executed. These tests
// feed a HELD lock and assert each branch via DELETE (a non-streamed method
// that goes through checkResourceLock).

import { describe, expect, it } from 'vitest';

import { dispatch } from './handler';
import {
  TEST_USER_ID,
  makeRequest,
  makeStubCtx,
  setupHmacEnv,
} from './test-helpers';

setupHmacEnv();

const LOCK_TOKEN = 'abc-123-token';

function heldLock(overrides: Record<string, unknown> = {}) {
  return {
    lock: {
      lockToken: LOCK_TOKEN,
      ownerUserId: TEST_USER_ID,
      ownerXml: '',
      depth: '0',
      scope: 'exclusive',
      expiresAt: Date.now() + 600_000,
      ...overrides,
    },
    expiredId: null,
  };
}

// Read `resourcePath` off a stub's args without a type assertion.
function resourcePathOf(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  if (!('resourcePath' in args)) return null;
  const rp: unknown = args.resourcePath;
  return typeof rp === 'string' ? rp : null;
}

function lockAt(path: string, overrides: Record<string, unknown> = {}) {
  return (args: unknown) =>
    resourcePathOf(args) === path ? heldLock(overrides) : { lock: null };
}

const docResolve = {
  'webdav/tree_queries:resolvePath': () => ({
    exists: true,
    kind: 'document',
    documentId: 'doc_1',
  }),
};
const docMutations = { 'webdav/tree_mutations:softDeleteDocument': () => null };

describe('WebDAV lock enforcement (locks.ts runLockCheck)', () => {
  it('DELETE on a locked resource without an If header → 423', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/locked.txt'),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/locked.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });

  it('DELETE with a non-matching lock token → 412', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/locked.txt'),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/locked.txt',
        authenticated: true,
        headers: { if: '(<opaquelocktoken:wrong-token>)' },
      }),
      ctx,
    );
    expect(res.status).toBe(412);
  });

  it('DELETE with the matching lock token proceeds → 204', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/locked.txt'),
        ...docResolve,
      },
      mutations: docMutations,
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/locked.txt',
        authenticated: true,
        headers: { if: `(<opaquelocktoken:${LOCK_TOKEN}>)` },
      }),
      ctx,
    );
    expect(res.status).toBe(204);
  });

  it('a depth-infinity lock on an ANCESTOR blocks a child DELETE without the token → 423', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/folder', {
          depth: 'infinity',
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/folder/child.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });

  it('a depth-0 lock on the DIRECT PARENT blocks a child DELETE (RFC §9.10.4) → 423', async () => {
    // DELETE removes child.txt from /documents/folder, mutating the parent's
    // member set — a depth-0 lock on that parent must block it.
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/folder', {
          depth: '0',
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/folder/child.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });

  it('a depth-0 lock on a GRANDPARENT does NOT block a child DELETE → 204', async () => {
    // /documents is the grandparent of child.txt; a depth-0 lock there governs
    // only /documents' own membership, not a nested descendant.
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents', {
          depth: '0',
        }),
        ...docResolve,
      },
      mutations: docMutations,
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/folder/child.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(204);
  });
});

// Lock-null name reservation (RFC 4918 §7.3 / §6.4): a LOCK on an unmapped URL
// must be honored by a later create at that EXACT path. These guard the fix
// that made PUT/MKCOL run the leaf lock check on the create path (previously
// gated on resolved.exists, so the reservation was silently ignored).
describe('WebDAV lock-null reservation enforcement', () => {
  it('MKCOL over an exact-path lock without the token → 423', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/reserved'),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/documents/reserved',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });

  it('PUT (creating a new resource) over an exact-path lock without the token → 423', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/reserved'),
        // lock-null: the resource does not exist as a row yet.
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/documents/reserved',
        authenticated: true,
        headers: { 'content-length': '3' },
        body: 'abc',
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });
});

// COPY must NOT require the source lock token (RFC 4918 §9.8.5) — it does not
// modify the source. Only the destination lock matters. Guards the fix that
// made the source-lock check MOVE-only.
describe('WebDAV COPY source-lock relaxation', () => {
  it('COPY with a locked SOURCE but unlocked destination proceeds', async () => {
    const ctx = makeStubCtx({
      queries: {
        // Source is locked; destination /documents/dst is not.
        'webdav/lock_queries:findLockForPath': lockAt('/documents/src'),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document',
          documentId: 'doc_1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:copyResource': () => ({ created: true }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'COPY',
        pathname: '/dav/myorg/documents/src',
        authenticated: true,
        headers: { destination: '/dav/myorg/documents/dst' },
      }),
      ctx,
    );
    // Old behavior 423 (blocked on source lock); fixed behavior 201.
    expect(res.status).toBe(201);
  });
});

// If: header conditions within a List are AND-ed (RFC 4918 §10.4.3) and `[etag]`
// terms are evaluated against the resource ETag (§10.4.4). Guards the fix where
// a correct lock token plus a NON-matching [etag] used to wrongly satisfy the
// lock (the etag was ignored).
describe('WebDAV If: header ETag/AND evaluation', () => {
  it('PUT overwrite with matching token but NON-matching [etag] → 412', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/locked.txt'),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document',
          documentId: 'doc_1',
        }),
        // computeETag(contentHash) => "real-hash"
        'webdav/tree_queries:getDocumentProps': () => ({
          contentHash: 'real-hash',
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/documents/locked.txt',
        authenticated: true,
        headers: {
          'content-length': '3',
          if: `(<opaquelocktoken:${LOCK_TOKEN}> ["wrong-hash"])`,
        },
        body: 'abc',
      }),
      ctx,
    );
    // Token matches but the AND-ed etag does not → precondition failed.
    expect(res.status).toBe(412);
  });

  it('MOVE into a collection whose parent holds a depth-0 lock → 423 (destination membership, F07)', async () => {
    const ctx = makeStubCtx({
      queries: {
        // The destination's DIRECT parent is locked Depth 0. A MOVE adds a new
        // member there, so the write must be blocked without the lock token.
        'webdav/lock_queries:findLockForPath': lockAt(
          '/documents/lockedfolder',
          {
            depth: '0',
          },
        ),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/lockedfolder/bar.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });

  it('COPY into a collection whose parent holds a depth-0 lock → 423', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt(
          '/documents/lockedfolder',
          {
            depth: '0',
          },
        ),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'COPY',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/lockedfolder/bar.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
  });
});
