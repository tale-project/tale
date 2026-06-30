// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { toast } from '@/app/hooks/use-toast';

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

const generateUploadUrl = vi.fn().mockResolvedValue('https://upload.test/url');
const saveFileMetadata = vi.fn().mockResolvedValue(undefined);

vi.mock('./mutations', () => ({
  useGenerateUploadUrl: () => ({ mutateAsync: generateUploadUrl }),
}));

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: saveFileMetadata }),
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

vi.mock('../utils/get-audio-duration', () => ({
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

const MB = 1024 * 1024;

// Override `size` so the test doesn't allocate the simulated byte count.
function makeAudioFile(name: string, size: number): File {
  const file = new File([new Uint8Array(0)], name, { type: 'audio/mpeg' });
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
    } as Response),
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
