'use client';

import { useCallback, useMemo, useState } from 'react';
import { Pencil, Trash2, Copy, History } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { CustomAgentEditDialog } from './custom-agent-edit-dialog';
import { CustomAgentDeleteDialog } from './custom-agent-delete-dialog';
import { CustomAgentVersionHistoryDialog } from './custom-agent-version-history-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useDuplicateCustomAgent } from '../hooks/use-custom-agent-mutations';

interface CustomAgentRowActionsProps {
  agent: {
    _id: string;
    name: string;
    displayName: string;
    description?: string;
    systemInstructions: string;
    toolNames: string[];
    modelPreset: string;
    temperature?: number;
    maxTokens?: number;
    maxSteps?: number;
    includeKnowledge: boolean;
    knowledgeTopK?: number;
    currentVersion: number;
    teamId?: string;
    sharedWithTeamIds?: string[];
  };
}

export function CustomAgentRowActions({ agent }: CustomAgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('settings');
  const dialogs = useEntityRowDialogs(['edit', 'delete', 'versions']);
  const duplicateAgent = useDuplicateCustomAgent();
  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      await duplicateAgent({ customAgentId: agent._id as any });
      toast({
        title: t('customAgents.agentDuplicated'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentDuplicateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [isDuplicating, duplicateAgent, agent._id, t]);

  const actions = useMemo(
    () => [
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
      },
      {
        key: 'duplicate',
        label: t('customAgents.duplicateAgent'),
        icon: Copy,
        onClick: handleDuplicate,
        disabled: isDuplicating,
      },
      {
        key: 'versions',
        label: t('customAgents.versionHistory'),
        icon: History,
        onClick: dialogs.open.versions,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        separator: true,
      },
    ],
    [tCommon, t, dialogs.open, handleDuplicate, isDuplicating],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <CustomAgentEditDialog
        open={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        agent={agent}
      />

      <CustomAgentDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        agent={agent}
      />

      <CustomAgentVersionHistoryDialog
        open={dialogs.isOpen.versions}
        onOpenChange={dialogs.setOpen.versions}
        customAgentId={agent._id}
        currentVersion={agent.currentVersion}
      />
    </>
  );
}
