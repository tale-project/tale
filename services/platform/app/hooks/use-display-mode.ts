'use client';

import { useEffect, useState } from 'react';

interface DisplayMode {
  /** App is running as an installed PWA (any platform). */
  isStandalone: boolean;
  /** User-agent is Mobile Safari on iOS/iPadOS (and not in standalone mode). */
  isMobileSafari: boolean;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia(STANDALONE_QUERY).matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function detectIsMobileSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS =
    /iP(ad|hone|od)/.test(ua) ||
    // iPadOS 13+ reports as Mac with touch support
    (window.navigator.platform === 'MacIntel' &&
      window.navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  // Exclude in-app browsers (Chrome iOS, Firefox iOS, etc.) that share the
  // WebKit engine but aren't Safari-the-app.
  const isSafariShell = /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS)/.test(ua);
  return isSafariShell;
}

/**
 * Detect whether the app is running as an installed PWA (standalone) and
 * whether the browser is Mobile Safari. Used to opt into Safari-specific
 * layout adjustments (e.g. clearing the bottom browser toolbar) only when
 * needed — installed PWAs use the standard safe-area inset instead.
 */
export function useDisplayMode(): DisplayMode {
  const [mode, setMode] = useState<DisplayMode>({
    isStandalone: false,
    isMobileSafari: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = () => {
      setMode({
        isStandalone: detectIsStandalone(),
        isMobileSafari: detectIsMobileSafari(),
      });
    };
    update();

    const mql = window.matchMedia(STANDALONE_QUERY);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return mode;
}
