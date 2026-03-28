'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { CreateAgentDialog } from './agent-create-dialog';

interface AgentsActionMenuProps {
  organizationId: string;
}

export function AgentsActionMenu({ organizationId }: AgentsActionMenuProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { t } = useT('settings');

  return (
    <>
      <DataTableActionMenu
        label={t('agents.createAgent')}
        icon={Plus}
        onClick={() => setCreateDialogOpen(true)}
      />
      <CreateAgentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        organizationId={organizationId}
      />
    </>
  );
}
