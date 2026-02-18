'use client';

import { CircleStop, Copy, Play, Trash2, Upload } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import type { CustomAgentRow } from './custom-agent-table';

import {
  useActivateCustomAgentVersion,
  useDuplicateCustomAgent,
  usePublishCustomAgent,
  useUnpublishCustomAgent,
} from '../hooks/mutations';
import { CustomAgentDeleteDialog } from './custom-agent-delete-dialog';

interface CustomAgentRowActionsProps {
  agent: Pick<
    CustomAgentRow,
    '_id' | 'displayName' | 'rootVersionId' | 'status' | 'versionNumber'
  >;
}

export function CustomAgentRowActions({ agent }: CustomAgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('settings');
  const dialogs = useEntityRowDialogs(['delete', 'deactivate']);
  const { mutate: duplicateAgent, isPending: isDuplicating } =
    useDuplicateCustomAgent();
  const { mutate: publishAgent, isPending: isPublishing } =
    usePublishCustomAgent();
  const { mutate: unpublishAgent, isPending: isDeactivating } =
    useUnpublishCustomAgent();
  const { mutate: activateVersion, isPending: isActivating } =
    useActivateCustomAgentVersion();

  const rootId = agent.rootVersionId ?? agent._id;

  const handleDuplicate = useCallback(() => {
    if (isDuplicating) return;
    duplicateAgent(
      { customAgentId: toId<'customAgents'>(agent._id) },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.agentDuplicated'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentDuplicateFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [isDuplicating, duplicateAgent, agent._id, t]);

  const handlePublish = useCallback(() => {
    if (isPublishing) return;
    publishAgent(
      { customAgentId: toId<'customAgents'>(rootId) },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.agentPublished'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentPublishFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [isPublishing, publishAgent, rootId, t]);

  const handleDeactivateConfirm = useCallback(() => {
    unpublishAgent(
      { customAgentId: toId<'customAgents'>(rootId) },
      {
        onSuccess: () => {
          dialogs.setOpen.deactivate(false);
          toast({
            title: t('customAgents.agentDeactivated'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentDeactivateFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [unpublishAgent, rootId, dialogs.setOpen, t]);

  const handleActivate = useCallback(() => {
    if (isActivating) return;
    activateVersion(
      {
        customAgentId: toId<'customAgents'>(rootId),
        targetVersion: agent.versionNumber,
      },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.agentPublished'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentPublishFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [isActivating, activateVersion, rootId, agent.versionNumber, t]);

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
        key: 'publish',
        label: tCommon('actions.publish'),
        icon: Upload,
        onClick: handlePublish,
        visible: agent.status === 'draft',
        disabled: isPublishing,
      },
      {
        key: 'activate',
        label: tCommon('actions.activate'),
        icon: Play,
        onClick: handleActivate,
        visible: agent.status === 'archived',
        disabled: isActivating,
      },
      {
        key: 'deactivate',
        label: tCommon('actions.deactivate'),
        icon: CircleStop,
        onClick: dialogs.open.deactivate,
        visible: agent.status === 'active',
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
    [
      tCommon,
      t,
      dialogs.open,
      handleDuplicate,
      handlePublish,
      handleActivate,
      isDuplicating,
      isPublishing,
      isActivating,
      agent.status,
    ],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <CustomAgentDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        agent={agent}
      />

      <ConfirmDialog
        open={dialogs.isOpen.deactivate}
        onOpenChange={dialogs.setOpen.deactivate}
        title={t('customAgents.deactivateDialog.title')}
        description={t('customAgents.deactivateDialog.description', {
          name: agent.displayName,
        })}
        confirmText={tCommon('actions.deactivate')}
        loadingText={tCommon('actions.deactivating')}
        isLoading={isDeactivating}
        onConfirm={handleDeactivateConfirm}
      />
    </>
  );
}
