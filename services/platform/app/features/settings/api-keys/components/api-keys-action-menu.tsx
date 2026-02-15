'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { ApiKeyCreateDialog } from './api-key-create-dialog';

interface ApiKeysActionMenuProps {
  organizationId: string;
}

export function ApiKeysActionMenu({ organizationId }: ApiKeysActionMenuProps) {
  const { t: tSettings } = useT('settings');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <>
      <DataTableActionMenu
        label={tSettings('apiKeys.createKey')}
        icon={Plus}
        onClick={() => setIsCreateDialogOpen(true)}
      />
      <ApiKeyCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        organizationId={organizationId}
      />
    </>
  );
}
