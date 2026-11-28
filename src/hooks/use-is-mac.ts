'use client';

import { useEffect, useState } from 'react';

/**
 * True when the client runs on macOS. Use it to pick the right modifier key for
 * keyboard shortcuts (⌘ on Mac, Ctrl elsewhere) and to render the matching
 * shortcut hint. SSR-safe: returns `false` until the effect runs on the client,
 * which is fine for shortcut chrome (it resolves before first interaction).
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const platform = (
      navigator.platform ||
      navigator.userAgent ||
      ''
    ).toLowerCase();
    setIsMac(platform.includes('mac'));
  }, []);

  return isMac;
}
