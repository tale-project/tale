// @vitest-environment node

/**
 * `putBlobStream`: a body stored as it is read (tale-project/tale#4942). What
 * is held here is who releases the body: the transfer once it was handed the
 * body, and this door for a body that never got that far, so that whatever
 * the body is read from (a file of a sandbox session, for a video's sound)
 * does not wait on a reader that is not coming.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putBlobStream } from './blob_access';

const store = vi.hoisted(() => ({
  resolve: vi.fn(),
  put: vi.fn(),
}));

vi.mock('./object_store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./object_store')>()),
  resolveOrgObjectStore: store.resolve,
  buildObjectKey: () => 'acme/objects/key-1',
  s3PutObjectStream: store.put,
}));

/** A body of `bytes` bytes that says whether its reader let it go. */
function body(bytes: number) {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resolve.mockResolvedValue({ bucket: 'acme' });
  store.put.mockResolvedValue(undefined);
});

describe('putBlobStream — a body stored as it is read', () => {
  it('hands the body on with the length and the type it was declared with, and answers its reference', async () => {
    const { stream, state } = body(64);
    const signal = new AbortController().signal;

    const ref = await putBlobStream('acme', stream, {
      contentLength: 64,
      contentType: 'audio/webm',
      signal,
    });

    expect(ref).toBe('s3:acme/objects/key-1');
    expect(store.resolve).toHaveBeenCalledWith('acme');
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith(
      { bucket: 'acme' },
      'acme/objects/key-1',
      stream,
      { contentLength: 64, contentType: 'audio/webm', signal },
    );
    // The transfer owns the body from there: this door lets nothing go.
    expect(state.cancelled).toBe(false);
  });

  it('names no signal for a caller that has none', async () => {
    const { stream } = body(8);

    await putBlobStream('acme', stream, {
      contentLength: 8,
      contentType: 'audio/mp4',
    });

    expect(store.put.mock.calls[0]?.[3]).toEqual({
      contentLength: 8,
      contentType: 'audio/mp4',
    });
  });

  it('lets go of a body it has no store for, and tells why there is none', async () => {
    const { stream, state } = body(64);
    const none = new Error('No object storage configured');
    store.resolve.mockRejectedValue(none);

    await expect(
      putBlobStream('acme', stream, {
        contentLength: 64,
        contentType: 'audio/webm',
      }),
    ).rejects.toBe(none);

    expect(store.put).not.toHaveBeenCalled();
    expect(state.cancelled).toBe(true);
  });

  it('leaves a body the transfer failed with to the transfer, and tells its failure', async () => {
    const { stream, state } = body(64);
    const failed = new Error('S3 PUT failed: 503');
    store.put.mockRejectedValue(failed);

    await expect(
      putBlobStream('acme', stream, {
        contentLength: 64,
        contentType: 'audio/webm',
      }),
    ).rejects.toBe(failed);

    expect(state.cancelled).toBe(false);
  });

  it('tells the failure of the store, and not that of a body that would not be let go', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const none = new Error('No object storage configured');
    store.resolve.mockRejectedValue(none);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
      cancel() {
        throw new Error('the source would not stop');
      },
    });

    await expect(
      putBlobStream('acme', stream, {
        contentLength: 8,
        contentType: 'audio/webm',
      }),
    ).rejects.toBe(none);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'a body that was not stored could not be released',
    );
    warn.mockRestore();
  });
});
