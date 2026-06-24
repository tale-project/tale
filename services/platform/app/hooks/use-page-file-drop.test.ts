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

  it('clears the overlay even when a region drop zone stops propagation', () => {
    // Regression: dropping ONTO the chat composer (a FileUpload.DropZone that
    // calls stopPropagation on drop) stopped the window bubble handler from
    // running, so isDragOver never reset and the full-page overlay stuck until
    // reload. The capture-phase reset must still clear it.
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() => usePageFileDrop({ onFilesDropped }));

    const region = document.createElement('div');
    document.body.appendChild(region);
    region.addEventListener('drop', (e) => e.stopPropagation());

    act(() => {
      fireEvent.dragEnter(window, { dataTransfer: fileTransfer([]) });
    });
    expect(result.current.isDragOver).toBe(true);

    const file = new File(['hi'], 'note.txt', { type: 'text/plain' });
    act(() => {
      fireEvent.drop(region, { dataTransfer: fileTransfer([file]) });
    });

    // Overlay cleared despite the region zone swallowing the bubble...
    expect(result.current.isDragOver).toBe(false);
    // ...and the window handler did NOT also upload (the region zone owns it).
    expect(onFilesDropped).not.toHaveBeenCalled();

    document.body.removeChild(region);
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
