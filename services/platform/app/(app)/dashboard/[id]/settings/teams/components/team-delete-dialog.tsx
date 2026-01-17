'use client';

import { useState } from 'react';
import { DeleteDialog } from '@/components/ui/dialog/delete-dialog';
import { toast } from '@/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import type { Team } from '../hooks/use-list-teams';

interface TeamDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
  onSuccess?: () => void;
}

export function TeamDeleteDialog({
  open,
  onOpenChange,
  team,
  onSuccess,
}: TeamDeleteDialogProps) {
  const { t: tSettings } = useT('settings');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await authClient.organization.removeTeam({
        teamId: team.id,
      });

      if (result.error) {
        throw new Error(result.error.message || 'Failed to delete team');
      }

      toast({
        title: tSettings('teams.teamDeleted'),
        variant: 'success',
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.teamDeleteFailed'),
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
      title={tSettings('teams.deleteTeam')}
      description={tSettings('teams.deleteConfirmation')}
      deleteText={tSettings('teams.deleteTeam')}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
    />
  );
}
