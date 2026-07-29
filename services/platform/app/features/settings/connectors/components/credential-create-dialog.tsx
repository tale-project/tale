'use client';

import { Alert } from '@tale/ui/alert';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { StorableAuthMethodName } from '@/lib/shared/schemas/connectors';

import type { ConnectorSummary } from '../hooks/backend';
import { useCreateCredential } from '../hooks/mutations';
import {
  authMethodLabel,
  endpointHelp,
  endpointPlaceholder,
  isAuthMethod,
} from '../labels';
import {
  SecretFields,
  buildSecretArgs,
  emptySecretDraft,
  isSecretDraftComplete,
  type SecretDraft,
} from './secret-fields';

interface CredentialCreateDialogProps {
  organizationId: string;
  connector: ConnectorSummary;
  /** The connector's hand-entered methods — `oauth2` is excluded by the
   * section, which offers consent instead of a form. */
  methods: StorableAuthMethodName[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Add credential" dialog of one connector. The method picker offers exactly
 * the methods the connector's `auth` declares — nothing else is offered,
 * because nothing else would authenticate — and the fields below switch with
 * the picked method. Connectors whose endpoint is per credential additionally
 * require the instance origin.
 *
 * Server refusals (name already taken, method the connector doesn't accept,
 * an endpoint that isn't an https origin) render inline with the server's own
 * message, which already names the fix.
 */
export function CredentialCreateDialog({
  organizationId,
  connector,
  methods,
  open,
  onOpenChange,
}: CredentialCreateDialogProps) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const create = useCreateCredential();

  const fallbackMethod: StorableAuthMethodName = methods[0] ?? 'api-key';
  // Confluence and Shopify name their own instance per credential; the others
  // talk to one fixed vendor host.
  const needsEndpoint = connector.endpointMode === 'per-credential';

  const [method, setMethod] = useState<StorableAuthMethodName | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<SecretDraft>(emptySecretDraft);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeMethod = method ?? fallbackMethod;

  const reset = () => {
    setMethod(null);
    setName('');
    setSecret(emptySecretDraft());
    setEndpointUrl('');
    setError(null);
  };

  const isDirty =
    name.trim().length > 0 ||
    endpointUrl.length > 0 ||
    secret.token.length > 0 ||
    secret.username.length > 0 ||
    secret.password.length > 0;

  const isValid =
    name.trim().length > 0 &&
    isSecretDraftComplete(activeMethod, secret) &&
    (!needsEndpoint || endpointUrl.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending || !isValid) return;
    setError(null);

    try {
      await create.mutateAsync({
        organizationId,
        connectorSlug: connector.slug,
        authMethod: activeMethod,
        name: name.trim(),
        ...buildSecretArgs(activeMethod, secret),
        ...(needsEndpoint && { endpointUrl: endpointUrl.trim() }),
      });
      toast({ title: t('connectors.dialog.createdToast') });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('connectors: create credential failed', err);
      setError(mapCredentialError(err));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('connectors.dialog.addTitle')}
      description={t('connectors.dialog.addDescription', {
        connector: connector.displayName,
      })}
      submitText={t('connectors.dialog.create')}
      isSubmitting={create.isPending}
      isDirty={isDirty}
      isValid={isValid}
      confirmDiscardOnDirty
      onSubmit={(e) => void handleSubmit(e)}
    >
      {error && <Alert variant="destructive" description={error} />}
      <Select
        label={t('connectors.dialog.method')}
        value={activeMethod}
        onValueChange={(next) => {
          if (!isAuthMethod(next)) return;
          setMethod(next);
          setError(null);
        }}
        options={methods.map((entry) => ({
          value: entry,
          label: authMethodLabel(t, entry),
        }))}
        disabled={create.isPending}
      />
      <Input
        label={t('connectors.dialog.name')}
        placeholder={t('connectors.dialog.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        description={t('connectors.dialog.nameHelp')}
        maxLength={100}
        disabled={create.isPending}
        required
      />
      <SecretFields
        method={activeMethod}
        value={secret}
        onChange={setSecret}
        disabled={create.isPending}
      />
      {needsEndpoint && (
        <Input
          label={t('connectors.dialog.endpointUrl')}
          placeholder={endpointPlaceholder(connector.slug)}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          description={endpointHelp(t, connector.slug)}
          disabled={create.isPending}
          required
        />
      )}
    </FormDialog>
  );
}
