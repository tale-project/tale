// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { toast } from '@/app/hooks/use-toast';

import { useConvexFileUpload } from './use-convex-file-upload';

// ---------------------------------------------------------------------------
// Regression coverage for #1457: a PDF (or any RAG-indexable file) must NOT
// flash "uploaded successfully" the instant its bytes land, because indexing
// runs asynchronously afterwards and can still fail with an "Index failed"
// badge. The composer defers that toast to `useFileIndexingStatus`, which owns
// the terminal status. Files that are not indexed (e.g. indexing disabled for
// the conversation) keep the immediate toast.
//
// `detectMediaMime` resolves to `null` so the resolved type comes from the
// real `resolveFileType`, exercising the genuine `isRagIndexableFile` gate.
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
  useUploadPolicy: vi.fn(),
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
  return {
    ...actual,
    // Force the non-media path so resolveFileType drives the resolved type.
    detectMediaMime: vi.fn().mockResolvedValue(null),
  };
});

const toastMock = vi.mocked(toast);
const useUploadPolicyMock = vi.mocked(useUploadPolicy);

const MB = 1024 * 1024;

function makePdf(name = 'report.pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: 'application/pdf',
  });
}

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

describe('useConvexFileUpload — deferred indexing toast (#1457)', () => {
  it('does NOT show "uploaded successfully" immediately for an indexable PDF', async () => {
    const { result } = renderHook(() =>
      useConvexFileUpload({ organizationId: 'org-1' }),
    );

    await act(async () => {
      await result.current.uploadFiles([makePdf()]);
    });

    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    // Metadata was saved (so backend queues indexing) ...
    expect(saveFileMetadata).toHaveBeenCalledTimes(1);
    // ... but the success toast is deferred until indexing finishes.
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'fileUploaded'),
    ).toBe(false);
  });

  it('shows "uploaded successfully" immediately when indexing is disabled', async () => {
    const { result } = renderHook(() =>
      useConvexFileUpload({ organizationId: 'org-1', disableIndexing: true }),
    );

    await act(async () => {
      await result.current.uploadFiles([makePdf()]);
    });

    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(
      toastMock.mock.calls.some(([arg]) => arg?.title === 'fileUploaded'),
    ).toBe(true);
  });
});
