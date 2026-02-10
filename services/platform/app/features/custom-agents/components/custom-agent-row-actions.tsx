'use client';

import { Trash2, Copy, History } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

import { useDuplicateCustomAgent } from '../hooks/use-custom-agent-mutations';
import { CustomAgentDeleteDialog } from './custom-agent-delete-dialog';
import { CustomAgentVersionHistoryDialog } from './custom-agent-version-history-dialog';

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
    includeOrgKnowledge?: boolean;
    knowledgeTopK?: number;
    versionNumber: number;
    rootVersionId?: string;
    teamId?: string;
    sharedWithTeamIds?: string[];
  };
}

export function CustomAgentRowActions({ agent }: CustomAgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('settings');
  const dialogs = useEntityRowDialogs(['delete', 'versions']);
  const duplicateAgent = useDuplicateCustomAgent();
  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      await duplicateAgent({ customAgentId: toId<'customAgents'>(agent._id) });
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

      <CustomAgentDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        agent={agent}
      />

      <CustomAgentVersionHistoryDialog
        open={dialogs.isOpen.versions}
        onOpenChange={dialogs.setOpen.versions}
        customAgentId={agent.rootVersionId ?? agent._id}
      />
    </>
  );
}
