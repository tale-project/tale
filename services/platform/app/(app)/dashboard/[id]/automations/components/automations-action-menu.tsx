'use client';

import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { DataTableActionMenu } from '@/components/ui/data-table';
import CreateAutomationDialog from './create-automation-dialog';
import { useT } from '@/lib/i18n';

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
