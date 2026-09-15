'use client';

import { useEffect, useState } from 'react';

interface DisplayMode {
  /** App is running as an installed PWA (any platform). */
  isStandalone: boolean;
  /**
   * User-agent is Mobile Safari on iOS/iPadOS. This is a pure UA check —
   * standalone mode is reported separately via `isStandalone`. Callers that
   * care about the browser shell (e.g. its bottom toolbar) should gate on
   * `isMobileSafari && !isStandalone`.
   */
  isMobileSafari: boolean;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

export function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(STANDALONE_QUERY).matches
  ) {
    return true;
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function detectIsMobileSafari(): boolean {
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

function detectMode(): DisplayMode {
  return {
    isStandalone: detectIsStandalone(),
    isMobileSafari: detectIsMobileSafari(),
  };
}

/**
 * Detect whether the app is running as an installed PWA (standalone) and
 * whether the browser is Mobile Safari. Used to opt into Safari-specific
 * layout adjustments (e.g. clearing the bottom browser toolbar) only when
 * needed — installed PWAs use the standard safe-area inset instead.
 *
 * Detected on the first render rather than after mount: the bottom tab bar's
 * toolbar clearance must be in place before first paint, or the content
 * column moves up by it just after the page appears. The pre-hydration script
 * in `index.html` applies the same checks for the boot shell's placeholder.
 */
export function useDisplayMode(): DisplayMode {
  const [mode, setMode] = useState<DisplayMode>(detectMode);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (typeof window.matchMedia !== 'function') return undefined;

    const update = () => {
      const next = detectMode();
      setMode((current) =>
        current.isStandalone === next.isStandalone &&
        current.isMobileSafari === next.isMobileSafari
          ? current
          : next,
      );
    };

    const mql = window.matchMedia(STANDALONE_QUERY);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return mode;
}
