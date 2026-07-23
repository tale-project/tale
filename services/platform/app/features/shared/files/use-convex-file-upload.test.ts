// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import {
  CHAT_MAX_FILE_COUNT,
  CHAT_MAX_TOTAL_SIZE,
} from '@/lib/shared/file-types';
import { compressImage } from '@/lib/utils/compress-image';

import { useConvexFileUpload } from './use-convex-file-upload';

// ---------------------------------------------------------------------------
// Module mocks. The hook leans on Convex mutations, the upload policy query,
// i18n, toasts, and the image compressor — none of which are relevant to the
// dedup/cap accounting under test, so they are stubbed. The real file-type
// helpers and constants (CHAT_MAX_FILE_COUNT, etc.) are kept; only the async
// byte-sniffing `detectMediaMime` is forced to "not media" so a plain File
// resolves by extension without an arrayBuffer round-trip.
// ---------------------------------------------------------------------------

// Backend-aware handoff (Convex arm): POST + storageId-from-response.
const generateBlobUpload = vi
  .fn()
  .mockResolvedValue({ url: 'https://upload.test/url', method: 'POST' });
const saveFileMetadata = vi.fn().mockResolvedValue(undefined);

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: generateBlobUpload }),
}));

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: saveFileMetadata }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: () => ({
    policyEnabled: false,
    maxFileSize: 100 * 1024 * 1024,
    allowedTypes: [],
    blockedExtensions: [],
    allowedExtensions: [],
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('./get-audio-duration', () => ({
  getAudioDuration: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/utils/compress-image', () => ({ compressImage: vi.fn() }));

vi.mock('@/lib/shared/file-types', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/shared/file-types')>();
  return { ...actual, detectMediaMime: vi.fn().mockResolvedValue(null) };
});

const compressImageMock = vi.mocked(compressImage);
const toastMock = vi.mocked(toast);

// A controllable POST/fetch: each call parks until the test resolves it, so a
// batch can be held "in-flight" while a second batch races the cap/dedup gates.
// Each parked resolver accepts an outcome so a test can settle an upload as a
// failure (`ok: false`) and exercise the reservation-release path.
let pendingFetches: Array<(outcome?: { ok?: boolean }) => void> = [];
let storageCounter = 0;

function installFetch() {
  pendingFetches = [];
  storageCounter = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          const storageId = `storage-${storageCounter++}`;
          // Mirror the real `fetch`: an aborted signal rejects the request with
          // an AbortError. Lets the cancel test exercise the hook's abort path
          // (swallow the error, drop the reservation) rather than the mock
          // resolving a cancelled upload as a success.
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
          pendingFetches.push((outcome) =>
            resolve({
              ok: outcome?.ok ?? true,
              json: async () => ({ storageId }),
            } as Response),
          );
        }),
    ),
  );
}

function resolveAllFetches() {
  const settle = pendingFetches;
  pendingFetches = [];
  for (const done of settle) done();
}

// Settle every parked upload as a server failure so the hook throws and runs
// its `finally` reservation cleanup.
function failAllFetches() {
  const settle = pendingFetches;
  pendingFetches = [];
  for (const done of settle) done({ ok: false });
}

function makeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

// A File that reports a large `size` without allocating the bytes — the hook
// only reads `file.size`/`file.name` (fetch + compression are stubbed), so this
// keeps the total-size test cheap while still tripping CHAT_MAX_TOTAL_SIZE.
function makeSizedFile(name: string, size: number, type: string): File {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

// Let the synchronous gate logic and the early `await detectMediaMime` chain
// run so in-flight reservations are registered before the next batch fires.
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const config = { organizationId: 'org-1' };

beforeEach(() => {
  installFetch();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
  compressImageMock.mockImplementation(async (file: File) => {
    const compressed = new File(
      [new Uint8Array(200)],
      file.name.replace(/\.[^.]+$/, '.jpg'),
      { type: 'image/jpeg' },
    );
    return {
      file: compressed,
      wasCompressed: true,
      originalSize: file.size,
      finalSize: compressed.size,
    };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('useConvexFileUpload — concurrent-batch cap & dedup', () => {
  it('counts in-flight uploads against the 10-file cap across batches', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // Batch A: 6 files, held in-flight (fetch parked).
    const batchA = Array.from({ length: 6 }, (_, i) =>
      makeFile(`a-${i}.txt`, 10, 'text/plain'),
    );
    let promiseA!: Promise<void>;
    act(() => {
      promiseA = result.current.uploadFiles(batchA);
    });
    await flush();

    // 6 reservations now in-flight; only 4 slots remain of the 10-file cap.
    const batchB = Array.from({ length: 6 }, (_, i) =>
      makeFile(`b-${i}.txt`, 10, 'text/plain'),
    );
    let promiseB!: Promise<void>;
    act(() => {
      promiseB = result.current.uploadFiles(batchB);
    });
    await flush();

    // Batch B should be capped to 4 and surface the too-many-files toast.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(true);

    resolveAllFetches();
    await act(async () => {
      await Promise.all([promiseA, promiseB]);
    });

    // 6 from A + 4 from B = exactly the cap; never 12.
    await waitFor(() => expect(result.current.attachments).toHaveLength(10));
  });

  it('dedupes a file already uploading in another batch', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    const fileA = makeFile('dup.txt', 42, 'text/plain');
    let promiseA!: Promise<void>;
    act(() => {
      promiseA = result.current.uploadFiles([fileA]);
    });
    await flush();

    // Re-attach the identical file while the first is still in-flight.
    const fileB = makeFile('dup.txt', 42, 'text/plain');
    let promiseB!: Promise<void>;
    act(() => {
      promiseB = result.current.uploadFiles([fileB]);
    });
    await flush();

    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'duplicateFile'),
    ).toBe(true);

    resolveAllFetches();
    await act(async () => {
      await Promise.all([promiseA, promiseB]);
    });

    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
  });

  it('dedupes a re-attached image against its original (pre-compression) identity', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // Upload an image; compression renames .png -> .jpg and shrinks the size.
    const image = makeFile('photo.png', 1_500_000, 'image/png');
    let promise1!: Promise<void>;
    act(() => {
      promise1 = result.current.uploadFiles([image]);
    });
    await flush();
    resolveAllFetches();
    await act(async () => {
      await promise1;
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));

    // The stored attachment carries the compressed name/size...
    expect(result.current.attachments[0]?.fileName).toBe('photo.jpg');
    expect(result.current.attachments[0]?.fileSize).toBe(200);
    // ...but retains the original identity for dedup.
    expect(result.current.attachments[0]?.originalFileName).toBe('photo.png');
    expect(result.current.attachments[0]?.originalFileSize).toBe(1_500_000);

    // Re-attaching the same original image is detected as a duplicate.
    toastMock.mockClear();
    const sameImage = makeFile('photo.png', 1_500_000, 'image/png');
    await act(async () => {
      await result.current.uploadFiles([sameImage]);
    });

    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'duplicateFile'),
    ).toBe(true);
    expect(result.current.attachments).toHaveLength(1);
  });

  it('counts in-flight uploads against the total-size cap across batches', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    const MB = 1024 * 1024;
    // Batch A: 180 MB held in-flight (2 files, each under the per-file cap).
    const batchA = [
      makeSizedFile('big-a0.txt', 90 * MB, 'text/plain'),
      makeSizedFile('big-a1.txt', 90 * MB, 'text/plain'),
    ];
    let promiseA!: Promise<void>;
    act(() => {
      promiseA = result.current.uploadFiles(batchA);
    });
    await flush();

    // Batch B: 30 MB alone fits, but 180 MB in-flight + 30 MB = 210 MB exceeds
    // the 200 MB total cap once the pending reservations are folded in.
    expect(90 * MB * 2 + 30 * MB).toBeGreaterThan(CHAT_MAX_TOTAL_SIZE);
    const batchB = [makeSizedFile('big-b0.txt', 30 * MB, 'text/plain')];
    let promiseB!: Promise<void>;
    act(() => {
      promiseB = result.current.uploadFiles(batchB);
    });
    await flush();

    // Batch B must be rejected by the total-size gate, not silently accepted.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'totalSizeExceeded'),
    ).toBe(true);

    resolveAllFetches();
    await act(async () => {
      await Promise.all([promiseA, promiseB]);
    });

    // Only batch A commits; batch B never slipped past the cap.
    await waitFor(() => expect(result.current.attachments).toHaveLength(2));
  });

  it('counts a just-committed file against the cap during the commit→render gap', async () => {
    // Indexing is disabled so the `fileUploaded` success toast still fires
    // synchronously on commit (for RAG-indexable files it is deferred until
    // indexing finishes, #1457) — the test uses that toast as its timing hook
    // into the commit→render gap below.
    const { result } = renderHook(() =>
      useConvexFileUpload({ ...config, disableIndexing: true }),
    );

    const CAP = CHAT_MAX_FILE_COUNT;

    // Batch A fills the entire cap, held in-flight.
    const batchA = Array.from({ length: CAP }, (_, i) =>
      makeFile(`a-${i}.txt`, 10, 'text/plain'),
    );
    // Batch B would also fill the cap on its own.
    const batchB = Array.from({ length: CAP }, (_, i) =>
      makeFile(`b-${i}.txt`, 10, 'text/plain'),
    );

    // Fire batch B from inside the commit of batch A's first file — i.e. in the
    // exact window after that file's reservation is deleted and `setAttachments`
    // is queued, but *before* React re-renders and refreshes `attachmentsRef`.
    // The `fileUploaded` toast is emitted synchronously right after the commit,
    // so it is a faithful hook into that window. The gates must still see the
    // committed files (via the synchronous `attachmentsRef` mirror); if they
    // only saw the pending reservations + the stale ref, batch B would slip
    // past and the final count would be ~2*CAP.
    let promiseB: Promise<void> | undefined;
    let fired = false;
    toastMock.mockImplementation(((arg?: { title?: string }) => {
      if (arg?.title === 'fileUploaded' && !fired) {
        fired = true;
        promiseB = result.current.uploadFiles(batchB);
      }
    }) as typeof toast);

    let promiseA!: Promise<void>;
    act(() => {
      promiseA = result.current.uploadFiles(batchA);
    });
    await flush();

    // Commit batch A; its first commit fires batch B mid-window.
    await act(async () => {
      resolveAllFetches();
      await promiseA;
      // Drain any uploads batch B managed to start, then settle them.
      resolveAllFetches();
      if (promiseB) await promiseB;
      resolveAllFetches();
      if (promiseB) await promiseB;
    });

    // Batch B must have been rejected by the cap gate, not silently accepted.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(true);

    // Exactly the cap — batch B never bypassed it through the commit→render gap.
    await waitFor(() => expect(result.current.attachments).toHaveLength(CAP));
  });

  it('frees an in-flight reservation when its upload fails', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // One file in-flight, holding a reservation.
    const failing = makeFile('fail.txt', 10, 'text/plain');
    let promiseFail!: Promise<void>;
    act(() => {
      promiseFail = result.current.uploadFiles([failing]);
    });
    await flush();

    // Settle it as a server failure — the hook's `finally` must release the
    // slot rather than leak a phantom reservation that consumes the cap.
    failAllFetches();
    await act(async () => {
      await promiseFail;
    });

    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'uploadFailed'),
    ).toBe(true);
    expect(result.current.attachments).toHaveLength(0);

    // The reclaimed slot means a fresh batch can still fill the entire cap; if
    // the failed file's reservation had leaked only 9 of these would be taken.
    const batch = Array.from({ length: CHAT_MAX_FILE_COUNT }, (_, i) =>
      makeFile(`ok-${i}.txt`, 10, 'text/plain'),
    );
    let promiseOk!: Promise<void>;
    act(() => {
      promiseOk = result.current.uploadFiles(batch);
    });
    await flush();
    resolveAllFetches();
    await act(async () => {
      await promiseOk;
    });

    await waitFor(() =>
      expect(result.current.attachments).toHaveLength(CHAT_MAX_FILE_COUNT),
    );
    // No too-many-files toast — the cap was fully available, proving reclaim.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(false);
  });

  it('cancels an in-flight upload without committing it or toasting a failure', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // One file parked in-flight — a single upload spinner, nothing committed.
    const file = makeFile('cancel-me.txt', 10, 'text/plain');
    let promise!: Promise<void>;
    act(() => {
      promise = result.current.uploadFiles([file]);
    });
    await flush();

    expect(result.current.uploadingFiles).toHaveLength(1);
    const uploadId = result.current.uploadingFiles[0];

    // Cancel it: the spinner clears immediately, before the aborted fetch
    // rejects. The user-initiated abort must not surface an "upload failed"
    // toast, and the file must never commit to `attachments`.
    act(() => {
      result.current.cancelUpload(uploadId);
    });
    await flush();
    expect(result.current.uploadingFiles).toHaveLength(0);

    resolveAllFetches();
    await act(async () => {
      await promise;
    });

    expect(result.current.uploadingFiles).toHaveLength(0);
    expect(result.current.attachments).toHaveLength(0);
    expect(saveFileMetadata).not.toHaveBeenCalled();
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'uploadFailed'),
    ).toBe(false);

    // The cancelled slot is reclaimed: a fresh batch can still fill the cap.
    const batch = Array.from({ length: CHAT_MAX_FILE_COUNT }, (_, i) =>
      makeFile(`ok-${i}.txt`, 10, 'text/plain'),
    );
    let promiseOk!: Promise<void>;
    act(() => {
      promiseOk = result.current.uploadFiles(batch);
    });
    await flush();
    resolveAllFetches();
    await act(async () => {
      await promiseOk;
    });
    await waitFor(() =>
      expect(result.current.attachments).toHaveLength(CHAT_MAX_FILE_COUNT),
    );
  });
});
