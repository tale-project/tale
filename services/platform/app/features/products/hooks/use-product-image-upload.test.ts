// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useProductImageUpload } from './use-product-image-upload';

const mutation = vi.fn();
const query = vi.fn();

vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ mutation, query }),
}));

function file() {
  return new File([new Uint8Array([1, 2, 3])], 'pic.png', {
    type: 'image/png',
  });
}

describe('useProductImageUpload', () => {
  beforeEach(() => {
    mutation.mockReset();
    query.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads to storage and resolves a public URL', async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    query.mockResolvedValue('https://files.example/pic.png');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: 'storage123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useProductImageUpload());
    const url = await result.current.uploadImage(file());

    expect(url).toBe('https://files.example/pic.png');
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example/post',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      fileId: 'storage123',
    });
  });

  it('throws when the upload POST fails', async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const { result } = renderHook(() => useProductImageUpload());
    await expect(result.current.uploadImage(file())).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when the response has no storageId', async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    const { result } = renderHook(() => useProductImageUpload());
    await expect(result.current.uploadImage(file())).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
