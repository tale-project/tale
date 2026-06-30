// Regression test for the Vite/dev Node adapter's request-body delivery.
//
// Bug it locks in: the adapter used to eagerly wrap EVERY body-bearing
// method's `req` in a Web stream (Readable.toWeb). The buffered methods
// (LOCK/PROPPATCH/PROPFIND/MKCOL) read their body via readBytes/readText,
// which drains the RAW `req` — but across the async dispatch gap the Web
// stream pulled the socket empty first, so those handlers saw an empty
// body. LOCK then mis-routed to its refresh branch and 400'd; in prod the
// fetch adapter (lazy Request.body) was unaffected — a dev-only break of
// Class 2 locking that Finder/Office need.
//
// These tests drive the REAL nodeAdapter over a REAL socket (the only way
// to reproduce the timing) and assert the body reaches the handler.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { nodeAdapter } from './adapters/node';
import {
  defaultBasicAuthHeader,
  makeStubCtx,
  setupHmacEnv,
} from './test-helpers';
import type { WebDAVCtx } from './types';

setupHmacEnv();

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let activeServer: http.Server | null = null;

afterEach(async () => {
  const server = activeServer;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    activeServer = null;
  }
});

function startServer(ctx: WebDAVCtx): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      void nodeAdapter(req, res, ctx);
    });
    activeServer = server;
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>' +
  '<D:locktype><D:write/></D:locktype><D:owner>tester</D:owner></D:lockinfo>';

describe('nodeAdapter request-body delivery', () => {
  it('delivers a LOCK lockinfo body to the handler (create path, not refresh)', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
      },
      mutations: {
        'webdav/lock_mutations:createLock': () => null,
      },
    });
    const port = await startServer(ctx);

    const res = await send(
      port,
      'LOCK',
      '/dav/myorg/documents/file.txt',
      {
        Authorization: defaultBasicAuthHeader(),
        'Content-Type': 'application/xml',
        Timeout: 'Second-120',
      },
      LOCK_BODY,
    );

    // Body reached the handler → fresh-lock create path. lock-null returns
    // 201 Created. The OLD adapter lost the body → 400 "Missing If: header
    // for refresh".
    expect(res.status).toBe(201);
    expect(res.headers['lock-token']).toMatch(/opaquelocktoken:/);
  });

  it('routes a genuinely empty LOCK body to the refresh branch (400)', async () => {
    // Control: proves the create-vs-refresh distinction is body-driven, so
    // the test above is meaningful (empty body really does 400).
    const ctx = makeStubCtx();
    const port = await startServer(ctx);

    const res = await send(port, 'LOCK', '/dav/myorg/documents/file.txt', {
      Authorization: defaultBasicAuthHeader(),
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatch(/refresh/i);
  });

  it('delivers a PROPPATCH body to the handler (207, not an empty-body fall-through)', async () => {
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({
          kind: 'document',
          exists: true,
          documentId: 'doc_1',
        }),
        'webdav/lock_queries:findLockForPath': () => null,
      },
    });
    const port = await startServer(ctx);

    const proppatch =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop>' +
      '<Z:author xmlns:Z="http://example.com/ns">tester</Z:author>' +
      '</D:prop></D:set></D:propertyupdate>';

    const res = await send(
      port,
      'PROPPATCH',
      '/dav/myorg/documents/file.txt',
      {
        Authorization: defaultBasicAuthHeader(),
        'Content-Type': 'application/xml',
      },
      proppatch,
    );

    // A parsed body yields a 207 Multi-Status naming the property. An empty
    // body (old bug) produces a different shape / 400.
    expect(res.status).toBe(207);
    expect(res.body).toContain('author');
  });
});
