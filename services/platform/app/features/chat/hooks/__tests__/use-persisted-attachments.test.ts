import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

import type { FileAttachment } from '../use-convex-file-upload';

vi.mock('../queries', () => ({
  useFileUrls: () => ({ data: undefined }),
}));

const { usePersistedAttachments } =
  await import('../use-persisted-attachments');

function createAttachment(
  overrides: Partial<FileAttachment> = {},
): FileAttachment {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
    fileId: 'storage-id-1' as Id<'_storage'>,
    fileName: 'test.png',
    fileType: 'image/png',
    fileSize: 1024,
    previewUrl: 'blob:http://localhost/abc',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

const TEST_USER_ID = 'user-123';

describe('usePersistedAttachments', () => {
  it('persists attachments to localStorage when they change', () => {
    const setAttachments = vi.fn();
    const att = createAttachment();

    const { rerender } = renderHook(
      ({ attachments }: { attachments: FileAttachment[] }) =>
        usePersistedAttachments({
          userId: TEST_USER_ID,
          threadId: 'thread-1',
          attachments,
          setAttachments,
        }),
      { initialProps: { attachments: [] as FileAttachment[] } },
    );

    rerender({ attachments: [att] });

    const stored = localStorage.getItem(
      `chat-attachments-${TEST_USER_ID}-thread-1`,
    );
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored ?? '[]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fileId).toBe('storage-id-1');
    expect(parsed[0].fileName).toBe('test.png');
    expect(parsed[0].previewUrl).toBeUndefined();
  });

  it('restores attachments from localStorage on mount', () => {
    const persisted = [
      {
        fileId: 'storage-id-1',
        fileName: 'photo.jpg',
        fileType: 'image/jpeg',
        fileSize: 2048,
      },
    ];
    localStorage.setItem(
      `chat-attachments-${TEST_USER_ID}-thread-1`,
      JSON.stringify(persisted),
    );

    const setAttachments = vi.fn();

    renderHook(() =>
      usePersistedAttachments({
        userId: TEST_USER_ID,
        threadId: 'thread-1',
        attachments: [],
        setAttachments,
      }),
    );

    expect(setAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        fileId: 'storage-id-1',
        fileName: 'photo.jpg',
        fileType: 'image/jpeg',
        fileSize: 2048,
      }),
    ]);
  });

  it('saves old thread attachments and restores new thread on switch', () => {
    const att1 = createAttachment({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test
      fileId: 'id-a' as Id<'_storage'>,
      fileName: 'a.png',
    });
    localStorage.setItem(
      `chat-attachments-${TEST_USER_ID}-thread-2`,
      JSON.stringify([
        {
          fileId: 'id-b',
          fileName: 'b.png',
          fileType: 'image/png',
          fileSize: 1024,
        },
      ]),
    );

    const setAttachments = vi.fn();

    const { rerender } = renderHook(
      ({ threadId, attachments }) =>
        usePersistedAttachments({
          userId: TEST_USER_ID,
          threadId,
          attachments,
          setAttachments,
        }),
      { initialProps: { threadId: 'thread-1', attachments: [att1] } },
    );

    rerender({ threadId: 'thread-2', attachments: [att1] });

    // Should have saved thread-1's attachments
    const thread1Stored = localStorage.getItem(
      `chat-attachments-${TEST_USER_ID}-thread-1`,
    );
    expect(thread1Stored).not.toBeNull();
    expect(JSON.parse(thread1Stored ?? '[]')[0].fileId).toBe('id-a');

    // Should have restored thread-2's attachments
    expect(setAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ fileId: 'id-b', fileName: 'b.png' }),
    ]);
  });

  it('clears attachments when switching to thread with no stored data', () => {
    const att = createAttachment();
    const setAttachments = vi.fn();

    const { rerender } = renderHook(
      ({ threadId, attachments }) =>
        usePersistedAttachments({
          userId: TEST_USER_ID,
          threadId,
          attachments,
          setAttachments,
        }),
      { initialProps: { threadId: 'thread-1', attachments: [att] } },
    );

    rerender({ threadId: 'thread-2', attachments: [att] });

    expect(setAttachments).toHaveBeenCalledWith([]);
  });

  it('removes localStorage entry when attachments are cleared', () => {
    const att = createAttachment();
    const setAttachments = vi.fn();

    const { rerender } = renderHook(
      ({ attachments }) =>
        usePersistedAttachments({
          userId: TEST_USER_ID,
          threadId: 'thread-1',
          attachments,
          setAttachments,
        }),
      { initialProps: { attachments: [att] } },
    );

    rerender({ attachments: [] });

    expect(
      localStorage.getItem(`chat-attachments-${TEST_USER_ID}-thread-1`),
    ).toBeNull();
  });

  it('does not persist previewUrl to localStorage', () => {
    const att = createAttachment({ previewUrl: 'blob:http://localhost/xyz' });
    const setAttachments = vi.fn();

    renderHook(
      ({ attachments }) =>
        usePersistedAttachments({
          userId: TEST_USER_ID,
          threadId: 'thread-1',
          attachments,
          setAttachments,
        }),
      { initialProps: { attachments: [att] } },
    );

    const stored = localStorage.getItem(
      `chat-attachments-${TEST_USER_ID}-thread-1`,
    );
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? '[]');
    expect(parsed[0].previewUrl).toBeUndefined();
  });

  it('uses "new" key when threadId is undefined', () => {
    const att = createAttachment();
    const setAttachments = vi.fn();

    renderHook(
      ({ attachments }) =>
        usePersistedAttachments({
          userId: TEST_USER_ID,
          threadId: undefined,
          attachments,
          setAttachments,
        }),
      { initialProps: { attachments: [att] } },
    );

    expect(
      localStorage.getItem(`chat-attachments-${TEST_USER_ID}-new`),
    ).not.toBeNull();
  });

  it('isolates storage between different users', () => {
    const att = createAttachment();
    const setAttachments = vi.fn();

    renderHook(
      ({ attachments }) =>
        usePersistedAttachments({
          userId: 'user-a',
          threadId: 'thread-1',
          attachments,
          setAttachments,
        }),
      { initialProps: { attachments: [att] } },
    );

    expect(
      localStorage.getItem('chat-attachments-user-a-thread-1'),
    ).not.toBeNull();
    expect(localStorage.getItem('chat-attachments-user-b-thread-1')).toBeNull();
  });
});
