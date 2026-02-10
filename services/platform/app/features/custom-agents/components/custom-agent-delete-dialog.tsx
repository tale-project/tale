'use client';

import { useState } from 'react';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useDeleteCustomAgent } from '../hooks/use-custom-agent-mutations';

interface CustomAgentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: {
    _id: string;
    displayName: string;
  };
}

export function CustomAgentDeleteDialog({
  open,
  onOpenChange,
  agent,
}: CustomAgentDeleteDialogProps) {
  const { t } = useT('settings');
  const deleteAgent = useDeleteCustomAgent();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAgent({ customAgentId: agent._id as any });
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
