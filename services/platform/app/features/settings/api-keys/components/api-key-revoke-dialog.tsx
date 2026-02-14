'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type { ApiKey } from '../types';

import { useRevokeApiKey } from '../hooks/use-api-keys';

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
  const [isRevoking, setIsRevoking] = useState(false);
  const revokeKey = useRevokeApiKey(organizationId);

  const handleConfirm = async () => {
    if (isRevoking) return;

    setIsRevoking(true);
    try {
      await revokeKey(apiKey.id);
      toast({
        title: tSettings('apiKeys.keyRevoked'),
        variant: 'success',
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('apiKeys.keyRevokeFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRevoking(false);
    }
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
