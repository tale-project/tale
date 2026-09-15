'use client';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryDeleteDialog } from './knowledge-entry-delete-dialog';
import { KnowledgeEntryEditDialog } from './knowledge-entry-edit-dialog';
import { KnowledgeEntryViewDialog } from './knowledge-entry-view-dialog';

interface KnowledgeEntryRowActionsProps {
  entry: KnowledgeEntryItem;
}

export function KnowledgeEntryRowActions({
  entry,
}: KnowledgeEntryRowActionsProps) {
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  // Dialogs opened from the menu return focus to its trigger: the menu item
  // that opened them is gone by the time they close.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
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
        visible: canWrite,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: canWrite,
      },
    ],
    [tCommon, dialogs.open, canWrite],
  );

  return (
    <>
      <EntityRowActions actions={actions} triggerRef={menuTriggerRef} />

      {dialogs.isOpen.view && (
        <KnowledgeEntryViewDialog
          isOpen
          onClose={() => dialogs.setOpen.view(false)}
          restoreFocusRef={menuTriggerRef}
          entry={entry}
        />
      )}

      {dialogs.isOpen.edit && (
        <KnowledgeEntryEditDialog
          isOpen
          onClose={() => dialogs.setOpen.edit(false)}
          restoreFocusRef={menuTriggerRef}
          entry={entry}
        />
      )}

      {dialogs.isOpen.delete && (
        <KnowledgeEntryDeleteDialog
          isOpen
          onClose={() => dialogs.setOpen.delete(false)}
          restoreFocusRef={menuTriggerRef}
          entry={entry}
        />
      )}
    </>
  );
}
