'use client';

import { Plus, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { UploadConfigsDialog } from '@/app/features/shared/upload-configs/upload-configs-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveAgent } from '../hooks/mutations';
import { CreateAgentDialog } from './agent-create-dialog';

interface AgentsActionMenuProps {
  organizationId: string;
}

export function AgentsActionMenu({ organizationId }: AgentsActionMenuProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { t } = useT('settings');
  const { mutateAsync: saveAgent } = useSaveAgent();

  const menuItems = useMemo<DataTableActionMenuItem[]>(
    () => [
      {
        label: t('agents.createAgent'),
        icon: Plus,
        onClick: () => setCreateOpen(true),
      },
      {
        label: t('agents.uploadDialog.menuItem'),
        icon: Upload,
        onClick: () => setUploadOpen(true),
      },
    ],
    [t],
  );

  return (
    <>
      <DataTableActionMenu
        label={t('agents.createAgent')}
        icon={Plus}
        menuItems={menuItems}
      />
      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
      <UploadConfigsDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title={t('agents.uploadDialog.title')}
        description={t('agents.uploadDialog.description')}
        onSaveOne={async (entry) => {
          await saveAgent({
            orgSlug: 'default',
            agentName: entry.baseName,
            isNew: true,
            config: entry.json,
            organizationId,
          });
        }}
        onAfterAllSaved={() => {
          toast({
            title: t('agents.uploadDialog.toastSuccess'),
            variant: 'success',
          });
        }}
      />
    </>
  );
}
