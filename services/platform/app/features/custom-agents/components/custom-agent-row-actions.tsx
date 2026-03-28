'use client';

import { Trash2 } from 'lucide-react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useT } from '@/lib/i18n/client';

import { CustomAgentDeleteDialog } from './custom-agent-delete-dialog';

interface CustomAgentRowActionsProps {
  agentName: string;
  displayName: string;
}

export function CustomAgentRowActions({
  agentName,
  displayName,
}: CustomAgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete']);

  const actions = [
    {
      key: 'delete',
      label: tCommon('delete'),
      icon: Trash2,
      destructive: true,
      onClick: () => dialogs.open.delete(),
    },
  ];

  return (
    <>
      <EntityRowActions actions={actions} />

      <CustomAgentDeleteDialog
        agentName={agentName}
        displayName={displayName}
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
      />
    </>
  );
}
