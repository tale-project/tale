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
import { useListWorkflows } from '../hooks/file-queries';
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
  const { workflows } = useListWorkflows(organizationId);
  const existingSlugs = useMemo(
    () => collectStringField(workflows, 'slug'),
    [workflows],
  );

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
        existingKeys={existingSlugs}
        getKey={(entry) => relPathToWorkflowSlug(entry.relPath)}
        onSaveOne={async (entry, { overwrite }) => {
          const workflowSlug = relPathToWorkflowSlug(entry.relPath);
          const config = withFallbackName(entry.json, entry.baseName);
          await saveWorkflow({
            organizationId,
            workflowSlug,
            // Only overwrite a colliding workflow when the user explicitly
            // opted in (the dialog's overwrite toggle); otherwise create-only
            // so a non-conflicting import can't clobber an existing slug.
            // Mirrors the agents upload path.
            isNew: !overwrite,
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

/**
 * Workflow slug for an uploaded file: drop the `.json` extension and normalize
 * Windows path separators to `/`. Used both to dedupe against existing slugs
 * (`getKey`) and as the save target, so the two must agree.
 */
function relPathToWorkflowSlug(relPath: string): string {
  return relPath.replace(/\.json$/i, '').replace(/\\/g, '/');
}

function withFallbackName(json: unknown, fallback: string): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const obj: Record<string, unknown> = { ...json };
  const existing = obj.name;
  if (typeof existing === 'string' && existing.trim().length > 0) return obj;
  obj.name = fallback;
  return obj;
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
