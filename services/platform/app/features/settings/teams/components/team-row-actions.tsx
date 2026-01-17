'use client';

import { useMemo } from 'react';
import { Pencil, Trash2, Users } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { TeamEditDialog } from './team-edit-dialog';
import { TeamDeleteDialog } from './team-delete-dialog';
import { TeamMembersDialog } from './team-members-dialog';
import { useT } from '@/lib/i18n/client';
import type { Team } from '../hooks/use-list-teams';

interface TeamRowActionsProps {
  team: Team;
  organizationId: string;
}

export function TeamRowActions({ team, organizationId }: TeamRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tSettings } = useT('settings');
  const dialogs = useEntityRowDialogs(['edit', 'delete', 'members']);

  const actions = useMemo(
    () => [
      {
        key: 'members',
        label: tSettings('teams.manageMembers'),
        icon: Users,
        onClick: dialogs.open.members,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
      },
    ],
    [tCommon, tSettings, dialogs.open],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <TeamMembersDialog
        open={dialogs.isOpen.members}
        onOpenChange={dialogs.setOpen.members}
        team={team}
        organizationId={organizationId}
      />

      <TeamEditDialog
        open={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        team={team}
      />

      <TeamDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        team={team}
      />
    </>
  );
}
