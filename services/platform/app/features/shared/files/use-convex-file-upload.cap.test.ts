// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { CHAT_MAX_FILE_COUNT, detectMediaMime } from '@/lib/shared/file-types';
import { compressImage } from '@/lib/utils/compress-image';

import { useConvexFileUpload } from './use-convex-file-upload';

// ---------------------------------------------------------------------------
// Regression coverage for the per-type size ceiling (#2048): audio/video files
// in the 100MB–200MB band were rejected because the per-file gate clamped the
// media ceiling back down to the 100MB generic cap with `Math.min`. The hook's
// Convex mutations, upload-policy query, i18n, toasts, and image compressor are
// stubbed; the real file-type helpers/constants are kept so the actual ceiling
// logic (getMaxFileSizeForType / CHAT_MAX_TOTAL_SIZE) is under test.
// `detectMediaMime` is forced to resolve "audio/mpeg" so the resolved type is
// deterministically media without an arrayBuffer round-trip.
// ---------------------------------------------------------------------------

// Backend-aware handoff (Convex arm): POST + storageId-from-response.
const generateBlobUpload = vi
  .fn()
  .mockResolvedValue({ url: 'https://upload.test/url', method: 'POST' });
const saveFileMetadata = vi.fn().mockResolvedValue(undefined);

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: generateBlobUpload }),
}));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: saveFileMetadata }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    // Echo the key, appending interpolation params so tests can assert the
    // reported limit (e.g. the `maxSize` in the file-too-large toast).
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('./get-audio-duration', () => ({
  getAudioDuration: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/utils/compress-image', () => ({ compressImage: vi.fn() }));

vi.mock('@/lib/shared/file-types', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/shared/file-types')>();
  return {
    ...actual,
    detectMediaMime: vi.fn().mockResolvedValue('audio/mpeg'),
  };
});

const toastMock = vi.mocked(toast);
const useUploadPolicyMock = vi.mocked(useUploadPolicy);
const detectMediaMimeMock = vi.mocked(detectMediaMime);
const compressImageMock = vi.mocked(compressImage);

const MB = 1024 * 1024;

// Override `size` so the test doesn't allocate the simulated byte count.
function makeAudioFile(name: string, size: number): File {
  const file = new File([new Uint8Array(0)], name, { type: 'audio/mpeg' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function makeImageFile(name: string, size: number): File {
  const file = new File([new Uint8Array(0)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const config = { organizationId: 'org-1' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: 'storage-1' }),
    }),
  );
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
  // Default: no governance upload policy in effect.
  useUploadPolicyMock.mockReturnValue({
    policyEnabled: false,
    maxFileSize: 100 * MB,
    documentMaxFileSize: 100 * MB,
    allowedTypes: [],
    blockedExtensions: [],
    allowedExtensions: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('useConvexFileUpload — per-type size ceiling (#2048)', () => {
  it('accepts a 150MB audio file above the generic 100MB per-file cap', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      await result.current.uploadFiles([
        makeAudioFile('podcast.mp3', 150 * MB),
      ]);
    });

    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    // No "file too large" rejection toast should have fired.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'invalidFiles'),
    ).toBe(false);
  });

  it('still rejects audio above an explicit governance upload-policy cap', async () => {
    useUploadPolicyMock.mockReturnValue({
      policyEnabled: true,
      maxFileSize: 50 * MB,
      documentMaxFileSize: 50 * MB,
      allowedTypes: ['audio/mpeg'],
      blockedExtensions: [],
      allowedExtensions: [],
    });

    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      await result.current.uploadFiles([
        makeAudioFile('podcast.mp3', 150 * MB),
      ]);
    });

    expect(result.current.attachments).toHaveLength(0);
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'invalidFiles'),
    ).toBe(true);
  });

  it('reports the elevated media ceiling (2048MB), not the 100MB generic cap, in the rejection toast', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      // 3 GB audio file — above the 2 GB media per-type cap, so it is rejected.
      await result.current.uploadFiles([
        makeAudioFile('huge.mp3', 3 * 1024 * MB),
      ]);
    });

    expect(result.current.attachments).toHaveLength(0);
    const tooLargeToast = toastMock.mock.calls.find(
      ([arg]) => arg?.title === 'invalidFiles',
    );
    expect(tooLargeToast).toBeTruthy();
    // The toast must state the media ceiling (2 GB = 2048 MB), not 100 MB.
    expect(tooLargeToast?.[0]?.description).toContain('2048');
    expect(tooLargeToast?.[0]?.description).not.toContain('100');
  });

  it('reports the governance policy cap in the rejection toast', async () => {
    useUploadPolicyMock.mockReturnValue({
      policyEnabled: true,
      maxFileSize: 50 * MB,
      documentMaxFileSize: 50 * MB,
      allowedTypes: ['audio/mpeg'],
      blockedExtensions: [],
      allowedExtensions: [],
    });

    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      await result.current.uploadFiles([
        makeAudioFile('podcast.mp3', 150 * MB),
      ]);
    });

    const tooLargeToast = toastMock.mock.calls.find(
      ([arg]) => arg?.title === 'invalidFiles',
    );
    expect(tooLargeToast?.[0]?.description).toContain('50');
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for the in-flight slot race (#2026): the slot / dedup /
// total-size guards read `attachmentsRef`, which only reflects *settled*
// uploads. Two rapid batches that overlap before the first settles both used
// to see a stale count of 0 and each admit their full batch, overshooting the
// 10-file cap. The hook now reserves slots for in-flight uploads so the second
// batch sees the first's files and rejects the overflow.
// ---------------------------------------------------------------------------
describe('useConvexFileUpload — in-flight slot cap (#2026)', () => {
  it('does not exceed the file cap when two batches overlap in-flight', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      const batchA = result.current.uploadFiles(
        Array.from({ length: 6 }, (_, i) =>
          makeAudioFile(`a-${i}.mp3`, 1 * MB),
        ),
      );
      const batchB = result.current.uploadFiles(
        Array.from({ length: 6 }, (_, i) =>
          makeAudioFile(`b-${i}.mp3`, 1 * MB),
        ),
      );
      await Promise.all([batchA, batchB]);
    });

    // 12 files were dropped across two overlapping batches; only 10 may attach.
    await waitFor(() =>
      expect(result.current.attachments.length).toBeGreaterThan(0),
    );
    expect(result.current.attachments).toHaveLength(CHAT_MAX_FILE_COUNT);
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(true);
  });

  it('rejects a duplicate dropped while the first copy is still uploading', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      const first = result.current.uploadFiles([
        makeAudioFile('dup.mp3', 1 * MB),
      ]);
      const second = result.current.uploadFiles([
        makeAudioFile('dup.mp3', 1 * MB),
      ]);
      await Promise.all([first, second]);
    });

    // The in-flight copy is counted, so the second drop is a duplicate.
    expect(result.current.attachments).toHaveLength(1);
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'duplicateFile'),
    ).toBe(true);
  });

  // Reservation ids must be collision-free. The first fix derived the id from
  // `name-Date.now()-index`, which collided for same-name files at the same
  // index across two batches that reserved in the same millisecond — and a
  // collision made release-by-id drop *both* entries on first settle,
  // under-counting in-flight files. With `Date.now` pinned (so the legacy id
  // would collide) the cap must still hold when a third drop lands while an
  // earlier batch is still uploading.
  it('keeps the cap when same-name/different-size batches overlap and a third drop lands mid-flight', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    // Hold every upload in-flight via a controllable `saveFileMetadata`
    // deferred, keyed by size so each batch can be settled independently:
    // 1MB = batch A, 2MB = batch B. Same name + different size are NOT
    // duplicates (dedup key is name:size), so all are admitted.
    const pending: { size: number; resolve: () => void }[] = [];
    saveFileMetadata.mockImplementation(
      ({ size }: { size: number }) =>
        new Promise<void>((resolve) => {
          pending.push({ size, resolve });
        }),
    );

    const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

    const { result } = renderHook(() => useConvexFileUpload(config));

    let batchA: Promise<void> | undefined;
    let batchB: Promise<void> | undefined;
    await act(async () => {
      batchA = result.current.uploadFiles(
        Array.from({ length: 5 }, (_, i) =>
          makeAudioFile(`f-${i}.mp3`, 1 * MB),
        ),
      );
      batchB = result.current.uploadFiles(
        Array.from({ length: 5 }, (_, i) =>
          makeAudioFile(`f-${i}.mp3`, 2 * MB),
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    // 10 distinct files reserved (5 + 5), none settled yet. Settle batch A.
    await act(async () => {
      for (const d of pending.filter((p) => p.size === 1 * MB)) d.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    // Batch A is committed (5 attachments); batch B's 5 are still in-flight.
    // A third drop must see 5 + 5 = 10 slots used and be fully rejected.
    await act(async () => {
      await result.current.uploadFiles([makeAudioFile('late.mp3', 1 * MB)]);
    });
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(true);

    // Drain the rest. The cap holds at exactly 10 — the late file was rejected,
    // not admitted on top of an under-counted in-flight set.
    await act(async () => {
      for (const d of pending.filter((p) => p.size === 2 * MB)) d.resolve();
      await Promise.all([batchA, batchB]);
    });
    await flush();

    expect(result.current.attachments).toHaveLength(CHAT_MAX_FILE_COUNT);
  });

  // A failed upload must release its reservation so the slot is reclaimed
  // rather than leaked — otherwise a single transient failure permanently
  // shrinks the usable cap.
  it('frees the slot when an upload fails', async () => {
    // Reset the metadata mock — an earlier test swaps in a never-resolving
    // deferred and `clearAllMocks` only clears call history, not the impl.
    saveFileMetadata.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ storageId: 'storage-1' }),
        }),
    );

    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      await result.current.uploadFiles([makeAudioFile('bad.mp3', 1 * MB)]);
    });
    expect(result.current.attachments).toHaveLength(0);

    // The failed reservation was released, so a follow-up upload still fits.
    await act(async () => {
      await result.current.uploadFiles([makeAudioFile('good.mp3', 1 * MB)]);
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for #2029: when a batch overflows the slot cap AND the
// trimmed batch would still push the running total past CHAT_MAX_TOTAL_SIZE,
// the total-size check must run *before* the slot-overflow toast. Otherwise
// the user sees a misleading "N files were not added" toast (implying the
// trimmed batch was accepted) immediately followed by a blanket total-size
// rejection — two contradictory toasts and zero uploads.
// ---------------------------------------------------------------------------
describe('useConvexFileUpload — slot-overflow vs total-size ordering (#2029)', () => {
  it('shows only the total-size toast (not the slot-overflow toast) and uploads nothing when the trimmed batch still exceeds the total cap', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // Pre-fill 8 of the 10 slots with 21MB files → 168MB used, 2 slots left.
    await act(async () => {
      await result.current.uploadFiles(
        Array.from({ length: 8 }, (_, i) =>
          makeAudioFile(`existing-${i}.mp3`, 21 * MB),
        ),
      );
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(8));
    toastMock.mockClear();
    saveFileMetadata.mockClear();

    // Add 5 more 21MB files: the slot cap trims the batch to 2 (2 slots left),
    // but 168MB + 42MB = 210MB > 200MB total cap, so the whole batch is
    // rejected by the total-size check.
    await act(async () => {
      await result.current.uploadFiles(
        Array.from({ length: 5 }, (_, i) =>
          makeAudioFile(`incoming-${i}.mp3`, 21 * MB),
        ),
      );
    });

    // Nothing new was uploaded.
    expect(result.current.attachments).toHaveLength(8);
    expect(saveFileMetadata).not.toHaveBeenCalled();

    // The total-size toast fired...
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'totalSizeExceeded'),
    ).toBe(true);
    // ...and the misleading slot-overflow toast did NOT.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(false);
  });

  it('still shows the slot-overflow toast when the trimmed batch fits under the total cap', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // Pre-fill 8 of the 10 slots with small 1MB files → 8MB used, 2 slots left.
    await act(async () => {
      await result.current.uploadFiles(
        Array.from({ length: 8 }, (_, i) =>
          makeAudioFile(`existing-${i}.mp3`, 1 * MB),
        ),
      );
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(8));
    toastMock.mockClear();
    saveFileMetadata.mockClear();

    // Add 5 more small files: slot cap trims to 2, total stays well under
    // 200MB, so the 2 accepted files upload and the slot-overflow toast fires.
    await act(async () => {
      await result.current.uploadFiles(
        Array.from({ length: 5 }, (_, i) =>
          makeAudioFile(`incoming-${i}.mp3`, 1 * MB),
        ),
      );
    });

    await waitFor(() => expect(result.current.attachments).toHaveLength(10));
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'tooManyFiles'),
    ).toBe(true);
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'totalSizeExceeded'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for the total-attachment-size check (#2031): the check
// summed raw `file.size` for incoming images but compressed sizes for already-
// attached ones, over-counting image batches and falsely rejecting them.
// Compression now runs before the size check, so both sides use the stored
// (post-compression) size. `detectMediaMime` is forced to an image type and
// `compressImage` is stubbed to shrink each image to ~1 MB.
// ---------------------------------------------------------------------------
describe('useConvexFileUpload — total-size check uses compressed sizes (#2031)', () => {
  beforeEach(() => {
    detectMediaMimeMock.mockResolvedValue('image/png');
    // Each image compresses down to 1 MB regardless of its raw size.
    compressImageMock.mockImplementation(async (file: File) => {
      const compressed = makeImageFile(file.name, 1 * MB);
      return {
        file: compressed,
        wasCompressed: true,
        originalSize: file.size,
        finalSize: 1 * MB,
      };
    });
  });

  afterEach(() => {
    // Restore the file-level default so other suites keep sniffing audio.
    detectMediaMimeMock.mockResolvedValue('audio/mpeg');
  });

  it('accepts an image batch whose raw size exceeds the 200MB cap but compresses under it', async () => {
    const { result } = renderHook(() => useConvexFileUpload(config));

    // 3 × 80MB = 240MB raw (> 200MB cap) but 3 × 1MB = 3MB compressed.
    await act(async () => {
      await result.current.uploadFiles([
        makeImageFile('a.png', 80 * MB),
        makeImageFile('b.png', 80 * MB),
        makeImageFile('c.png', 80 * MB),
      ]);
    });

    await waitFor(() => expect(result.current.attachments).toHaveLength(3));
    // No "total size exceeded" rejection should have fired.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'totalSizeExceeded'),
    ).toBe(false);
    // Stored sizes are the compressed sizes.
    for (const att of result.current.attachments) {
      expect(att.fileSize).toBe(1 * MB);
    }
  });

  it('still rejects when even the compressed total exceeds the 200MB cap', async () => {
    // Compress to 90MB each: 3 × 90MB = 270MB compressed (> 200MB cap).
    compressImageMock.mockImplementation(async (file: File) => {
      const compressed = makeImageFile(file.name, 90 * MB);
      return {
        file: compressed,
        wasCompressed: true,
        originalSize: file.size,
        finalSize: 90 * MB,
      };
    });

    const { result } = renderHook(() => useConvexFileUpload(config));

    await act(async () => {
      await result.current.uploadFiles([
        makeImageFile('a.png', 95 * MB),
        makeImageFile('b.png', 95 * MB),
        makeImageFile('c.png', 95 * MB),
      ]);
    });

    expect(result.current.attachments).toHaveLength(0);
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'totalSizeExceeded'),
    ).toBe(true);
  });
});
