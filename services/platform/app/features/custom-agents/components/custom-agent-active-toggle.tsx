'use client';

import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

import type { CustomAgentRow } from './custom-agent-table';

import {
  useActivateCustomAgentVersion,
  usePublishCustomAgent,
  useUnpublishCustomAgent,
} from '../hooks/mutations';

interface CustomAgentActiveToggleProps {
  agent: Pick<
    CustomAgentRow,
    '_id' | 'displayName' | 'rootVersionId' | 'status' | 'versionNumber'
  >;
  label?: string;
}

export function CustomAgentActiveToggle({
  agent,
  label,
}: CustomAgentActiveToggleProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);

  const { mutateAsync: activateVersion, isPending: isActivating } =
    useActivateCustomAgentVersion();
  const { mutateAsync: publishAgent, isPending: isPublishing } =
    usePublishCustomAgent();
  const { mutateAsync: unpublishAgent, isPending: isUnpublishing } =
    useUnpublishCustomAgent();

  const isToggling = isActivating || isPublishing || isUnpublishing;

  const rootId = agent.rootVersionId ?? agent._id;
  const isActive = agent.status === 'active';
  const isUnpublishedDraft =
    agent.status === 'draft' && agent.versionNumber === 1;

  const handleActivate = useCallback(async () => {
    try {
      if (agent.status === 'draft') {
        await publishAgent({
          customAgentId: toId<'customAgents'>(rootId),
        });
      } else {
        await activateVersion({
          customAgentId: toId<'customAgents'>(rootId),
          targetVersion: agent.versionNumber,
        });
      }
      toast({
        title: t('customAgents.agentPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to activate agent:', error);
      toast({
        title: t('customAgents.agentPublishFailed'),
        variant: 'destructive',
      });
    }
  }, [
    activateVersion,
    publishAgent,
    rootId,
    agent.versionNumber,
    agent.status,
    t,
  ]);

  const handleDeactivateConfirm = useCallback(async () => {
    try {
      await unpublishAgent({
        customAgentId: toId<'customAgents'>(rootId),
      });
      setShowDeactivateDialog(false);
      toast({
        title: t('customAgents.agentDeactivated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to deactivate agent:', error);
      toast({
        title: t('customAgents.agentDeactivateFailed'),
        variant: 'destructive',
      });
    }
  }, [unpublishAgent, rootId, t]);

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        void handleActivate();
      } else {
        setShowDeactivateDialog(true);
      }
    },
    [handleActivate],
  );

  return (
    <>
      <Switch
        checked={isActive}
        onCheckedChange={handleToggle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={isUnpublishedDraft || isToggling}
        label={label}
        aria-label={t('customAgents.activeToggle.ariaLabel')}
      />

      <ConfirmDialog
        open={showDeactivateDialog}
        onOpenChange={setShowDeactivateDialog}
        title={t('customAgents.deactivateDialog.title')}
        description={t('customAgents.deactivateDialog.description', {
          name: agent.displayName,
        })}
        confirmText={tCommon('actions.deactivate')}
        loadingText={tCommon('actions.deactivating')}
        isLoading={isToggling}
        onConfirm={handleDeactivateConfirm}
      />
    </>
  );
}
