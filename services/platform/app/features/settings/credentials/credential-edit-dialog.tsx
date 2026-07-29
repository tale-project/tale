'use client';

import { Alert } from '@tale/ui/alert';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';

/**
 * Edit a credential's non-secret fields: its label, the per-credential endpoint
 * where the vendor has one, and any surface-specific extras. Secret material has
 * its own per-method replacement dialog — a stored secret is never read back, so
 * it cannot be "edited", only replaced.
 *
 * Whether the endpoint field appears is decided by the VENDOR, not by whether
 * this particular row happens to carry a URL. Keying it off the row meant a
 * per-credential-endpoint credential that somehow lacked one could never gain
 * it — the field it needed was hidden precisely because it was empty.
 */
export function CredentialEditDialog<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  credential,
  vendor,
  adapter,
  open,
  onOpenChange,
}: {
  organizationId: string;
  credential: Cred;
  vendor: V;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const update = adapter.mutations.useUpdate();
  const { extra } = adapter;

  const baselineExtra = extra.fromCredential(credential);
  const baselineEndpoint = credential.endpointUrl ?? '';

  const [name, setName] = useState(credential.name);
  const [endpointUrl, setEndpointUrl] = useState(baselineEndpoint);
  const [extraValue, setExtraValue] = useState(baselineExtra);
  const [error, setError] = useState<string | null>(null);

  const endpoint = adapter.endpointField(t, vendor);
  const hasEndpoint = vendor.needsEndpoint;

  const isDirty =
    name.trim() !== credential.name ||
    (hasEndpoint && endpointUrl.trim() !== baselineEndpoint) ||
    extra.isDirty(extraValue, baselineExtra);

  const resetToBaseline = () => {
    setName(credential.name);
    setEndpointUrl(baselineEndpoint);
    setExtraValue(baselineExtra);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (update.isPending || name.trim().length === 0) return;
    setError(null);
    try {
      await update.mutateAsync({
        organizationId,
        credentialId: credential.id,
        name: name.trim(),
        ...(hasEndpoint &&
          endpointUrl.trim() !== baselineEndpoint && {
            endpointUrl: endpointUrl.trim(),
          }),
        ...extra.editArgs(extraValue),
      });
      toast({ title: t('credentials.savedToast') });
      onOpenChange(false);
    } catch (err) {
      console.error(`${adapter.logTag}: update credential failed`, err);
      setError(adapter.mapError(err));
    }
  };

  const ExtraFields = extra.Fields;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetToBaseline();
        onOpenChange(next);
      }}
      title={t('credentials.editTitle')}
      description={credential.name}
      isSubmitting={update.isPending}
      isDirty={isDirty}
      isValid={
        name.trim().length > 0 &&
        (!hasEndpoint || endpointUrl.trim().length > 0)
      }
      confirmDiscardOnDirty
      onSubmit={(e) => void handleSubmit(e)}
    >
      {error !== null && <Alert variant="destructive" description={error} />}
      <Input
        label={t('credentials.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        disabled={update.isPending}
        required
      />
      {hasEndpoint && (
        <Input
          label={endpoint.label}
          placeholder={endpoint.placeholder}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          description={endpoint.description}
          disabled={update.isPending}
          required
        />
      )}
      {ExtraFields !== null && (
        <ExtraFields
          vendor={vendor}
          value={extraValue}
          onChange={setExtraValue}
          disabled={update.isPending}
        />
      )}
    </FormDialog>
  );
}
