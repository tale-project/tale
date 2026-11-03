import { useEffect, useRef, useState } from 'react';

import type { FrameListener } from './use-live-view';

/**
 * Draws the pictures of the session's browser on a canvas (put `canvasRef` on
 * it), and tells whether one has been drawn yet (a canvas without a picture is
 * not worth showing).
 *
 * A JPEG takes a moment to decode and the server sends one whenever the page
 * changes, so pictures can arrive faster than they are drawn. Only the newest
 * is kept while one is being decoded: a viewer that is behind skips ahead
 * instead of falling further behind. The canvas takes the size of the picture;
 * the size it is shown at is the screen's business.
 */
export function usePictureCanvas(
  onFrame: (listener: FrameListener) => () => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let active = true;
    let decoding = false;
    let pending: ArrayBuffer | null = null;
    let reported = false;

    const drawPending = async () => {
      if (decoding) return;
      decoding = true;
      try {
        while (pending !== null) {
          const jpeg = pending;
          pending = null;
          try {
            const bitmap = await createImageBitmap(
              new Blob([jpeg], { type: 'image/jpeg' }),
            );
            const canvas = canvasRef.current;
            // Unmounted while the picture was decoded.
            if (canvas === null || !active) {
              bitmap.close();
              return;
            }
            if (
              canvas.width !== bitmap.width ||
              canvas.height !== bitmap.height
            ) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
            bitmap.close();
            setDrawn(true);
          } catch (error) {
            // A damaged picture: the next one replaces it. Said once, not for
            // every picture of a stream that keeps breaking.
            if (!reported) {
              reported = true;
              console.warn('live view: a picture could not be drawn', error);
            }
          }
        }
      } finally {
        decoding = false;
      }
    };

    const stop = onFrame((jpeg) => {
      pending = jpeg;
      void drawPending();
    });
    return () => {
      active = false;
      pending = null;
      stop();
    };
  }, [onFrame]);

  return { canvasRef, drawn };
}
