import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePageFileDrop } from './use-page-file-drop';

/** A minimal stand-in for the parts of DataTransfer the hook reads. */
function fileTransfer(files: File[]) {
  return { types: ['Files'], files, dropEffect: '' };
}

describe('usePageFileDrop', () => {
  it('tracks isDragOver and routes dropped files', () => {
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() => usePageFileDrop({ onFilesDropped }));
    expect(result.current.isDragOver).toBe(false);

    act(() => {
      fireEvent.dragEnter(window, { dataTransfer: fileTransfer([]) });
    });
    expect(result.current.isDragOver).toBe(true);

    const file = new File(['hi'], 'note.txt', { type: 'text/plain' });
    act(() => {
      fireEvent.drop(window, { dataTransfer: fileTransfer([file]) });
    });
    expect(result.current.isDragOver).toBe(false);
    expect(onFilesDropped).toHaveBeenCalledTimes(1);
    expect(onFilesDropped.mock.calls[0][0]).toEqual([file]);
  });

  it('ignores drags that carry no files (text/links/internal dnd)', () => {
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() => usePageFileDrop({ onFilesDropped }));

    act(() => {
      fireEvent.dragEnter(window, {
        dataTransfer: { types: ['text/plain'], files: [] },
      });
    });
    expect(result.current.isDragOver).toBe(false);

    act(() => {
      fireEvent.drop(window, {
        dataTransfer: { types: ['text/plain'], files: [] },
      });
    });
    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it('applies the accept filter', () => {
    const onFilesDropped = vi.fn();
    renderHook(() =>
      usePageFileDrop({
        onFilesDropped,
        accept: (f) => f.type.startsWith('image/'),
      }),
    );
    const img = new File(['x'], 'a.png', { type: 'image/png' });
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    act(() => {
      fireEvent.drop(window, { dataTransfer: fileTransfer([img, txt]) });
    });
    expect(onFilesDropped).toHaveBeenCalledWith([img]);
  });

  it('is inert when disabled', () => {
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() =>
      usePageFileDrop({ onFilesDropped, disabled: true }),
    );
    act(() => {
      fireEvent.dragEnter(window, { dataTransfer: fileTransfer([]) });
    });
    expect(result.current.isDragOver).toBe(false);
    act(() => {
      fireEvent.drop(window, {
        dataTransfer: fileTransfer([new File(['x'], 'a.txt')]),
      });
    });
    expect(onFilesDropped).not.toHaveBeenCalled();
  });
});
