'use client';

import { Alert } from '@tale/ui/alert';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { SECRETS_ENV_PREFIX } from '@/lib/shared/schemas/providers';

import { useUpdateCredential } from '../hooks/mutations';
import type { MaskedCredential } from '../hooks/queries';
import { mapProviderError } from '../provider-errors';
import {
  BrokerFormFields,
  buildBrokerDocument,
  emptyBrokerDraft,
  isBrokerDraftComplete,
  type BrokerDraft,
} from './broker-form';

interface ReplaceSecretDialogProps {
  organizationId: string;
  credential: MaskedCredential;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The i18n title per replaceable auth method, static for the usage
 * scanner. `null` marks a method this dialog has no replacement form for
 * (the row then never offers the action). */
function replaceTitle(
  t: (key: string) => string,
  method: MaskedCredential['authMethod'],
): string | null {
  switch (method) {
    case 'api-key':
      return t('providers.replace.apiKeyTitle');
    case 'env':
      return t('providers.replace.envTitle');
    case 'subscription-key':
      return t('providers.replace.subscriptionKeyTitle');
    case 'subscription-broker':
      return t('providers.replace.brokerTitle');
    default:
      return null;
  }
}

/**
 * Per-method secret replacement of one credential: a fresh API or
 * subscription key, a new env-var name under the fixed prefix, or a
 * re-entered broker configuration. Stored secret material is never read
 * back, so the fields always start blank; for brokers, leaving the broker
 * secret empty keeps the stored one (the server merges it in).
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

  const [secret, setSecret] = useState('');
  const [envSuffix, setEnvSuffix] = useState('');
  const [broker, setBroker] = useState<BrokerDraft>(emptyBrokerDraft);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSecret('');
    setEnvSuffix('');
    setBroker(emptyBrokerDraft());
    setError(null);
  };

  const secretLike =
    credential.authMethod === 'api-key' ||
    credential.authMethod === 'subscription-key';
  const isValid = secretLike
    ? secret.trim().length > 0
    : credential.authMethod === 'env'
      ? envSuffix.trim().length > 0
      : isBrokerDraftComplete(broker);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (update.isPending || !isValid) return;
    setError(null);

    const base = { organizationId, credentialId: credential.id };
    try {
      if (secretLike) {
        await update.mutateAsync({ ...base, secret: secret.trim() });
      } else if (credential.authMethod === 'env') {
        await update.mutateAsync({
          ...base,
          envName: `${SECRETS_ENV_PREFIX}${envSuffix.trim()}`,
        });
      } else {
        const built = buildBrokerDocument(broker);
        if (!built.ok) {
          setError(t('providers.broker.invalid', { error: built.message }));
          return;
        }
        await update.mutateAsync({ ...base, broker: built.document });
      }
      toast({ title: t('providers.replace.savedToast') });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('providers: replace credential secret failed', err);
      setError(mapProviderError(err));
    }
  };

  // No replacement form for this method — the row never offers the action.
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
      {secretLike && (
        <Input
          label={
            credential.authMethod === 'api-key'
              ? t('providers.replace.apiKeyLabel')
              : t('providers.replace.subscriptionKeyLabel')
          }
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={update.isPending}
          required
        />
      )}
      {credential.authMethod === 'env' && (
        <Input
          label={t('providers.dialog.envName')}
          prefix={SECRETS_ENV_PREFIX}
          value={envSuffix}
          onChange={(e) => setEnvSuffix(e.target.value)}
          description={t('providers.dialog.envNameHelp')}
          disabled={update.isPending}
          required
        />
      )}
      {credential.authMethod === 'subscription-broker' && (
        <>
          <Text as="p" variant="muted" className="text-sm">
            {t('providers.replace.brokerNote')}
          </Text>
          <BrokerFormFields
            value={broker}
            onChange={setBroker}
            disabled={update.isPending}
          />
        </>
      )}
    </FormDialog>
  );
}
