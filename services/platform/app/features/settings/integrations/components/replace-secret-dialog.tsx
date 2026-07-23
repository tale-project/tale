'use client';

import { Alert } from '@tale/ui/alert';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type { MaskedIntegrationCredential } from '../hooks/backend';
import { useUpdateCredential } from '../hooks/mutations';
import { mapIntegrationError } from '../integration-errors';
import {
  SecretFields,
  buildSecretArgs,
  emptySecretDraft,
  isSecretDraftComplete,
  type SecretDraft,
} from './secret-fields';

interface ReplaceSecretDialogProps {
  organizationId: string;
  credential: MaskedIntegrationCredential;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The i18n title per replaceable auth method, static for the usage scanner.
 * `null` marks a method whose secret is not entered by hand — an `oauth2`
 * grant is replaced by re-running consent, so the row offers Reconnect there
 * instead of this dialog. */
function replaceTitle(
  t: (key: string) => string,
  method: MaskedIntegrationCredential['authMethod'],
): string | null {
  switch (method) {
    case 'api-key':
      return t('integrations.replace.apiKeyTitle');
    case 'bearer':
      return t('integrations.replace.tokenTitle');
    case 'basic':
      return t('integrations.replace.basicTitle');
    default:
      return null;
  }
}

/**
 * Per-method secret replacement of one credential: a fresh API key, a fresh
 * token, or a re-entered username and password. Stored secret material is
 * never read back, so the fields always start blank — replacing means
 * entering the new value in full.
 */
export function ReplaceSecretDialog({
  organizationId,
  credential,
  open,
  onOpenChange,
}: ReplaceSecretDialogProps) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const update = useUpdateCredential();
  const title = replaceTitle(t, credential.authMethod);

  const [secret, setSecret] = useState<SecretDraft>(emptySecretDraft);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSecret(emptySecretDraft());
    setError(null);
  };

  const isValid = isSecretDraftComplete(credential.authMethod, secret);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (update.isPending || !isValid) return;
    setError(null);
    try {
      await update.mutateAsync({
        organizationId,
        credentialId: credential.id,
        ...buildSecretArgs(credential.authMethod, secret),
      });
      toast({ title: t('integrations.dialog.savedToast') });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('integrations: replace credential secret failed', err);
      setError(mapIntegrationError(err));
    }
  };

  // No hand-entered secret for this method — the row never offers the action.
  if (title === null) return null;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={title}
      description={credential.name}
      isSubmitting={update.isPending}
      isDirty={isValid}
      isValid={isValid}
      onSubmit={(e) => void handleSubmit(e)}
    >
      {error && <Alert variant="destructive" description={error} />}
      <Text as="p" variant="muted" className="text-sm">
        {t('integrations.replace.note')}
      </Text>
      <SecretFields
        method={credential.authMethod}
        value={secret}
        onChange={setSecret}
        disabled={update.isPending}
      />
    </FormDialog>
  );
}
