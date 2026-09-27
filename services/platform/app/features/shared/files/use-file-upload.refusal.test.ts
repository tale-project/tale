// @vitest-environment jsdom
import { toast } from '@tale/ui/use-toast';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileUpload } from './use-file-upload';

// ---------------------------------------------------------------------------
// A refused chat attachment used to throw a bare "uploadFailed" and toast
// "Couldn't upload <file>" whatever the door had said. The door's words now
// ride the toast; a fault still names only the file. The hook's backend
// writes, upload policy, i18n and toasts are stubbed; `t` echoes its key and
// params so the reason is visible to the assertions.
// ---------------------------------------------------------------------------

const generateBlobUpload = vi
  .fn()
  .mockResolvedValue({ url: '/api/app/files/upload', method: 'POST' });
const saveFileMetadata = vi.fn().mockResolvedValue(undefined);

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: generateBlobUpload }),
}));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: saveFileMetadata }),
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

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/lib/shared/file-types', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/shared/file-types')>();
  return { ...actual, detectMediaMime: vi.fn().mockResolvedValue(null) };
});

const toastMock = vi.mocked(toast);

const notes = () =>
  new File(['meeting notes'], 'notes.txt', { type: 'text/plain' });

async function upload(file: File) {
  const { result } = renderHook(() =>
    useFileUpload({ organizationId: 'org-1' }),
  );
  await act(async () => {
    await result.current.uploadFiles([file]);
  });
  return result;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useFileUpload refusals', () => {
  it("names the door's reason beside the file", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: 'FILE_SIZE_INVALID',
            message: 'The file exceeds the 512 MiB limit',
          },
          { status: 413 },
        ),
      ),
    );

    const result = await upload(notes());

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: 'uploadFailed',
        description: `failedToUploadReason:${JSON.stringify({
          filename: 'notes.txt',
          reason: 'The file exceeds the 512 MiB limit',
        })}`,
        variant: 'destructive',
      }),
    );
    expect(saveFileMetadata).not.toHaveBeenCalled();
    expect(result.current.attachments).toHaveLength(0);
  });

  it('names only the file for a failure the door did not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await upload(notes());

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: 'uploadFailed',
        description: `failedToUpload:${JSON.stringify({ filename: 'notes.txt' })}`,
        variant: 'destructive',
      }),
    );
  });
});
