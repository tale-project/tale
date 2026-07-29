'use client';

import { Alert } from '@tale/ui/alert';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { mapConnectorError } from '../connector-errors';
import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';
import { useUpdateCredential } from '../hooks/mutations';
import { endpointHelp, endpointPlaceholder } from '../labels';

interface CredentialEditDialogProps {
  organizationId: string;
  credential: MaskedConnectorCredential;
  connector: ConnectorSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edit a credential's non-secret fields: its label and — on connectors whose
 * endpoint is per credential — the instance origin (a plain coordinate, listed
 * unmasked). The secret material has its own replacement dialog, and an
 * `oauth2` grant has neither: it is replaced by re-running consent.
 */
export function CredentialEditDialog({
  organizationId,
  credential,
  connector,
  open,
  onOpenChange,
}: CredentialEditDialogProps) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const update = useUpdateCredential();

  const [name, setName] = useState(credential.name);
  const [endpointUrl, setEndpointUrl] = useState(credential.endpointUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const hasEndpoint = connector.endpointMode === 'per-credential';

  const isDirty =
    name.trim() !== credential.name ||
    (hasEndpoint && endpointUrl.trim() !== (credential.endpointUrl ?? ''));

  const resetToBaseline = () => {
    setName(credential.name);
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
        ...(hasEndpoint &&
          endpointUrl.trim() !== credential.endpointUrl && {
            endpointUrl: endpointUrl.trim(),
          }),
      });
      toast({ title: t('connectors.dialog.savedToast') });
      onOpenChange(false);
    } catch (err) {
      console.error('connectors: update credential failed', err);
      setError(mapConnectorError(err));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetToBaseline();
        onOpenChange(next);
      }}
      title={t('connectors.dialog.editTitle')}
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
        label={t('connectors.dialog.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        disabled={update.isPending}
        required
      />
      {hasEndpoint && (
        <Input
          label={t('connectors.dialog.endpointUrl')}
          placeholder={endpointPlaceholder(connector.slug)}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          description={endpointHelp(t, connector.slug)}
          disabled={update.isPending}
          required
        />
      )}
    </FormDialog>
  );
}
