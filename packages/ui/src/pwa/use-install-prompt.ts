'use client';

import { useCallback, useEffect, useState } from 'react';

// The PWA install prompt event isn't in lib.dom's standard types yet — it's a
// Chromium / Edge / Samsung Internet extension still on the WHATWG track.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

function isBeforeInstallPromptEvent(
  event: Event,
): event is BeforeInstallPromptEvent {
  return (
    'prompt' in event &&
    typeof (event as { prompt: unknown }).prompt === 'function'
  );
}

// `navigator.standalone` is a non-standard iOS Safari flag — not in lib.dom.
function readIosStandalone(navigator: Navigator): boolean {
  const value = (navigator as Navigator & { standalone?: unknown }).standalone;
  return value === true;
}

export interface InstallPromptState {
  /**
   * True when the browser has fired `beforeinstallprompt` (meaning the PWA
   * is installable from this context) and the app isn't already installed.
   * False on iOS Safari, Firefox, and when running as an installed PWA.
   */
  canInstall: boolean;
  /**
   * True when the app is running as an installed PWA — i.e. in standalone
   * display mode (Chromium/Android) or via the legacy `navigator.standalone`
   * flag (iOS Safari). Stays in sync via the `display-mode` media query.
   */
  isInstalled: boolean;
  /**
   * Triggers the deferred install prompt. Resolves with the user's choice or
   * `'unavailable'` when no prompt was captured (e.g. iOS Safari, already
   * installed, or invoked outside a user gesture).
   */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

/**
 * Capture the browser's `beforeinstallprompt` event so a custom UI surface
 * can offer "Install app" / "Get app" later, from a user gesture. Returns
 * `canInstall` only when the browser actually advertised installability and
 * the app isn't already running as a PWA — so a button gated on it stays
 * hidden on platforms that don't support programmatic install (iOS Safari,
 * Firefox, etc.).
 */
export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    setIsInstalled(
      standaloneQuery.matches || readIosStandalone(window.navigator),
    );

    const handleDisplayModeChange = (event: MediaQueryListEvent) => {
      setIsInstalled(event.matches);
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      if (!isBeforeInstallPromptEvent(event)) return;
      // Suppress the browser's native mini-infobar so we control the UX.
      event.preventDefault();
      setDeferred(event);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferred(null);
    };

    standaloneQuery.addEventListener('change', handleDisplayModeChange);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      standaloneQuery.removeEventListener('change', handleDisplayModeChange);
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable' as const;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      return outcome;
    } catch (error) {
      console.warn('PWA install prompt failed', error);
      return 'unavailable' as const;
    } finally {
      // A deferred prompt can only be used once — discard regardless of
      // outcome so the button hides until the browser re-fires
      // `beforeinstallprompt`.
      setDeferred(null);
    }
  }, [deferred]);

  return {
    canInstall: deferred !== null && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
