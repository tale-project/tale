'use client';

import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { toast } from '@tale/ui/use-toast';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useDeleteTeam } from '../hooks/mutations';
import { useTeamDeletionImpact, type Team } from '../hooks/queries';

interface TeamDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
  organizationId: string;
  onSuccess?: () => void;
}

/**
 * Delete a team through the app's atomic door, after showing what the
 * delete touches: every project, folder and document scoped to the team
 * drops it from its audience — and the ones this was the ONLY team of
 * become visible to the whole organization, which is the one consequence an
 * admin must see before confirming. Conversations in the team's queue return
 * to administrator triage; cloud imports scoped to it become org-wide.
 */
export function TeamDeleteDialog({
  open,
  onOpenChange,
  team,
  organizationId,
  onSuccess,
}: TeamDeleteDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isDeleting, setIsDeleting] = useState(false);
  const { mutateAsync: deleteTeam } = useDeleteTeam();
  // The preview stops once the delete is under way: the team hint the
  // delete emits would otherwise refetch the impact of a team that is gone.
  const { impact } = useTeamDeletionImpact(team.id, open && !isDeleting);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteTeam({ organizationId, teamId: team.id });
      toast({
        title: tSettings('teams.teamDeleted'),
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.teamDeleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const widened =
    impact === undefined
      ? 0
      : impact.projects.becomeOrgWide +
        impact.folders.becomeOrgWide +
        impact.documents.becomeOrgWide;

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tSettings('teams.deleteTeam')}
      description={
        <span className="block space-y-2">
          <span className="block">
            {tSettings('teams.deleteConfirmation', { name: team.name })}
          </span>
          {impact !== undefined ? (
            <span className="block">
              {tSettings('teams.deleteImpact.summary', {
                members: impact.memberCount,
                projects: impact.projects.scoped,
                folders: impact.folders.scoped,
                documents: impact.documents.scoped,
                conversations: impact.conversations.queued,
              })}
            </span>
          ) : null}
          {widened > 0 ? (
            <span className="block font-medium">
              {tSettings('teams.deleteImpact.becomeOrgWide', {
                count: widened,
              })}
            </span>
          ) : null}
        </span>
      }
      deleteText={tCommon('actions.delete')}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
    />
  );
}
