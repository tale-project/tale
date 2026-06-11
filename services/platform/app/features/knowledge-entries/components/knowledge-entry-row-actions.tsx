'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { DeleteKnowledgeEntryDialog } from './knowledge-entry-delete-dialog';
import { EditKnowledgeEntryDialog } from './knowledge-entry-edit-dialog';

interface KnowledgeEntryRowActionsProps {
  entry: KnowledgeEntryItem;
}

export function KnowledgeEntryRowActions({
  entry,
}: KnowledgeEntryRowActionsProps) {
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
        <EditKnowledgeEntryDialog
          isOpen={dialogs.isOpen.edit}
          onClose={() => dialogs.setOpen.edit(false)}
          entry={entry}
        />
      )}

      {dialogs.isOpen.delete && (
        <DeleteKnowledgeEntryDialog
          isOpen={dialogs.isOpen.delete}
          onClose={() => dialogs.setOpen.delete(false)}
          entry={entry}
        />
      )}
    </>
  );
}
