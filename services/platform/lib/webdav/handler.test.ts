// Method-handler connector coverage for the WebDAV dispatcher.
//
// Each test feeds a hand-built WebDAVRequest through dispatch(...)
// against a stubbed Convex client. We assert on the WebDAVResponse
// shape (status / headers / body), parse XML bodies via fast-xml-parser
// instead of string-grepping, and intentionally do NOT exercise the
// Convex round-trip — that lives in convex-test against real schemas.

import { beforeAll, describe, expect, it } from 'vitest';

import { dispatch } from './handler';
import {
  bodyToText,
  ConvexError,
  makeRequest,
  makeStubCtx,
  setupHmacEnv,
  TEST_ORG_ID,
  xmlParser,
} from './test-helpers';

beforeAll(() => {
  setupHmacEnv();
});

describe('OPTIONS', () => {
  it('returns DAV class 1,2 + Allow listing all WebDAV methods', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({ method: 'OPTIONS', pathname: '/dav/myorg/documents/' }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers?.['DAV']).toBe('1, 2');
    expect(res.headers?.['MS-Author-Via']).toBe('DAV');
    const allow = res.headers?.['Allow'] ?? '';
    for (const m of [
      'OPTIONS',
      'GET',
      'HEAD',
      'PROPFIND',
      'PROPPATCH',
      'PUT',
      'DELETE',
      'MKCOL',
      'MOVE',
      'COPY',
      'LOCK',
      'UNLOCK',
    ]) {
      expect(allow).toContain(m);
    }
  });

  it('OPTIONS short-circuits without orgSlug — fixes D.3 (was 404)', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({ method: 'OPTIONS', pathname: '/dav' }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers?.['DAV']).toBe('1, 2');
  });

  it('OPTIONS works pre-auth (no Authorization header)', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({ method: 'OPTIONS', pathname: '/dav/myorg/documents/' }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('OPTIONS on a malformed-but-rooted path still returns capabilities', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({ method: 'OPTIONS', pathname: '/dav/myorg/unknown-ns/' }),
      ctx,
    );
    expect(res.status).toBe(200);
  });
});

describe('Authentication gate', () => {
  for (const method of [
    'PROPFIND',
    'PROPPATCH',
    'GET',
    'HEAD',
    'PUT',
    'DELETE',
    'MKCOL',
    'MOVE',
    'COPY',
    'LOCK',
    'UNLOCK',
  ]) {
    it(`${method} without Authorization → 401 + WWW-Authenticate Basic`, async () => {
      const ctx = makeStubCtx();
      const res = await dispatch(
        makeRequest({ method, pathname: '/dav/myorg/documents/foo.txt' }),
        ctx,
      );
      expect(res.status).toBe(401);
      expect(res.headers?.['WWW-Authenticate']).toMatch(/^Basic /);
    });
  }

  it('Unknown method → 405 + Allow header', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'TEAPOT',
        pathname: '/dav/myorg/documents/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(405);
    expect(res.headers?.['Allow']).toBeDefined();
  });

  it('Malformed path past /dav/ prefix → 404', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/..',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});

describe('PROPFIND', () => {
  const baseResolveRoot = {
    'webdav/tree_queries:resolvePath': () => ({
      exists: true,
      kind: 'root' as const,
    }),
    'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
  };

  it('Depth: 1 happy path emits one response per child + self', async () => {
    const ctx = makeStubCtx({
      queries: {
        ...baseResolveRoot,
        'webdav/tree_queries:listCollection': () => ({
          folders: [{ name: 'sub', creationTime: Date.now() }],
          documents: [
            {
              _id: 'doc1',
              title: 'file.txt',
              mimeType: 'text/plain',
              size: 12,
              creationTime: Date.now(),
              sourceModifiedAt: Date.now(),
              contentHash: 'sha256-abc',
            },
          ],
          truncated: false,
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        headers: { Depth: '1' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(207);
    expect(res.headers?.['Content-Type']).toContain('xml');
    const xml = await bodyToText(res.body);
    const parsed = xmlParser.parse(xml) as {
      multistatus: { response: unknown[] };
    };
    expect(parsed.multistatus).toBeDefined();
    // self + folder + doc = 3
    expect(parsed.multistatus.response.length).toBe(3);
  });

  it('Depth: infinity → 403 with <propfind-finite-depth/>', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        headers: { Depth: 'infinity' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
    const body = await bodyToText(res.body);
    expect(body).toContain('propfind-finite-depth');
  });

  it('<propname/> emits empty-element props (no values)', async () => {
    const ctx = makeStubCtx({
      queries: {
        ...baseResolveRoot,
        'webdav/tree_queries:listCollection': () => ({
          folders: [],
          documents: [],
          truncated: false,
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        headers: { Depth: '0' },
        authenticated: true,
        body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>`,
      }),
      ctx,
    );
    expect(res.status).toBe(207);
    const xml = await bodyToText(res.body);
    // propname mode: tag names must appear but with no inner text
    // (e.g. `<D:displayname/>` not `<D:displayname>foo</D:displayname>`).
    expect(xml).toContain('<D:displayname/>');
    expect(xml).not.toMatch(/<D:displayname>[^<]+<\/D:displayname>/);
  });

  it('<prop> with mixed known + unknown names → 200 + 404 propstat groups', async () => {
    const ctx = makeStubCtx({
      queries: {
        ...baseResolveRoot,
        'webdav/tree_queries:listCollection': () => ({
          folders: [],
          documents: [],
          truncated: false,
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        headers: { Depth: '0' },
        authenticated: true,
        body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/><D:nonexistent/></D:prop></D:propfind>`,
      }),
      ctx,
    );
    expect(res.status).toBe(207);
    const xml = await bodyToText(res.body);
    const parsed = xmlParser.parse(xml) as {
      multistatus: {
        response: { propstat: { status: string }[] }[];
      };
    };
    const propstats = parsed.multistatus.response[0].propstat;
    expect(propstats.length).toBe(2);
    const statuses = propstats.map((p) => p.status);
    expect(statuses.some((s) => s.includes('200'))).toBe(true);
    expect(statuses.some((s) => s.includes('404'))).toBe(true);
  });

  it('returns 404 when the path does not resolve', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/missing/',
        headers: { Depth: '0' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET', () => {
  it('missing path → 404', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/missing.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('GET on a collection → 405 + Allow', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'folder' as const,
          folderId: 'folder1',
          creationTime: Date.now(),
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/folder/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(405);
    expect(res.headers?.['Allow']).toContain('PROPFIND');
  });
});

describe('PUT', () => {
  it('PUT on .trash → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/.trash/foo.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('PUT on a collection (trailing slash) → 405 + Allow', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/documents/folder/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(405);
    expect(res.headers?.['Allow']).toContain('PROPFIND');
  });

  it('PUT on root → 405', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/documents/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(405);
  });
});

describe('MKCOL', () => {
  it('non-empty body → 415 (RFC §9.3.1, no extended MKCOL)', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/documents/new/',
        authenticated: true,
        body: '<some-xml/>',
      }),
      ctx,
    );
    expect(res.status).toBe(415);
  });

  it('on existing collection → 405', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
      },
      mutations: {
        'webdav/tree_mutations:mkcol': () => {
          throw new ConvexError({ code: 'METHOD_NOT_ALLOWED' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/documents/existing/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(405);
    expect(res.headers?.['Allow']).toBeDefined();
  });

  it('missing parent → 409', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
      },
      mutations: {
        'webdav/tree_mutations:mkcol': () => {
          throw new ConvexError({ code: 'CONFLICT' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/documents/missing-parent/child/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it('on root → 405', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/documents/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(405);
  });

  it('on .trash → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/.trash/new/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('success → 201', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
      },
      mutations: {
        'webdav/tree_mutations:mkcol': () => ({ folderId: 'newfolder' }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MKCOL',
        pathname: '/dav/myorg/documents/new/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
  });
});

describe('DELETE', () => {
  it('on root → 403 (cannot delete root)', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('on .trash → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/.trash/foo.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('on missing path → 404', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/missing.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('successful document delete → 204', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:softDeleteDocument': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(204);
  });

  it('successful folder cascade delete → 204', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'folder' as const,
          folderId: 'folder1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:deleteFolderCascade': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'DELETE',
        pathname: '/dav/myorg/documents/folder/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(204);
  });
});

describe('MOVE', () => {
  it('missing Destination → 400', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('cross-org Destination → 403 (B.2: was 502)', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: {
          Destination: '/dav/otherorg/documents/foo.txt',
        },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('Destination targeting .trash → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/.trash/foo.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('Destination targeting root → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('invalid Depth header → 400', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: {
          Destination: '/dav/myorg/documents/bar.txt',
          Depth: '0',
        },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('source not found → 404', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/missing.txt',
        headers: { Destination: '/dav/myorg/documents/bar.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('moving onto self currently maps to 409 — B.2 self-move 403 not yet shipped', async () => {
    // Convex mutation throws CONFLICT (same id collides at dest). The
    // handler maps CONFLICT → 409 unless overwrite=F. Plan item B.2
    // upgrades self-move to 403; once that ships this assertion flips
    // to 403 and the comment can go.
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:moveResource': () => {
          throw new ConvexError({ code: 'CONFLICT' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/foo.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it('successful MOVE with rename → 201 + Location', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:moveResource': () => ({ created: true }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/bar.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(res.headers?.['Location']).toBe('/dav/myorg/documents/bar.txt');
  });

  it('overwrite=F with collision → 412', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:moveResource': () => {
          // Overwrite:F + existing destination throws DEST_EXISTS, which the
          // handler maps to 412 (distinct from a missing-parent 409).
          throw new ConvexError({ code: 'DEST_EXISTS' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: {
          Destination: '/dav/myorg/documents/bar.txt',
          Overwrite: 'F',
        },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(412);
  });
});

describe('COPY', () => {
  it('same-org valid Destination → 201 + Location', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:copyResource': () => ({ created: true }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'COPY',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/copy.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(res.headers?.['Location']).toBe('/dav/myorg/documents/copy.txt');
  });

  it('COPY accepts Depth: 0', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:copyResource': () => ({ created: true }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'COPY',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: {
          Destination: '/dav/myorg/documents/copy.txt',
          Depth: '0',
        },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
  });

  it('COPY rejects invalid Depth → 400', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'COPY',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: {
          Destination: '/dav/myorg/documents/copy.txt',
          Depth: '1',
        },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('cross-org Destination → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'COPY',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/elsewhere/documents/copy.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });
});

describe('LOCK', () => {
  // A non-lockinfo body sends parseLockBody → null, which routes to the
  // refresh path; without an If: header the handler returns 400. Use
  // this shape as the "malformed lock request" probe.
  const NON_LOCKINFO_BODY =
    '<?xml version="1.0"?><D:notalock xmlns:D="DAV:"></D:notalock>';

  const VALID_LOCK_BODY = `<?xml version="1.0"?>
<D:lockinfo xmlns:D="DAV:">
  <D:lockscope><D:exclusive/></D:lockscope>
  <D:locktype><D:write/></D:locktype>
  <D:owner><D:href>mailto:test@example.com</D:href></D:owner>
</D:lockinfo>`;

  it('non-lockinfo body without If header → 400 (refresh path)', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
        body: NON_LOCKINFO_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('lock-null on non-existent path → 201 (B.8)', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
      mutations: {
        'webdav/lock_mutations:createLock': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/documents/new-file.txt',
        authenticated: true,
        body: VALID_LOCK_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(res.headers?.['Lock-Token']).toMatch(/^<opaquelocktoken:/);
  });

  it('lock on existing resource → 200 with token', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/lock_mutations:createLock': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
        body: VALID_LOCK_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers?.['Lock-Token']).toMatch(/^<opaquelocktoken:/);
  });

  it('conflicting lock → 423', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/lock_mutations:createLock': () => {
          throw new ConvexError({ code: 'LOCKED' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
        body: VALID_LOCK_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(423);
    const body = await bodyToText(res.body);
    expect(body).toContain('no-conflicting-lock');
  });

  it('invalid Depth → 400', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
        headers: { Depth: '1' },
        body: VALID_LOCK_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('LOCK on root → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/documents/',
        authenticated: true,
        body: VALID_LOCK_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('LOCK on .trash → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'LOCK',
        pathname: '/dav/myorg/.trash/foo.txt',
        authenticated: true,
        body: VALID_LOCK_BODY,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });
});

describe('UNLOCK', () => {
  it('no Lock-Token header → 400', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'UNLOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('malformed Lock-Token → 400', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'UNLOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { 'Lock-Token': 'not-an-opaque-token' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('unknown token → 409 (B.6: was 204)', async () => {
    const ctx = makeStubCtx({
      mutations: {
        'webdav/lock_mutations:releaseLock': () => {
          throw new ConvexError({ code: 'NOT_FOUND' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'UNLOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { 'Lock-Token': '<opaquelocktoken:unknown-uuid>' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it('foreign-owned token → 403', async () => {
    const ctx = makeStubCtx({
      mutations: {
        'webdav/lock_mutations:releaseLock': () => {
          throw new ConvexError({ code: 'FORBIDDEN' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'UNLOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { 'Lock-Token': '<opaquelocktoken:abc-123>' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('successful release → 204', async () => {
    const ctx = makeStubCtx({
      mutations: {
        'webdav/lock_mutations:releaseLock': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'UNLOCK',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { 'Lock-Token': '<opaquelocktoken:abc-123>' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(204);
  });
});

describe('PROPPATCH', () => {
  it('on .trash → 403', async () => {
    const ctx = makeStubCtx();
    const res = await dispatch(
      makeRequest({
        method: 'PROPPATCH',
        pathname: '/dav/myorg/.trash/foo.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('missing path → 404', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPPATCH',
        pathname: '/dav/myorg/documents/missing.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('setting a live property → 207 with 403 propstat', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPPATCH',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
        body: `<?xml version="1.0"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set><D:prop><D:getetag/></D:prop></D:set>
</D:propertyupdate>`,
      }),
      ctx,
    );
    expect(res.status).toBe(207);
    const body = await bodyToText(res.body);
    expect(body).toContain('cannot-modify-protected-property');
    expect(body).toContain('403 Forbidden');
  });

  it('setting a dead property → 207 with 200 propstat (lying-200)', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPPATCH',
        pathname: '/dav/myorg/documents/foo.txt',
        authenticated: true,
        body: `<?xml version="1.0"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:example">
  <D:set><D:prop><Z:hidden/></D:prop></D:set>
</D:propertyupdate>`,
      }),
      ctx,
    );
    expect(res.status).toBe(207);
    const body = await bodyToText(res.body);
    expect(body).toContain('200 OK');
  });
});

describe('Cross-org auth boundary', () => {
  it('Basic auth against an unknown org → 401', async () => {
    const ctx = makeStubCtx({
      queries: {
        // Override the default: pretend no org exists with the slug
        // the caller submitted, regardless of userId.
        'webdav/org_queries:resolveOrgAndCheckMembership': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/unknownorg/documents/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('Valid org + invalid password → 401', async () => {
    const ctx = makeStubCtx({
      queries: {
        // Empty candidate list mimics "no prefix match" — any password
        // not matching our seeded credential lands here.
        'webdav/app_password_queries:findCandidatesByPrefix': () => [],
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        headers: {
          authorization: 'Basic ' + btoa('user:wrong-password'),
        },
      }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('Authenticated user not a member of org → 403', async () => {
    // Custom resolver: orgSlug lookup succeeds for empty-userId probe
    // (so we get past the candidate fetch) but fails for the
    // post-match membership probe.
    const ctx = makeStubCtx({
      queries: {
        'webdav/org_queries:resolveOrgAndCheckMembership': (args) => {
          const a = args as { orgSlug: string; userId: string };
          if (a.userId === '') return { organizationId: TEST_ORG_ID };
          return null;
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });
});

describe('conditional preconditions + conflict mapping (F17 / F19 / F62)', () => {
  it('PUT If-None-Match: * on an existing resource → 412 (create-only guard)', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { 'If-None-Match': '*' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(412);
  });

  it('MOVE to a missing destination parent → 409 (not a misleading 412)', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:moveResource': () => {
          throw new ConvexError({ code: 'DEST_PARENT_MISSING' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/missing/bar.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it('MOVE onto itself → 403', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
      },
      mutations: {
        'webdav/tree_mutations:moveResource': () => {
          throw new ConvexError({ code: 'SELF_DESTINATION' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'MOVE',
        pathname: '/dav/myorg/documents/foo.txt',
        headers: { Destination: '/dav/myorg/documents/foo.txt' },
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('failed auth that exhausts the throttle → 403 (rate limited)', async () => {
    const ctx = makeStubCtx({
      mutations: {
        'webdav/app_password_queries:chargeWebdavAuthFailure': () => {
          throw new ConvexError({ code: 'RATE_LIMITED' });
        },
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'PROPFIND',
        pathname: '/dav/myorg/documents/',
        headers: {
          Authorization: `Basic ${btoa('webdav-user:totally-wrong')}`,
          Depth: '0',
        },
      }),
      ctx,
    );
    expect(res.status).toBe(403);
  });
});
