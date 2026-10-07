'use client';

import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { toast } from '@tale/ui/use-toast';
import { useCallback } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useRevokeApiKey } from '../hooks/use-api-keys';
import type { ApiKey } from '../types';

interface ApiKeyRevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKey: ApiKey;
  organizationId: string;
  onSuccess?: () => void;
}

export function ApiKeyRevokeDialog({
  open,
  onOpenChange,
  apiKey,
  organizationId,
  onSuccess,
}: ApiKeyRevokeDialogProps) {
  const { t: tSettings } = useT('settings');
  const { mutateAsync: revokeKey, isPending: isRevoking } =
    useRevokeApiKey(organizationId);

  const handleConfirm = useCallback(() => {
    if (isRevoking) return;

    // Reported from the call itself, not from `mutate`'s callbacks, which
    // are dropped when the row unmounts mid-request: one failure, one toast,
    // with the refusal's own words.
    void revokeKey(apiKey).then(
      () => {
        toast({
          title: tSettings('apiKeys.keyRevoked'),
        });
        onOpenChange(false);
        onSuccess?.();
      },
      (error: unknown) => {
        console.error(error);
        toast({
          title: tSettings('apiKeys.keyRevokeFailed'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      },
    );
  }, [isRevoking, revokeKey, apiKey, tSettings, onOpenChange, onSuccess]);

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tSettings('apiKeys.revokeKeyTitle')}
      description={tSettings('apiKeys.revokeConfirmation', {
        keyName: apiKey.name || '-',
      })}
      deleteText={tSettings('apiKeys.revokeKey')}
      isDeleting={isRevoking}
      onDelete={handleConfirm}
    />
  );
}
