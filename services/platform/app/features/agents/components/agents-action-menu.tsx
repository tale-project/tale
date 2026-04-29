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
import { useListAgents } from '../hooks/queries';
import { CreateAgentDialog } from './agent-create-dialog';

interface AgentsActionMenuProps {
  organizationId: string;
}

export function AgentsActionMenu({ organizationId }: AgentsActionMenuProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { t } = useT('settings');
  const { mutateAsync: saveAgent } = useSaveAgent();
  const { agents } = useListAgents('default');
  const existingNames = useMemo(
    () => collectStringField(agents, 'name'),
    [agents],
  );

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
        existingKeys={existingNames}
        getKey={(entry) => entry.baseName}
        onSaveOne={async (entry, { overwrite }) => {
          await saveAgent({
            orgSlug: 'default',
            agentName: entry.baseName,
            isNew: !overwrite,
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

function collectStringField(items: unknown, field: string): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(items)) return set;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const [k, v] of Object.entries(item)) {
      if (k === field && typeof v === 'string' && v.length > 0) set.add(v);
    }
  }
  return set;
}
