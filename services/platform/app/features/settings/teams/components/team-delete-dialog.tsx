'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { useHasAgentsByTeam } from '@/app/features/agents/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import type { Team } from '../hooks/queries';

interface TeamDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
  organizationId: string;
  onSuccess?: () => void;
}

export function TeamDeleteDialog({
  open,
  onOpenChange,
  team,
  organizationId,
  onSuccess,
}: TeamDeleteDialogProps) {
  const { t: tSettings } = useT('settings');
  const [isDeleting, setIsDeleting] = useState(false);
  const { data: hasAgents } = useHasAgentsByTeam(team.id);

  const handleConfirm = async () => {
    if (hasAgents) return;
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await authClient.organization.removeTeam({
        teamId: team.id,
        organizationId,
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
      warning={hasAgents ? tSettings('teams.teamHasAgentsWarning') : undefined}
      deleteText={tSettings('teams.deleteTeam')}
      isDeleting={isDeleting}
      disableDelete={!!hasAgents}
      onDelete={handleConfirm}
    />
  );
}
