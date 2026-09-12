// The HTTP preconditions on PUT (RFC 9110 §13.1), now read through the
// shared `@tale/shared/http/entity-tag` parser rather than a comma split of
// this door's own: `If-None-Match: *` as the create-only guard, `If-Match`
// as the optimistic-concurrency overwrite — compared WEAKLY on purpose,
// because a document that arrived through this door carries a weak
// validator (no content hash) and a sync client echoes the tag PROPFIND
// gave it. A failed precondition is 412 and nothing is uploaded.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dispatch } from './handler';
import { makeRequest, makeStubCtx, setupHmacEnv } from './test-helpers';

beforeAll(() => {
  setupHmacEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A stored document (`exists`) with the given props, no lock held, and an
 * upload lane that accepts whatever reaches it — so a PUT that passes its
 * preconditions ends in the overwrite's 204, and one that does not never
 * asks for an upload target. */
function ctxWith(props: object | null, exists = true) {
  const upload = vi.fn(() => ({
    url: 'http://127.0.0.1:1/upload',
    method: 'PUT',
    s3Ref: 's3:acme/blob',
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
  );
  const ctx = makeStubCtx({
    queries: {
      'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
      'webdav/tree_queries:resolvePath': () =>
        exists
          ? { exists: true, kind: 'document', documentId: 'doc_1' }
          : { exists: false },
      'webdav/tree_queries:getDocumentProps': () => props,
    },
    mutations: {
      'webdav/tree_mutations:ingestPutBlob': () => ({ created: !exists }),
    },
    actions: { 'files/blob_actions:generateWebdavBlobUpload': upload },
  });
  return { ctx, upload };
}

function put(headers: Record<string, string>) {
  return makeRequest({
    method: 'PUT',
    pathname: '/dav/myorg/documents/report.txt',
    authenticated: true,
    headers: { 'content-length': '3', ...headers },
    body: 'abc',
  });
}

describe('PUT If-None-Match', () => {
  it('`*` refuses an overwrite of an existing document with 412, nothing uploaded', async () => {
    const { ctx, upload } = ctxWith({ contentHash: 'abc' });
    const res = await dispatch(put({ 'if-none-match': '*' }), ctx);
    expect(res.status).toBe(412);
    expect(upload).not.toHaveBeenCalled();
  });

  it('`*` lets a fresh document through (201)', async () => {
    const { ctx, upload } = ctxWith(null, false);
    const res = await dispatch(put({ 'if-none-match': '*' }), ctx);
    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a list naming the current tag — weakly, quoted or not — is 412; a foreign tag proceeds', async () => {
    expect(
      (
        await dispatch(
          put({ 'if-none-match': '"other", W/"abc"' }),
          ctxWith({ contentHash: 'abc' }).ctx,
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await dispatch(
          put({ 'if-none-match': '"other"' }),
          ctxWith({ contentHash: 'abc' }).ctx,
        )
      ).status,
    ).toBe(204);
  });

  it('a malformed list matches nothing, so the write proceeds', async () => {
    const res = await dispatch(
      put({ 'if-none-match': 'abc' }),
      ctxWith({ contentHash: 'abc' }).ctx,
    );
    expect(res.status).toBe(204);
  });
});

describe('PUT If-Match', () => {
  it('holds for the current tag, strong or weak — the weak validator PROPFIND hands a sync client included', async () => {
    expect(
      (
        await dispatch(
          put({ 'if-match': '"abc"' }),
          ctxWith({ contentHash: 'abc' }).ctx,
        )
      ).status,
    ).toBe(204);
    // No content hash: the door issues W/"size-mtime", and the client
    // echoes exactly that.
    expect(
      (
        await dispatch(
          put({ 'if-match': 'W/"10-5"' }),
          ctxWith({ size: 10, sourceModifiedAt: 5 }).ctx,
        )
      ).status,
    ).toBe(204);
  });

  it('refuses a stale tag with 412 and uploads nothing', async () => {
    const { ctx, upload } = ctxWith({ contentHash: 'abc' });
    const res = await dispatch(put({ 'if-match': '"stale"' }), ctx);
    expect(res.status).toBe(412);
    expect(upload).not.toHaveBeenCalled();
  });

  it('`*` holds when the document exists and fails when it does not', async () => {
    expect(
      (
        await dispatch(
          put({ 'if-match': '*' }),
          ctxWith({ contentHash: 'abc' }).ctx,
        )
      ).status,
    ).toBe(204);
    expect(
      (await dispatch(put({ 'if-match': '*' }), ctxWith(null, false).ctx))
        .status,
    ).toBe(412);
  });

  it('a malformed list fails closed', async () => {
    const res = await dispatch(
      put({ 'if-match': 'abc' }),
      ctxWith({ contentHash: 'abc' }).ctx,
    );
    expect(res.status).toBe(412);
  });

  it('a tag containing a comma is one tag, not two', async () => {
    const res = await dispatch(
      put({ 'if-match': '"a,b"' }),
      ctxWith({ contentHash: 'a,b' }).ctx,
    );
    expect(res.status).toBe(204);
  });
});
