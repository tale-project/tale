'use client';

import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { CreateAutomationDialog } from './automation-create-dialog';
import { useT } from '@/lib/i18n/client';

export interface AutomationsActionMenuProps {
  organizationId: string;
  /** Whether to show the AI variant (for empty state) or the simple create variant */
  variant?: 'create' | 'ai';
}

export function AutomationsActionMenu({
  organizationId,
  variant = 'create',
}: AutomationsActionMenuProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { t: tAutomations } = useT('automations');

  const handleCreateAutomation = () => {
    setCreateDialogOpen(true);
  };

  return (
    <>
      <DataTableActionMenu
        label={variant === 'ai' ? tAutomations('createWithAI') : tAutomations('createButton')}
        icon={variant === 'ai' ? Sparkles : Plus}
        onClick={handleCreateAutomation}
      />
      <CreateAutomationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        organizationId={organizationId}
      />
    </>
  );
}
