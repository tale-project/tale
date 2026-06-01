'use client';

import { useNavigate } from '@tanstack/react-router';
import { Copy, Pencil, Trash2 } from 'lucide-react';
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
  organizationId: string;
  onDuplicated?: (newAgentName: string) => void;
  onDeleted?: () => void;
}

export function AgentRowActions({
  agentName,
  organizationId,
  onDuplicated,
  onDeleted,
}: AgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('settings');
  const navigate = useNavigate();
  const dialogs = useEntityRowDialogs(['delete']);
  const { mutateAsync: duplicateAgent } = useDuplicateAgent();
  const [isDuplicating, setIsDuplicating] = useState(false);

  // U1: Rename navigates to the agent's general settings page where the
  // displayName field lives. A dedicated rename mutation isn't worth the
  // complexity for the per-locale `displayName` shape; the focused edit
  // page lets the user rename in any locale.
  const handleRename = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/agents/$agentId',
      params: { id: organizationId, agentId: agentName },
    });
  }, [navigate, organizationId, agentName]);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newAgentName } = await duplicateAgent({
        organizationId,
        agentName,
      });
      toast({
        title: t('agents.agentDuplicated'),
        variant: 'success',
      });
      onDuplicated?.(newAgentName);
    } catch (error) {
      console.error(error);
      toast({
        title: t('agents.agentDuplicateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [
    isDuplicating,
    duplicateAgent,
    agentName,
    organizationId,
    t,
    onDuplicated,
  ]);

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
      key: 'rename',
      label: tCommon('rename'),
      icon: Pencil,
      onClick: handleRename,
      visible: !isProtected,
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
        organizationId={organizationId}
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onDeleted={onDeleted}
      />
    </>
  );
}
