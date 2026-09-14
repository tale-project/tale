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

  it('uploads through the product image lane and keeps its stable authorized URL', async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    const imageUrl = '/api/app/products/images/file-1?orgId=org-1';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ imageUrl }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useProductImageUpload());
    const url = await result.current.uploadImage(file());

    expect(url).toBe(imageUrl);
    expect(mutation).toHaveBeenCalledWith(
      'products/mutations:generateImageUploadUrl',
      {},
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example/post',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(query).not.toHaveBeenCalled();
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

  it('throws when the response has no stable image URL', async () => {
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
