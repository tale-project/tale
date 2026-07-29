'use client';

import { Alert } from '@tale/ui/alert';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useUpdateCredential } from '../hooks/mutations';
import type { ProviderCatalog, MaskedCredential } from '../hooks/queries';
import { mapProviderError } from '../provider-errors';
import { ModelAllowlistField } from './model-allowlist-field';

interface CredentialEditDialogProps {
  organizationId: string;
  credential: MaskedCredential;
  provider: ProviderCatalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edit a credential's non-secret fields: label, model allowlist, and — on
 * per-credential-endpoint providers — the resource endpoint URL (a plain
 * coordinate, listed unmasked). The secret material has its own per-method
 * replacement dialog. An emptied allowlist is sent as `null` so the server
 * clears the restriction instead of storing an empty list.
 */
export function CredentialEditDialog({
  organizationId,
  credential,
  provider,
  open,
  onOpenChange,
}: CredentialEditDialogProps) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const update = useUpdateCredential();

  const [name, setName] = useState(credential.name);
  const [allowlist, setAllowlist] = useState(credential.modelAllowlist ?? []);
  const [endpointUrl, setEndpointUrl] = useState(credential.endpointUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const hasEndpoint = credential.endpointUrl !== undefined;
  const freeTextAllowlist = provider.catalogSource === 'none';

  const baselineAllowlist = credential.modelAllowlist ?? [];
  const isDirty =
    name.trim() !== credential.name ||
    (hasEndpoint && endpointUrl.trim() !== credential.endpointUrl) ||
    allowlist.length !== baselineAllowlist.length ||
    allowlist.some((id, index) => id !== baselineAllowlist[index]);

  const resetToBaseline = () => {
    setName(credential.name);
    setAllowlist(credential.modelAllowlist ?? []);
    setEndpointUrl(credential.endpointUrl ?? '');
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
        modelAllowlist: allowlist.length > 0 ? allowlist : null,
        ...(hasEndpoint &&
          endpointUrl.trim() !== credential.endpointUrl && {
            endpointUrl: endpointUrl.trim(),
          }),
      });
      toast({ title: t('providers.replace.savedToast') });
      onOpenChange(false);
    } catch (err) {
      console.error('providers: update credential failed', err);
      setError(mapProviderError(err));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetToBaseline();
        onOpenChange(next);
      }}
      title={t('providers.dialog.editTitle')}
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
      {error && <Alert variant="destructive" description={error} />}
      <Input
        label={t('providers.dialog.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        disabled={update.isPending}
        required
      />
      {hasEndpoint && (
        <Input
          label={t('providers.dialog.endpointUrl')}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          description={t('providers.dialog.endpointUrlHelp')}
          disabled={update.isPending}
          required
        />
      )}
      {(provider.models.length > 0 ||
        allowlist.length > 0 ||
        freeTextAllowlist) && (
        <ModelAllowlistField
          models={provider.models}
          freeText={freeTextAllowlist}
          value={allowlist}
          onValueChange={setAllowlist}
          disabled={update.isPending}
        />
      )}
    </FormDialog>
  );
}
