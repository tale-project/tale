'use client';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import { Eye, Pencil, Play, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useResumeScanning } from '../hooks/mutations';
import { isScanPaused } from '../lib/scan-paused';
import { WebsiteDeleteDialog } from './website-delete-dialog';
import { WebsiteEditDialog } from './website-edit-dialog';
import { WebsiteViewDialog } from './website-view-dialog';

interface WebsiteRowActionsProps {
  website: WebsiteDoc;
}

export function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('websites');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  // Dialogs opened from the menu return focus to its trigger: the menu item
  // that opened them is gone by the time they close.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);
  const { mutate: resumeScanning } = useResumeScanning();
  const paused = isScanPaused(website);

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
        // Only offered while the crawler has paused this site (repeated
        // failures to reach the knowledge database): clears the pause and
        // starts a scan right away, so the fix is verified immediately.
        key: 'resume',
        label: t('resumeScanning'),
        icon: Play,
        onClick: () => resumeScanning({ websiteId: website._id }),
        visible: canWrite && paused,
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
    [tCommon, t, dialogs.open, canWrite, paused, resumeScanning, website._id],
  );

  return (
    <>
      <EntityRowActions actions={actions} triggerRef={menuTriggerRef} />

      {dialogs.isOpen.view && (
        <WebsiteViewDialog
          isOpen
          onClose={() => dialogs.setOpen.view(false)}
          restoreFocusRef={menuTriggerRef}
          website={website}
        />
      )}

      {dialogs.isOpen.edit && (
        <WebsiteEditDialog
          isOpen
          onClose={() => dialogs.setOpen.edit(false)}
          restoreFocusRef={menuTriggerRef}
          website={website}
        />
      )}

      {dialogs.isOpen.delete && (
        <WebsiteDeleteDialog
          isOpen
          onClose={() => dialogs.setOpen.delete(false)}
          restoreFocusRef={menuTriggerRef}
          website={website}
        />
      )}
    </>
  );
}
