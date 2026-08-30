'use client';

import { Pencil, Play, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useResumeScanning } from '../hooks/mutations';
import { isScanPaused } from '../lib/scan-paused';
import { DeleteWebsiteDialog } from './website-delete-dialog';
import { EditWebsiteDialog } from './website-edit-dialog';

interface WebsiteRowActionsProps {
  website: WebsiteDoc;
}

export function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('websites');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);
  const { mutate: resumeScanning } = useResumeScanning();
  const paused = isScanPaused(website);

  const actions = useMemo(
    () => [
      // Only offered while the crawler has paused this site (repeated
      // failures to reach the knowledge database): clears the pause and
      // starts a scan right away, so the fix is verified immediately.
      ...(paused
        ? [
            {
              key: 'resume',
              label: t('resumeScanning'),
              icon: Play,
              onClick: () => resumeScanning({ websiteId: website._id }),
            },
          ]
        : []),
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
    [tCommon, t, dialogs.open, paused, resumeScanning, website._id],
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
