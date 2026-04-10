'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteAgent } from '../hooks/mutations';

interface AgentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  organizationId: string;
  onDeleted?: () => void;
}

export function AgentDeleteDialog({
  open,
  onOpenChange,
  agentName,
  organizationId,
  onDeleted,
}: AgentDeleteDialogProps) {
  const { t } = useT('settings');
  const { mutateAsync: deleteAgent } = useDeleteAgent();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAgent({
        orgSlug: 'default',
        agentName,
        organizationId,
      });
      toast({
        title: t('agents.agentDeleted'),
      });
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      console.error(error);
      toast({
        title: t('agents.agentDeleteFailed'),
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
      title={t('agents.deleteAgent')}
      description={t('agents.deleteConfirmation')}
      deleteText={t('agents.deleteAgent')}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
    />
  );
}
