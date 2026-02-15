'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { TeamCreateDialog } from './team-create-dialog';

interface TeamsActionMenuProps {
  organizationId: string;
}

export function TeamsActionMenu({ organizationId }: TeamsActionMenuProps) {
  const { t: tSettings } = useT('settings');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <>
      <DataTableActionMenu
        label={tSettings('teams.createTeam')}
        icon={Plus}
        onClick={() => setIsCreateDialogOpen(true)}
      />
      <TeamCreateDialog
        organizationId={organizationId}
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </>
  );
}
