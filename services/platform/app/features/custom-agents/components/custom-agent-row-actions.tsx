'use client';

import type { Collection } from '@tanstack/db';

import { CircleStop, Copy, Play, Trash2, Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { CustomAgent } from '@/lib/collections/entities/custom-agents';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

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
  collection: Collection<CustomAgent, string>;
}

export function CustomAgentRowActions({
  agent,
  collection,
}: CustomAgentRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('settings');
  const dialogs = useEntityRowDialogs(['delete', 'deactivate']);
  const duplicateAgent = useDuplicateCustomAgent();
  const publishAgent = usePublishCustomAgent();
  const unpublishAgent = useUnpublishCustomAgent();
  const activateVersion = useActivateCustomAgentVersion();
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const rootId = agent.rootVersionId ?? agent._id;

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

  const handlePublish = useCallback(async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    try {
      await publishAgent({
        customAgentId: toId<'customAgents'>(rootId),
      });
      toast({
        title: t('customAgents.agentPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentPublishFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  }, [isPublishing, publishAgent, rootId, t]);

  const handleDeactivateConfirm = useCallback(async () => {
    setIsDeactivating(true);
    try {
      await unpublishAgent({
        customAgentId: toId<'customAgents'>(rootId),
      });
      dialogs.setOpen.deactivate(false);
      toast({
        title: t('customAgents.agentDeactivated'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentDeactivateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeactivating(false);
    }
  }, [unpublishAgent, rootId, dialogs.setOpen, t]);

  const handleActivate = useCallback(async () => {
    if (isActivating) return;
    setIsActivating(true);
    try {
      await activateVersion({
        customAgentId: toId<'customAgents'>(rootId),
        targetVersion: agent.versionNumber,
      });
      toast({
        title: t('customAgents.agentPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentPublishFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsActivating(false);
    }
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
        collection={collection}
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
