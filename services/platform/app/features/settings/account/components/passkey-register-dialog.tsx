'use client';

import { Alert } from '@tale/ui/alert';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useState } from 'react';

import { useLockoutMessage } from '@/app/features/auth/hooks/use-lockout-message';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { useAuth } from '@/app/hooks/use-session-user';
import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import {
  isSessionFresh,
  PASSKEY_CEREMONY_MARGIN_MS,
  reauthenticate,
} from '@/app/lib/auth/session-freshness';
import {
  invalidateAuthState,
  sessionQueryOptions,
} from '@/app/lib/auth/session-query';
import { twoFactorStatusQuery } from '@/app/lib/backend/account';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { SESSION_NOT_FRESH_CODE } from '@/lib/shared/constants/session-freshness';
import { deriveDeviceLabel } from '@/lib/utils/device-label';

/**
 * 'any' lets the browser offer every available authenticator (platform
 * preferred); the explicit values narrow the WebAuthn ceremony to the
 * built-in authenticator ('platform') or a roaming one like a security
 * key or phone ('cross-platform').
 */
type AttachmentChoice = 'any' | 'platform' | 'cross-platform';

/**
 * Which step the dialog shows. `auto` follows the session's age, decided
 * when the dialog opens; the server's own answers force a step: a password
 * just confirmed (`name`), or a registration refused as not fresh
 * (`confirm`).
 */
type StepChoice = 'auto' | 'confirm' | 'name';

interface PasskeyRegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the WebAuthn ceremony succeeded and the credential is stored. */
  onRegistered: () => void;
}

/**
 * Name-and-register dialog for a new WebAuthn passkey (#1508). Shared by
 * the account-settings `PasskeySection` and the `/2fa-enroll` wall so both
 * run the exact same ceremony: prompt for a recognizable name, optionally
 * narrow the authenticator attachment, then drive
 * `navigator.credentials.create` via `authClient.passkey.addPasskey`.
 *
 * Registration needs a FRESH session (signed in within
 * `SESSION_FRESH_AGE_SECONDS`). An older one first confirms the password,
 * which replaces it with a fresh one (`reauthenticate`); an account without
 * a password signs in again instead. The age is checked when the dialog
 * opens, and a registration the server still refuses as not fresh comes back
 * to the same step.
 */
export function PasskeyRegisterDialog({
  open,
  onOpenChange,
  onRegistered,
}: PasskeyRegisterDialogProps) {
  const { t } = useT('twoFactor');
  const { t: tAuth } = useT('auth');
  const queryClient = useReactQueryClient();
  const lockoutMessage = useLockoutMessage();
  const { signOut } = useAuth();

  const [name, setName] = useState('');
  const [attachment, setAttachment] = useState<AttachmentChoice>('any');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepChoice, setStepChoice] = useState<StepChoice>('auto');
  const [openedAt, setOpenedAt] = useState(0);

  // Read while the dialog is still closed, so the age is known by the time
  // someone opens it.
  const { data: sessionResult } = useQuery(sessionQueryOptions);
  const createdAt = sessionResult?.data?.session.createdAt;
  const { data: status } = useQuery(twoFactorStatusQuery());
  // Without a status yet, assume a password: the server says otherwise.
  const [passwordless, setPasswordless] = useState(false);
  const hasPassword =
    !passwordless && (status?.authenticated !== true || status.hasCredential);

  // Each opening starts over and takes its own reading of the clock — in a
  // layout effect, so the first frame already shows the right step.
  useLayoutEffect(() => {
    if (!open) return;
    setStepChoice('auto');
    setOpenedAt(Date.now());
  }, [open]);

  // An unknown age asks nothing up front; the server's answer decides.
  const stale =
    createdAt !== undefined &&
    !isSessionFresh(createdAt, openedAt, PASSKEY_CEREMONY_MARGIN_MS);
  const step =
    stepChoice === 'auto' ? (stale ? 'confirm' : 'name') : stepChoice;

  // Pre-fill the name with a best-effort device label (#1948) each time the
  // dialog opens, but never clobber a value the user has already typed. The
  // field stays editable and falls back to its placeholder when the label is
  // empty (unrecognized User-Agent).
  useEffect(() => {
    if (!open || typeof navigator === 'undefined') return;
    setName((current) => current || deriveDeviceLabel(navigator.userAgent));
  }, [open]);

  function reset() {
    setName('');
    setAttachment('any');
    setPassword('');
    setError(null);
  }

  async function confirmPassword() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await reauthenticate(password);
      if (result.ok) {
        setPassword('');
        setStepChoice('name');
        // The session was replaced: every cached answer about it is stale.
        void invalidateAuthState(queryClient).catch((invalidateError) =>
          console.warn(
            '[passkeys] Refreshing the session after confirming the password failed',
            invalidateError,
          ),
        );
        return;
      }
      if (result.reason === 'wrong-password') {
        setError(t('passkeys.errors.wrongPassword'));
      } else if (result.reason === 'locked') {
        setError(lockoutMessage(result.retryAfterSec));
      } else if (result.reason === 'no-password') {
        setPasswordless(true);
      } else {
        setError(t('passkeys.errors.confirmFailed'));
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
        '[passkeys] Ending the session to sign in again failed',
        signOutError,
      );
      setSubmitting(false);
      setError(tAuth('userButton.toast.signOutFailed'));
      return;
    }
    redirectToLogIn();
  }

  async function register(passkeyName: string) {
    setSubmitting(true);
    setError(null);
    try {
      // Drives the WebAuthn registration ceremony (navigator.credentials.create).
      const result = await authClient.passkey.addPasskey({
        name: passkeyName,
        // 'any' = omit the field so the browser offers both kinds.
        ...(attachment !== 'any' && { authenticatorAttachment: attachment }),
      });
      if (result?.error) {
        // The session went stale after the dialog opened (or the clocks
        // disagree): confirm the password, then try again.
        if (
          'code' in result.error &&
          result.error.code === SESSION_NOT_FRESH_CODE
        ) {
          setStepChoice('confirm');
          return;
        }
        setError(result.error.message ?? t('passkeys.errors.registerFailed'));
        return;
      }
      onOpenChange(false);
      reset();
      onRegistered();
    } catch {
      // Thrown when the user dismisses the browser prompt or no authenticator
      // is available — surface a non-alarming message.
      setError(t('passkeys.errors.registerFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const confirming = step === 'confirm';
  const signingInAgain = confirming && !hasPassword;

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onOpenChange(false);
          reset();
        }
      }}
      title={t('passkeys.addButton')}
      description={
        signingInAgain
          ? t('passkeys.signInAgainDescription')
          : confirming
            ? t('passkeys.confirmPasswordDescription')
            : t('passkeys.namePromptDescription')
      }
      submitText={
        signingInAgain
          ? tAuth('accountUnavailable.signInAgain')
          : confirming
            ? t('confirmPassword.submit')
            : t('passkeys.addButton')
      }
      isSubmitting={submitting}
      isDirty={signingInAgain || (confirming ? password : name).length > 0}
      isValid={
        signingInAgain ||
        (confirming ? password.length > 0 : name.trim().length > 0)
      }
      onSubmit={(e) => {
        e?.preventDefault?.();
        if (submitting) return;
        if (signingInAgain) void signInAgain();
        else if (confirming) {
          if (password) void confirmPassword();
        } else if (name.trim()) void register(name.trim());
      }}
    >
      {signingInAgain ? (
        error && <Alert variant="destructive" description={error} />
      ) : confirming ? (
        <Input
          // Each step's field takes the focus as it appears.
          autoFocus
          id="passkey-confirm-password"
          type="password"
          autoComplete="current-password"
          label={t('confirmPassword.label')}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          errorMessage={error ?? undefined}
        />
      ) : (
        <>
          <Input
            autoFocus
            id="passkey-name"
            label={t('passkeys.nameLabel')}
            placeholder={t('passkeys.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            errorMessage={error ?? undefined}
          />
          <Select
            value={attachment}
            onValueChange={(value) => {
              if (
                value === 'any' ||
                value === 'platform' ||
                value === 'cross-platform'
              ) {
                setAttachment(value);
              }
            }}
            disabled={submitting}
            label={t('passkeys.attachment.label')}
            options={[
              { value: 'any', label: t('passkeys.attachment.any') },
              { value: 'platform', label: t('passkeys.attachment.platform') },
              {
                value: 'cross-platform',
                label: t('passkeys.attachment.crossPlatform'),
              },
            ]}
          />
        </>
      )}
    </FormDialog>
  );
}
