import { useEffect } from 'react';

/**
 * Lets transitions run again once the first frame of the app is painted.
 * `app/main.tsx` marks the document as opening (`data-opening`) before the
 * first frame, and `locals.css` holds every transition back while it is: the
 * page the person opens appears as it is, without its highlights fading in.
 */
export function useOpeningDone(): void {
  useEffect(() => {
    // After the frame the first commit is painted in.
    const frame = requestAnimationFrame(() => {
      delete document.documentElement.dataset.opening;
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}
