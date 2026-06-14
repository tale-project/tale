'use client';

import { useEffect, useRef, useState } from 'react';

interface UsePageFileDropOptions {
  /** Called with the dropped files (after the optional `accept` filter). */
  onFilesDropped: (files: File[]) => void;
  /** When true, the hook detaches its listeners and never reports drags. */
  disabled?: boolean;
  /** Optional per-file filter (e.g. by type/size). */
  accept?: (file: File) => boolean;
}

/**
 * Window-level file drag & drop. Lets a user drop files ANYWHERE on the page —
 * not just inside a small drop zone — and routes them to `onFilesDropped`,
 * while exposing `isDragOver` so the caller can render a full-page overlay.
 *
 * Design notes:
 *  - Only reacts to drags that carry FILES (`dataTransfer.types` includes
 *    `'Files'`), so it never hijacks text/link drags or internal dnd-kit
 *    reorders (those carry no `Files` type).
 *  - Counts dragenter/dragleave depth so the overlay doesn't flicker as the
 *    cursor crosses child elements.
 *  - A region-scoped `FileUpload.DropZone` that calls `stopPropagation()` on a
 *    drop (e.g. the chat composer) still wins for drops landing on it; only
 *    drops elsewhere bubble to this window handler.
 *  - Prevents the browser's default "navigate to the dropped file" while
 *    mounted, so a stray drop never blows away the app.
 */
export function usePageFileDrop(options: UsePageFileDropOptions): {
  isDragOver: boolean;
} {
  const { disabled = false } = options;
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepth = useRef(0);

  // Keep the latest callbacks without re-subscribing listeners every render.
  const onFilesDroppedRef = useRef(options.onFilesDropped);
  onFilesDroppedRef.current = options.onFilesDropped;
  const acceptRef = useRef(options.accept);
  acceptRef.current = options.accept;

  useEffect(() => {
    if (disabled) {
      dragDepth.current = 0;
      setIsDragOver(false);
      return undefined;
    }

    const carriesFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // preventDefault on dragover is what makes the element a valid drop target.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragOver(false);
      const all = Array.from(e.dataTransfer?.files ?? []);
      const accept = acceptRef.current;
      const files = accept ? all.filter(accept) : all;
      if (files.length > 0) onFilesDroppedRef.current(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [disabled]);

  return { isDragOver };
}
