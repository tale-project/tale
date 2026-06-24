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
 *    drops elsewhere bubble to this window handler. The overlay reset runs in
 *    the CAPTURE phase so it still clears on those region-zone drops (a missing
 *    reset there left the full-page overlay stuck until reload).
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
      const all = Array.from(e.dataTransfer?.files ?? []);
      const accept = acceptRef.current;
      const files = accept ? all.filter(accept) : all;
      if (files.length > 0) onFilesDroppedRef.current(files);
    };
    // Overlay reset runs in the CAPTURE phase: a drop ALWAYS ends the drag, so
    // the overlay must clear even when a region-scoped DropZone (the chat
    // composer) calls stopPropagation() on its drop — which would otherwise
    // stop the bubble-phase `onDrop` above from ever running, leaving the
    // overlay stuck until a page reload. Capture runs window->target, BEFORE
    // the target's stopPropagation, so it always fires. Reset only here (no
    // file handling) so a region-zone drop never double-uploads: the bubble
    // `onDrop` still owns the upload for drops that DON'T hit a region zone.
    const onDropResetCapture = () => {
      dragDepth.current = 0;
      setIsDragOver(false);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('drop', onDropResetCapture, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('drop', onDropResetCapture, true);
    };
  }, [disabled]);

  return { isDragOver };
}
