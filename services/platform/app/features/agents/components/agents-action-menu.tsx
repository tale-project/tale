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

import { useInstallCatalogAgent, useSaveAgent } from '../hooks/mutations';
import { useListAgents } from '../hooks/queries';
import { CreateAgentDialog } from './agent-create-dialog';

interface AgentsActionMenuProps {
  organizationId: string;
  /**
   * Optionally lift the create-dialog open state so another trigger (e.g. the
   * list's empty-state CTA) can open the same dialog. Falls back to internal
   * state when not provided.
   */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  /** Page-specific items appended after the create items (e.g. catalog sync). */
  extraMenuItems?: DataTableActionMenuItem[];
}

export function AgentsActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
  extraMenuItems,
}: AgentsActionMenuProps) {
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? internalCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setInternalCreateOpen;
  const [uploadOpen, setUploadOpen] = useState(false);
  const { t } = useT('settings');
  const { mutateAsync: saveAgent } = useSaveAgent();
  const { mutateAsync: installAgent } = useInstallCatalogAgent();
  const { agents } = useListAgents(organizationId);
  const existingNames = useMemo(
    () => collectStringField(agents, 'name'),
    [agents],
  );

  const menuItems = useMemo<DataTableActionMenuItem[]>(
    () => [
      {
        label: t('agents.createMenu.blank'),
        icon: Plus,
        onClick: () => setCreateOpen(true),
      },
      {
        label: t('agents.uploadDialog.menuItem'),
        icon: Upload,
        onClick: () => setUploadOpen(true),
      },
      ...(extraMenuItems ?? []),
    ],
    [t, setCreateOpen, extraMenuItems],
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
            organizationId,
            agentName: entry.baseName,
            isNew: !overwrite,
            config: entry.json,
          });
          // Install (enable) the uploaded agent so it appears in the
          // installed-only Agents list — the config file is the source, the
          // install record makes it live (same pairing as Blank create). A
          // failure (e.g. non-admin) leaves the file in place to install later.
          try {
            await installAgent({ organizationId, agentSlug: entry.baseName });
          } catch (installErr) {
            console.warn(
              '[AgentsActionMenu] agent uploaded but auto-install failed',
              installErr,
            );
          }
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
