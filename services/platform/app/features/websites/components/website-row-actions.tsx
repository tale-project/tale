'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { DeleteWebsiteDialog } from './website-delete-dialog';
import { EditWebsiteDialog } from './website-edit-dialog';

interface WebsiteRowActionsProps {
  website: Doc<'websites'>;
}

export function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);

  const actions = useMemo(
    () => [
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
    [tCommon, dialogs.open],
  );

  if (!canWrite) return null;

  return (
    <>
      <EntityRowActions actions={actions} />

      {dialogs.isOpen.edit && (
        <EditWebsiteDialog
          isOpen={dialogs.isOpen.edit}
          onClose={() => dialogs.setOpen.edit(false)}
          website={website}
        />
      )}

      {dialogs.isOpen.delete && (
        <DeleteWebsiteDialog
          isOpen={dialogs.isOpen.delete}
          onClose={() => dialogs.setOpen.delete(false)}
          website={website}
        />
      )}
    </>
  );
}
