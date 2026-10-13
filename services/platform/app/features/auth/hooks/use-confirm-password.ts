import { useState } from 'react';

import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { useAuth } from '@/app/hooks/use-session-user';
import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import { reauthenticate } from '@/app/lib/auth/session-freshness';
import { invalidateAuthState } from '@/app/lib/auth/session-query';
import { useT } from '@/lib/i18n/client';

import { usePasswordRefusalMessage } from './use-password-refusal-message';

/**
 * Asking a signed-in person for their password again before something that
 * needs a recent sign-in: what they typed, whether it is being checked, the
 * sentence for a refusal, and the way out for an account that has no
 * password.
 *
 * Confirming replaces the session with a fresh one (`reauthenticate`), so
 * every cached answer about the old one is dropped before `onConfirmed`
 * runs. An account without a password cannot confirm one: the server says so
 * (`passwordless`), and the person signs in again instead (`signInAgain`),
 * which ends this session and comes back to the page they are on.
 *
 * Each surface draws its own field and button — a dialog's footer, a
 * page's own — and uses this for what happens when they are pressed.
 */
export function useConfirmPassword({
  onConfirmed,
}: {
  onConfirmed: () => void;
}) {
  const { t } = useT('twoFactor');
  const { t: tAuth } = useT('auth');
  const queryClient = useReactQueryClient();
  const refusalMessage = usePasswordRefusalMessage();
  const { signOut } = useAuth();

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server says the account has no password to confirm.
  const [passwordless, setPasswordless] = useState(false);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await reauthenticate(password);
      if (result.ok) {
        setPassword('');
        onConfirmed();
        // The session was replaced: every cached answer about it is stale.
        void invalidateAuthState(queryClient).catch((invalidateError) =>
          console.warn(
            '[auth] Refreshing the session after confirming the password failed',
            invalidateError,
          ),
        );
        return;
      }
      if (result.reason === 'wrong-password' || result.reason === 'locked') {
        setError(refusalMessage(result));
      } else if (result.reason === 'no-password') {
        setPasswordless(true);
      } else {
        setError(t('confirmPassword.failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function signInAgain() {
    setSubmitting(true);
    setError(null);
    try {
      await signOut();
    } catch (signOutError) {
      console.warn(
        '[auth] Ending the session to sign in again failed',
        signOutError,
      );
      setSubmitting(false);
      setError(tAuth('userButton.toast.signOutFailed'));
      return;
    }
    redirectToLogIn();
  }

  return {
    password,
    /** Typing clears the refusal the last attempt left. */
    setPassword: (next: string) => {
      setPassword(next);
      setError(null);
    },
    submitting,
    error,
    passwordless,
    confirm,
    signInAgain,
    /** Forget what was typed and said, for a surface that closes and opens again. */
    reset: () => {
      setPassword('');
      setError(null);
    },
  };
}
