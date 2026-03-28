'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteCustomAgent } from '../hooks/mutations';

interface CustomAgentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  displayName: string;
}

export function CustomAgentDeleteDialog({
  open,
  onOpenChange,
  agentName,
  displayName,
}: CustomAgentDeleteDialogProps) {
  const { t } = useT('settings');
  const { mutateAsync: deleteAgent } = useDeleteCustomAgent();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAgent({
        orgSlug: 'default',
        agentName,
      });
      toast({
        title: t('customAgents.agentDeleted'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentDeleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customAgents.deleteAgent')}
      description={t('customAgents.deleteConfirmation')}
      deleteText={t('customAgents.deleteAgent')}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
    />
  );
}
