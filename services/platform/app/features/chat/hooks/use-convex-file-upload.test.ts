// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
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

const generateUploadUrl = vi.fn().mockResolvedValue('https://upload.test/url');
const saveFileMetadata = vi.fn().mockResolvedValue(undefined);

vi.mock('./mutations', () => ({
  useGenerateUploadUrl: () => ({ mutateAsync: generateUploadUrl }),
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

vi.mock('../utils/get-audio-duration', () => ({
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
let pendingFetches: Array<() => void> = [];
let storageCounter = 0;

function installFetch() {
  pendingFetches = [];
  storageCounter = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          const storageId = `storage-${storageCounter++}`;
          pendingFetches.push(() =>
            resolve({
              ok: true,
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

function makeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
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
});
