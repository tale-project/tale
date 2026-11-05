import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FILE_LINK_LIFETIME_SEC } from '@/lib/shared/constants/file-links';

import { useFileLinkRenewal } from './use-file-link-renewal';

interface Row {
  fileId: string;
  url: string | null;
}

const OLD = 'https://store.test/a?signed=1';
const NEW = 'https://store.test/a?signed=2';
const NEWER = 'https://store.test/a?signed=3';

/** A batch of links whose next answer each test decides: `answer` settles
 * the oldest fetch on its way and renders the surface with what it got. */
function renderRenewal(rows: Row[]) {
  const pending: Array<{
    resolve: (result: { data: Row[] }) => void;
    reject: (error: unknown) => void;
  }> = [];
  const refetch = vi.fn(
    (_options: { cancelRefetch: boolean }) =>
      new Promise<{ data: Row[] }>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const hook = renderHook(
    ({ data }: { data: Row[] }) => useFileLinkRenewal({ data, refetch }),
    { initialProps: { data: rows } },
  );
  return {
    ...hook,
    refetch,
    answer: async (next: Row[]) => {
      await act(async () => {
        pending.shift()?.resolve({ data: next });
      });
      hook.rerender({ data: next });
    },
    fail: async (error: unknown) => {
      await act(async () => {
        pending.shift()?.reject(error);
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useFileLinkRenewal', () => {
  it('holds a picture that did not draw until a new link arrives, and draws that', async () => {
    const { result, refetch, answer } = renderRenewal([
      { fileId: 'a', url: OLD },
    ]);
    expect(result.current.shows(OLD)).toBe('picture');

    act(() => result.current.pictureFailed(OLD));
    expect(result.current.shows(OLD)).toBe('renewing');
    // A fetch already on its way (a mount's, a focus's) is joined.
    expect(refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });

    // The preview of the same link fails meanwhile: no second request.
    act(() => result.current.previewFailed(OLD));
    expect(refetch).toHaveBeenCalledOnce();

    await answer([{ fileId: 'a', url: NEW }]);
    expect(result.current.shows(NEW)).toBe('picture');
  });

  it('shows the file when the new answer carries the same link', async () => {
    const { result, answer } = renderRenewal([{ fileId: 'a', url: OLD }]);

    act(() => result.current.pictureFailed(OLD));
    await answer([{ fileId: 'a', url: OLD }]);

    expect(result.current.shows(OLD)).toBe('file');
  });

  it('shows the file when a new link fails before it could run out, without asking again', async () => {
    const { result, refetch, answer } = renderRenewal([
      { fileId: 'a', url: OLD },
    ]);
    act(() => result.current.pictureFailed(OLD));
    await answer([{ fileId: 'a', url: NEW }]);

    // A link signed moments ago failed for another reason (bytes that do
    // not decode, an object that is gone): renewing it again does not help.
    act(() => result.current.pictureFailed(NEW));

    expect(result.current.shows(NEW)).toBe('file');
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('asks again for a picture that fails a whole link lifetime later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T11:05:58Z'));
    const { result, refetch, answer } = renderRenewal([
      { fileId: 'a', url: OLD },
    ]);
    act(() => result.current.pictureFailed(OLD));
    await answer([{ fileId: 'a', url: NEW }]);

    // The page stayed open: the renewed link ran out in turn.
    vi.setSystemTime(Date.now() + FILE_LINK_LIFETIME_SEC * 1000);
    act(() => result.current.pictureFailed(NEW));
    expect(result.current.shows(NEW)).toBe('renewing');
    expect(refetch).toHaveBeenCalledTimes(2);

    await answer([{ fileId: 'a', url: NEWER }]);
    expect(result.current.shows(NEWER)).toBe('picture');
  });

  it("asks for a new link when the preview fails, and keeps the surface's picture", async () => {
    const { result, refetch, answer } = renderRenewal([
      { fileId: 'a', url: OLD },
    ]);

    act(() => result.current.previewFailed(OLD));
    expect(refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
    expect(result.current.shows(OLD)).toBe('picture');

    await answer([{ fileId: 'a', url: NEW }]);
    expect(result.current.shows(NEW)).toBe('picture');
  });

  it('shows the file for a picture that is no link of the batch, without asking', () => {
    const { result, refetch } = renderRenewal([{ fileId: 'a', url: OLD }]);

    act(() => result.current.pictureFailed('blob:local-preview'));

    expect(result.current.shows('blob:local-preview')).toBe('file');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('shows the file, and says why, when asking for new links fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, fail } = renderRenewal([{ fileId: 'a', url: OLD }]);
    const offline = new Error('offline');

    act(() => result.current.pictureFailed(OLD));
    await fail(offline);

    expect(result.current.shows(OLD)).toBe('file');
    expect(warn).toHaveBeenCalledWith(
      '[file-links] renewing a file link failed',
      offline,
    );
  });
});
