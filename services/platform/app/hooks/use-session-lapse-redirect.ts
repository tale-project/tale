import { useCallback, useEffect, useRef, useState } from 'react';

import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import {
  onSessionLapsed,
  reportSessionLapsed,
  sessionLapseCheckVersion,
} from '@/app/lib/auth/session-lapse';
import { authClient } from '@/lib/auth-client';

/** A cancelled native leave lets session recovery resume after this grace. */
const LEAVING_MS = 10_000;

/**
 * Recheck a backend session refusal, then ask before leaving. Dialog drafts
 * do not all register with the dirty blocker, so a background answer must
 * never navigate automatically, even when no dirty source is registered.
 *
 * Repeated refusals share a check and keep a dismissed decision dismissed.
 * An explicit sign-in choice rechecks again: another tab may have restored
 * the session while this page (and its draft) stayed open.
 *
 * Intentional auth transitions and document unloads keep ownership of their
 * navigation. Both live and signed-out answers from an older transition are
 * stale and must be checked again after that transition releases its hold.
 */
export function useSessionLapseRedirect(enabled: boolean) {
  const [state, setState] = useState<'none' | 'prompt' | 'paused'>('none');
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  const leftAt = useRef<number | undefined>(undefined);
  const choiceVersion = useRef(0);

  const check = useCallback(async (confirmed: boolean) => {
    const leaving = () =>
      leftAt.current !== undefined && Date.now() - leftAt.current < LEAVING_MS;
    const version = sessionLapseCheckVersion();
    if (!active.current || busy.current || version === null || leaving())
      return;
    const choice = choiceVersion.current;
    busy.current = true;
    setChecking(true);
    setCheckFailed(false);
    const verdict = await sessionVerdict();
    busy.current = false;
    if (!active.current) return;
    setChecking(false);
    if (leaving()) return;
    if (sessionLapseCheckVersion() !== version) {
      reportSessionLapsed();
      return;
    }
    if (verdict === 'live') {
      setState('none');
    } else if (verdict === 'unknown') {
      if (confirmed) setCheckFailed(true);
    } else if (confirmed) {
      // Stay here can cancel an explicit check while its response is pending.
      if (choiceVersion.current === choice) redirectToLogIn('session-ended');
    } else {
      setState((current) => (current === 'none' ? 'prompt' : current));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    active.current = true;
    const onLeave = () => {
      leftAt.current = Date.now();
    };
    window.addEventListener('beforeunload', onLeave);
    const unsubscribe = onSessionLapsed(() => {
      void check(false);
    });
    return () => {
      active.current = false;
      unsubscribe();
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [enabled, check]);

  return {
    isLapsed: state !== 'none',
    open: state === 'prompt',
    checking,
    checkFailed,
    setOpen: (open: boolean) => {
      choiceVersion.current += 1;
      setCheckFailed(false);
      setState(open ? 'prompt' : 'paused');
    },
    continueToLogIn: () => {
      void check(true);
    },
  };
}

async function sessionVerdict(): Promise<'gone' | 'live' | 'unknown'> {
  try {
    const session = await authClient.getSession();
    const status = session?.error?.status;
    if (status !== undefined && (status === 0 || status >= 500)) {
      console.warn(
        `[auth] Session re-check after a lapsed-session answer failed with ${status}`,
      );
      return 'unknown';
    }
    return session?.data?.user ? 'live' : 'gone';
  } catch (error) {
    console.warn(
      '[auth] Session re-check after a lapsed-session answer failed',
      error,
    );
    return 'unknown';
  }
}
