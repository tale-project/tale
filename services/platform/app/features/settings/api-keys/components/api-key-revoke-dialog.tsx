'use client';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useRevokeApiKey } from '../hooks/use-api-keys';
import type { ApiKey } from '../types';

interface ApiKeyRevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKey: ApiKey;
  onSuccess?: () => void;
}

export function ApiKeyRevokeDialog({
  open,
  onOpenChange,
  apiKey,
  onSuccess,
}: ApiKeyRevokeDialogProps) {
  const { t: tSettings } = useT('settings');
  const { mutate: revokeKey, isPending: isRevoking } = useRevokeApiKey();

  const handleConfirm = () => {
    if (isRevoking) return;

    revokeKey(apiKey.id, {
      onSuccess: () => {
        toast({
          title: tSettings('apiKeys.keyRevoked'),
          variant: 'success',
        });
        onOpenChange(false);
        onSuccess?.();
      },
      onError: (error) => {
        console.error(error);
        toast({
          title: tSettings('apiKeys.keyRevokeFailed'),
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tSettings('apiKeys.revokeKey')}
      description={tSettings('apiKeys.revokeConfirmation')}
      deleteText={tSettings('apiKeys.revokeKey')}
      isDeleting={isRevoking}
      onDelete={handleConfirm}
    />
  );
}
