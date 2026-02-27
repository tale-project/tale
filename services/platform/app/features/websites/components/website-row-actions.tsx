'use client';

import { Eye, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { DeleteWebsiteDialog } from './website-delete-dialog';
import { EditWebsiteDialog } from './website-edit-dialog';
import { ViewWebsiteDialog } from './website-view-dialog';

interface WebsiteRowActionsProps {
  website: Doc<'websites'>;
}

export function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCommon('actions.view'),
        icon: Eye,
        onClick: dialogs.open.view,
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
    [tCommon, dialogs.open],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      {dialogs.isOpen.view && (
        <ViewWebsiteDialog
          isOpen={dialogs.isOpen.view}
          onClose={() => dialogs.setOpen.view(false)}
          website={website}
        />
      )}

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
