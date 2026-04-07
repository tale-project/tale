'use client';

import { Copy, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { PROTECTED_AGENT_NAMES } from '@/lib/shared/constants/agents';

import { useDuplicateAgent } from '../hooks/mutations';
import { AgentDeleteDialog } from './agent-delete-dialog';

interface AgentRowActionsProps {
  agentName: string;
  onDuplicated?: () => void;
  onDeleted?: () => void;
}

export function AgentRowActions({
  agentName,
  onDuplicated,
  onDeleted,
}: AgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('settings');
  const dialogs = useEntityRowDialogs(['delete']);
  const { mutateAsync: duplicateAgent } = useDuplicateAgent();
  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      await duplicateAgent({
        orgSlug: 'default',
        agentName,
      });
      toast({
        title: t('agents.agentDuplicated'),
        variant: 'success',
      });
      onDuplicated?.();
    } catch (error) {
      console.error(error);
      toast({
        title: t('agents.agentDuplicateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [isDuplicating, duplicateAgent, agentName, t, onDuplicated]);

  const isProtected = (PROTECTED_AGENT_NAMES as readonly string[]).includes(
    agentName,
  );

  const actions = [
    {
      key: 'duplicate',
      label: tCommon('duplicate'),
      icon: Copy,
      onClick: () => void handleDuplicate(),
    },
    {
      key: 'delete',
      label: tCommon('delete'),
      icon: Trash2,
      destructive: true,
      visible: !isProtected,
      onClick: () => dialogs.open.delete(),
    },
  ];

  return (
    <>
      <EntityRowActions actions={actions} />

      <AgentDeleteDialog
        agentName={agentName}
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onDeleted={onDeleted}
      />
    </>
  );
}
