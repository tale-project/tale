'use client';

import { Alert } from '@tale/ui/alert';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { BrokerCredentialData } from '@/lib/shared/schemas/providers';
import { SECRETS_ENV_PREFIX } from '@/lib/shared/schemas/providers';

import { useCreateCredential } from '../hooks/mutations';
import type { ProviderCatalog } from '../hooks/queries';
import {
  authMethodLabel,
  isKnownAuthMethod,
  type KnownAuthMethod,
} from '../labels';
import { mapProviderError } from '../provider-errors';
import {
  BrokerFormFields,
  buildBrokerDocument,
  emptyBrokerDraft,
  isBrokerDraftComplete,
  type BrokerDraft,
} from './broker-form';
import { ModelAllowlistField } from './model-allowlist-field';

interface CredentialCreateDialogProps {
  organizationId: string;
  provider: ProviderCatalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Add credential" dialog of one provider. The method picker offers exactly
 * the provider's declared auth methods; the fields below switch with the
 * picked method (api-key or subscription-key secret / env-var name under the
 * fixed `TALE_PROVIDER_KEY_` prefix / the broker configuration form).
 * Per-credential-endpoint providers additionally require the resource URL.
 * Server refusals (name taken, invalid env name or endpoint, broker issues)
 * render inline with the server's own message.
 */
export function CredentialCreateDialog({
  organizationId,
  provider,
  open,
  onOpenChange,
}: CredentialCreateDialogProps) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const create = useCreateCredential();

  const offeredMethods = provider.authMethods.filter(isKnownAuthMethod);
  const fallbackMethod: KnownAuthMethod = offeredMethods[0] ?? 'api-key';
  // Azure-style providers have no fixed baseUrl — every credential carries
  // its own resource endpoint, entered here.
  const needsEndpoint = provider.endpointMode === 'per-credential';
  // Without a catalog there is nothing to pick from — the allowlist becomes
  // free-entry (on Azure the ids are the resource's deployment names).
  const freeTextAllowlist = provider.catalogSource === 'none';

  const [method, setMethod] = useState<KnownAuthMethod | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [envSuffix, setEnvSuffix] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [broker, setBroker] = useState<BrokerDraft>(emptyBrokerDraft);
  const [error, setError] = useState<string | null>(null);

  const activeMethod = method ?? fallbackMethod;
  const secretLike =
    activeMethod === 'api-key' || activeMethod === 'subscription-key';

  const reset = () => {
    setMethod(null);
    setName('');
    setSecret('');
    setEnvSuffix('');
    setEndpointUrl('');
    setAllowlist([]);
    setBroker(emptyBrokerDraft());
    setError(null);
  };

  const isDirty =
    name.trim().length > 0 ||
    secret.length > 0 ||
    envSuffix.length > 0 ||
    endpointUrl.length > 0 ||
    allowlist.length > 0 ||
    JSON.stringify(broker) !== JSON.stringify(emptyBrokerDraft());

  const methodComplete = secretLike
    ? secret.trim().length > 0
    : activeMethod === 'env'
      ? envSuffix.trim().length > 0
      : isBrokerDraftComplete(broker);
  const isValid =
    name.trim().length > 0 &&
    methodComplete &&
    (!needsEndpoint || endpointUrl.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending || !isValid) return;
    setError(null);

    let methodArgs: {
      secret?: string;
      envName?: string;
      broker?: BrokerCredentialData;
    };
    if (secretLike) {
      methodArgs = { secret: secret.trim() };
    } else if (activeMethod === 'env') {
      methodArgs = { envName: `${SECRETS_ENV_PREFIX}${envSuffix.trim()}` };
    } else {
      const built = buildBrokerDocument(broker);
      if (!built.ok) {
        setError(t('providers.broker.invalid', { error: built.message }));
        return;
      }
      methodArgs = { broker: built.document };
    }

    try {
      await create.mutateAsync({
        organizationId,
        providerSlug: provider.name,
        authMethod: activeMethod,
        name: name.trim(),
        ...methodArgs,
        ...(needsEndpoint && { endpointUrl: endpointUrl.trim() }),
        ...(allowlist.length > 0 && { modelAllowlist: allowlist }),
      });
      toast({ title: t('providers.dialog.createdToast') });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('providers: create credential failed', err);
      setError(mapProviderError(err));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('providers.dialog.addTitle')}
      description={t('providers.dialog.addDescription', {
        provider: provider.displayName,
      })}
      submitText={t('providers.dialog.create')}
      isSubmitting={create.isPending}
      isDirty={isDirty}
      isValid={isValid}
      confirmDiscardOnDirty
      onSubmit={(e) => void handleSubmit(e)}
    >
      {error && <Alert variant="destructive" description={error} />}
      <Select
        label={t('providers.dialog.method')}
        value={activeMethod}
        onValueChange={(next) => {
          if (isKnownAuthMethod(next)) {
            setMethod(next);
            setError(null);
          }
        }}
        options={offeredMethods.map((entry) => ({
          value: entry,
          label: authMethodLabel(t, entry),
        }))}
        disabled={create.isPending}
      />
      <Input
        label={t('providers.dialog.name')}
        placeholder={t('providers.dialog.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        disabled={create.isPending}
        required
      />
      {activeMethod === 'api-key' && (
        <Input
          label={t('providers.dialog.secret')}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={create.isPending}
          required
        />
      )}
      {activeMethod === 'subscription-key' && (
        <>
          <Text as="p" variant="muted" className="text-sm">
            {t('providers.dialog.sandboxedExplainer')}
          </Text>
          <Input
            label={t('providers.dialog.subscriptionSecret')}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            disabled={create.isPending}
            required
          />
        </>
      )}
      {activeMethod === 'env' && (
        <Input
          label={t('providers.dialog.envName')}
          prefix={SECRETS_ENV_PREFIX}
          value={envSuffix}
          onChange={(e) => setEnvSuffix(e.target.value)}
          description={t('providers.dialog.envNameHelp')}
          disabled={create.isPending}
          required
        />
      )}
      {activeMethod === 'subscription-broker' && (
        <BrokerFormFields
          value={broker}
          onChange={setBroker}
          disabled={create.isPending}
        />
      )}
      {needsEndpoint && (
        <Input
          label={t('providers.dialog.endpointUrl')}
          placeholder="https://your-resource.openai.azure.com/openai/v1"
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          description={t('providers.dialog.endpointUrlHelp')}
          disabled={create.isPending}
          required
        />
      )}
      {(provider.models.length > 0 || freeTextAllowlist) && (
        <ModelAllowlistField
          models={provider.models}
          freeText={freeTextAllowlist}
          value={allowlist}
          onValueChange={setAllowlist}
          disabled={create.isPending}
        />
      )}
    </FormDialog>
  );
}
