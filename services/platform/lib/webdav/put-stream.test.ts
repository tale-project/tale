// The PUT door hands a file to the store a chunk at a time, and must hold
// none of it once it is sent. Regression (tale-project/tale#4942): `fetch`
// keeps a second copy of a body stream, to send it again should the server
// redirect, unless redirects are refused. Nobody read that copy, so it held
// every chunk until the store had answered: a file "streamed" through this
// door was in the process whole, and the door takes files of gigabytes.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { objectUrl } from '../../backend/core/lib/storage/object_store';
import {
  collectGarbage,
  startTestStore,
  type TestStore,
} from '../../backend/core/lib/storage/object_store.test-helpers';
import { dispatch } from './handler';
import { makeRequest, makeStubCtx, setupHmacEnv } from './test-helpers';

beforeAll(() => {
  setupHmacEnv();
});

describe('PUT of a file that is sent on as it arrives', () => {
  let target: TestStore;
  beforeEach(async () => {
    target = await startTestStore();
    target.behave = { countOnly: true };
  });
  afterEach(async () => {
    await target.close();
  });

  /** A fresh path, no lock held, and an upload lane into the test store. */
  function ctxFor(key: string) {
    return makeStubCtx({
      queries: {
        'webdav/lock_queries:findLockForPath': () => ({ lock: null }),
        'webdav/tree_queries:resolvePath': () => ({ exists: false }),
        'webdav/tree_queries:getDocumentProps': () => null,
      },
      mutations: {
        'webdav/tree_mutations:ingestPutBlob': () => ({ created: true }),
      },
      actions: {
        'files/blob_actions:generateWebdavBlobUpload': () => ({
          url: objectUrl(target.store, key),
          method: 'PUT',
          s3Ref: `s3:${key}`,
        }),
      },
    });
  }

  it('keeps nothing of the file once the store has it', async () => {
    const pieceBytes = 64 * 1024;
    const pieces = 512;
    const early: WeakRef<Uint8Array>[] = [];
    let pulled = 0;
    let atHalf!: () => void;
    const half = new Promise<void>((resolve) => {
      atHalf = resolve;
    });
    let goOn!: () => void;
    const mayGoOn = new Promise<void>((resolve) => {
      goOn = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pulled === pieces) {
          controller.close();
          return;
        }
        if (pulled === pieces / 2) {
          atHalf();
          await mayGoOn;
        }
        const piece = new Uint8Array(pieceBytes);
        if (pulled < 64) early.push(new WeakRef(piece));
        pulled += 1;
        controller.enqueue(piece);
      },
    });
    const request = {
      ...makeRequest({
        method: 'PUT',
        pathname: '/dav/myorg/documents/recording.bin',
        authenticated: true,
        headers: { 'content-length': String(pieces * pieceBytes) },
      }),
      body,
    };

    const answered = dispatch(request, ctxFor('acme/recording'));

    await half;
    // The first 64 pieces are with the store, and well behind what any
    // queue on the way still holds.
    await vi.waitFor(() =>
      expect(target.puts[0]?.received ?? 0).toBeGreaterThan(128 * pieceBytes),
    );
    await collectGarbage();
    expect(early.filter((piece) => piece.deref() !== undefined)).toHaveLength(
      0,
    );

    goOn();
    expect((await answered).status).toBe(201);
    expect(target.puts[0]?.received).toBe(pieces * pieceBytes);
  });
});
