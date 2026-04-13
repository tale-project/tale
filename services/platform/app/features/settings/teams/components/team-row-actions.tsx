'use client';

import { Eye, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useT } from '@/lib/i18n/client';

import type { Team } from '../hooks/queries';
import { TeamDeleteDialog } from './team-delete-dialog';
import { TeamEditDialog } from './team-edit-dialog';

interface TeamRowActionsProps {
  team: Team;
  organizationId: string;
  onView?: () => void;
}

export function TeamRowActions({
  team,
  organizationId,
  onView,
}: TeamRowActionsProps) {
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);
  const [isDeleted, setIsDeleted] = useState(false);

  const handleDeleteSuccess = useCallback(() => setIsDeleted(true), []);

  const actions = useMemo(
    () => [
      ...(onView
        ? [
            {
              key: 'view',
              label: tCommon('actions.view'),
              icon: Eye,
              onClick: onView,
              disabled: isDeleted,
            },
          ]
        : []),
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        disabled: isDeleted,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        disabled: isDeleted,
      },
    ],
    [tCommon, dialogs.open, isDeleted, onView],
  );

  return (
    <>
      <EntityRowActions actions={actions} disabled={isDeleted} />

      <TeamEditDialog
        open={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        team={team}
        organizationId={organizationId}
      />

      <TeamDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        team={team}
        organizationId={organizationId}
        onSuccess={handleDeleteSuccess}
      />
    </>
  );
}
