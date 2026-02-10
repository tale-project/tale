'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { CreateCustomAgentDialog } from './custom-agent-create-dialog';

interface CustomAgentsActionMenuProps {
  organizationId: string;
}

export function CustomAgentsActionMenu({
  organizationId,
}: CustomAgentsActionMenuProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { t } = useT('settings');

  return (
    <>
      <DataTableActionMenu
        label={t('customAgents.createAgent')}
        icon={Plus}
        onClick={() => setCreateDialogOpen(true)}
      />
      <CreateCustomAgentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        organizationId={organizationId}
      />
    </>
  );
}
