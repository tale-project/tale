// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/tests/utils/render';

// A refused bundle POST used to throw "Upload failed (HTTP 413)", and the
// pane's toast could only repeat the status: the door's own sentence (a
// bundle past the size cap, a spent upload budget) was dropped.

const { generateUploadUrl, recordIntent, uploadBundle } = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  recordIntent: vi.fn(),
  uploadBundle: vi.fn(),
}));

vi.mock('../../../hooks/mutations', () => ({
  useGenerateSkillUploadUrl: () => ({ mutateAsync: generateUploadUrl }),
  useRecordSkillUploadIntent: () => ({ mutateAsync: recordIntent }),
  useUploadSkillBundle: () => ({ mutateAsync: uploadBundle }),
}));

import { useSkillBundleUpload } from './use-skill-bundle-upload';

const zip = () => new File(['PK'], 'triage.zip', { type: 'application/zip' });

describe('useSkillBundleUpload', () => {
  beforeEach(() => {
    generateUploadUrl.mockReset();
    recordIntent.mockReset();
    uploadBundle.mockReset();
    generateUploadUrl.mockResolvedValue(
      '/api/app/files/upload?orgId=org_1&purpose=skill-bundle',
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws the door's refusal with its code and sentence", async () => {
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
    const { result } = renderHook(() => useSkillBundleUpload('org_1'));

    await expect(result.current.upload(zip(), false)).rejects.toMatchObject({
      data: {
        code: 'FILE_SIZE_INVALID',
        message: 'The file exceeds the 512 MiB limit',
      },
    });
    // Nothing is bound or persisted for bytes the door refused.
    expect(recordIntent).not.toHaveBeenCalled();
    expect(uploadBundle).not.toHaveBeenCalled();
  });

  it('lands a bundle the door took', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ storageId: 'blob_1' })),
    );
    uploadBundle.mockResolvedValue({ ok: true, slug: 'triage' });
    const { result } = renderHook(() => useSkillBundleUpload('org_1'));

    await expect(result.current.upload(zip(), false)).resolves.toEqual({
      status: 'landed',
      slug: 'triage',
    });
    expect(recordIntent).toHaveBeenCalledWith({
      organizationId: 'org_1',
      storageId: 'blob_1',
    });
  });
});
