'use client';

import { LayoutTemplate, Plus, Sparkles, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { UploadConfigsDialog } from '@/app/features/shared/upload-configs/upload-configs-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useInstallWorkflow,
  useInvalidateWorkflows,
  useSaveWorkflow,
} from '../hooks/file-mutations';
import { CreateAutomationDialog } from './automation-create-dialog';

export interface AutomationsActionMenuProps {
  organizationId: string;
  /** Whether to show the AI variant (for empty state) or the simple create variant */
  variant?: 'create' | 'ai';
}

export function AutomationsActionMenu({
  organizationId,
  variant = 'create',
}: AutomationsActionMenuProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createTab, setCreateTab] = useState<'blank' | 'template'>('blank');
  const [uploadOpen, setUploadOpen] = useState(false);
  const { t: tAutomations } = useT('automations');

  const { mutateAsync: saveWorkflow } = useSaveWorkflow();
  const { mutateAsync: installWorkflow } = useInstallWorkflow();
  const invalidateWorkflows = useInvalidateWorkflows();

  const menuItems = useMemo<DataTableActionMenuItem[]>(
    () => [
      {
        label: tAutomations('createDialog.tabBlank'),
        icon: Plus,
        onClick: () => {
          setCreateTab('blank');
          setCreateOpen(true);
        },
      },
      {
        label: tAutomations('createDialog.tabTemplate'),
        icon: LayoutTemplate,
        onClick: () => {
          setCreateTab('template');
          setCreateOpen(true);
        },
      },
      {
        label: tAutomations('uploadDialog.menuItem'),
        icon: Upload,
        onClick: () => setUploadOpen(true),
      },
    ],
    [tAutomations],
  );

  return (
    <>
      <DataTableActionMenu
        label={
          variant === 'ai'
            ? tAutomations('createWithAI')
            : tAutomations('createButton')
        }
        icon={variant === 'ai' ? Sparkles : Plus}
        menuItems={menuItems}
      />
      <CreateAutomationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        defaultTab={createTab}
      />
      <UploadConfigsDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title={tAutomations('uploadDialog.title')}
        description={tAutomations('uploadDialog.description')}
        onSaveOne={async (entry) => {
          const workflowSlug = entry.relPath
            .replace(/\.json$/i, '')
            .replace(/\\/g, '/');
          const config = withFallbackName(entry.json, entry.baseName);
          await saveWorkflow({
            organizationId,
            workflowSlug,
            config,
          });
          await installWorkflow({ organizationId, workflowSlug });
        }}
        onAfterAllSaved={() => {
          void invalidateWorkflows(organizationId);
          window.dispatchEvent(new Event('workflow-updated'));
          toast({
            title: tAutomations('uploadDialog.toastSuccess'),
            variant: 'success',
          });
        }}
      />
    </>
  );
}

function withFallbackName(json: unknown, fallback: string): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const obj: Record<string, unknown> = { ...json };
  const existing = obj.name;
  if (typeof existing === 'string' && existing.trim().length > 0) return obj;
  obj.name = fallback;
  return obj;
}
