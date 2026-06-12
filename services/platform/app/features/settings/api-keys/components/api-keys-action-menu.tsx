'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { ApiKeyCreateDialog } from './api-key-create-dialog';

interface ApiKeysActionMenuProps {
  organizationId: string;
  /** Optionally lift create-dialog state so the list's empty-state CTA can open it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function ApiKeysActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: ApiKeysActionMenuProps) {
  const { t: tSettings } = useT('settings');
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const isCreateDialogOpen = controlledCreateOpen ?? internalCreateOpen;
  const setIsCreateDialogOpen = onCreateOpenChange ?? setInternalCreateOpen;

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
