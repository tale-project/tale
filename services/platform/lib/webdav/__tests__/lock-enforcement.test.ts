// Lock ENFORCEMENT coverage. The main handler suite stubs findLockForPath
// to always return { lock: null }, so runLockCheck's 423 / 412 / token-match
// / depth-infinity-ancestor branches (locks.ts) never executed. These tests
// feed a HELD lock and assert each branch via DELETE (a non-streamed method
// that goes through checkResourceLock).

import { describe, expect, it } from 'vitest';

import { dispatch } from '../handler';
import {
  TEST_USER_ID,
  makeRequest,
  makeStubCtx,
  setupHmacEnv,
} from './helpers';

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

  it('a depth-0 lock on an ancestor does NOT block a child DELETE', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': lockAt('/documents/folder', {
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
