// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  LAPSED_SESSION_ANSWER,
  SESSION_ENDED,
} from '@/tests/utils/lapsed-session';

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

  // The door names its refusal; the field maps the code to a cause instead
  // of "try again".
  it("carries the door's refusal code when the upload is refused", async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'PRODUCT_IMAGE_ACTIVE_CONTENT' }),
      }),
    );

    const { result } = renderHook(() => useProductImageUpload());
    await expect(result.current.uploadImage(file())).rejects.toMatchObject({
      data: { code: 'PRODUCT_IMAGE_ACTIVE_CONTENT' },
    });
  });

  // The products door answers `{ error: <code> }` alone (a role without
  // write access, a spent upload budget): the code doubles as the message,
  // as `backendFetch` reads it, so the field can name the refusal. The
  // hook's own reader used to put "Upload failed with status 403" there.
  it('carries a bare code as the message', async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'RBAC_FORBIDDEN' }, { status: 403 }),
        ),
    );

    const { result } = renderHook(() => useProductImageUpload());
    await expect(result.current.uploadImage(file())).rejects.toMatchObject({
      data: { code: 'RBAC_FORBIDDEN', message: 'RBAC_FORBIDDEN' },
    });
  });

  // A regression guard for the move onto the shared reader: #3498's inline
  // reader already carried a sentence the door writes beside its code.
  it("carries the door's message beside its code", async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: 'FILE_SIZE_INVALID',
            message: 'The file is 6291456 bytes; the limit is 5 MiB',
          },
          { status: 400 },
        ),
      ),
    );

    const { result } = renderHook(() => useProductImageUpload());
    await expect(result.current.uploadImage(file())).rejects.toMatchObject({
      data: {
        code: 'FILE_SIZE_INVALID',
        message: 'The file is 6291456 bytes; the limit is 5 MiB',
      },
    });
  });

  // A lapsed session answers the flat envelope: the sentence in `error`, the
  // code beside it. The field reads `UNAUTHORIZED` from `code`, and the
  // words are the app's session-ended sentence, not the door's guidance for
  // API clients.
  it("carries the flat envelope's code, and the app's words for it", async () => {
    mutation.mockResolvedValue('https://upload.example/post');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(LAPSED_SESSION_ANSWER.body, {
          status: LAPSED_SESSION_ANSWER.status,
        }),
      ),
    );

    const { result } = renderHook(() => useProductImageUpload());
    await expect(result.current.uploadImage(file())).rejects.toMatchObject({
      data: { code: 'UNAUTHORIZED', message: SESSION_ENDED.en },
    });
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
