'use client';

import type { Collection } from '@tanstack/db';

import { useState } from 'react';

import type { CustomAgent } from '@/lib/collections/entities/custom-agents';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

import { useDeleteCustomAgent } from '../hooks/mutations';

interface CustomAgentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: {
    _id: string;
    displayName: string;
  };
  collection: Collection<CustomAgent, string>;
}

export function CustomAgentDeleteDialog({
  open,
  onOpenChange,
  agent,
  collection,
}: CustomAgentDeleteDialogProps) {
  const { t } = useT('settings');
  const deleteAgent = useDeleteCustomAgent(collection);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAgent({ customAgentId: toId<'customAgents'>(agent._id) });
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
