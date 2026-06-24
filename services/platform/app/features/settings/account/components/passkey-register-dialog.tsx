'use client';

import { useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { deriveDeviceLabel } from '@/lib/utils/device-label';

/**
 * 'any' lets the browser offer every available authenticator (platform
 * preferred); the explicit values narrow the WebAuthn ceremony to the
 * built-in authenticator ('platform') or a roaming one like a security
 * key or phone ('cross-platform').
 */
type AttachmentChoice = 'any' | 'platform' | 'cross-platform';

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
 */
export function PasskeyRegisterDialog({
  open,
  onOpenChange,
  onRegistered,
}: PasskeyRegisterDialogProps) {
  const { t } = useT('twoFactor');

  const [name, setName] = useState('');
  const [attachment, setAttachment] = useState<AttachmentChoice>('any');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
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
      description={t('passkeys.namePromptDescription')}
      submitText={t('passkeys.addButton')}
      isSubmitting={submitting}
      isDirty={name.length > 0}
      isValid={name.trim().length > 0}
      onSubmit={(e) => {
        e?.preventDefault?.();
        if (!submitting && name.trim()) void register(name.trim());
      }}
    >
      <Input
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
    </FormDialog>
  );
}
