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
  description?: string;
}

export function CustomAgentActiveToggle({
  agent,
  label,
  description,
}: CustomAgentActiveToggleProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);

  const { mutate: activateVersion, isPending: isActivating } =
    useActivateCustomAgentVersion();
  const { mutate: publishAgent, isPending: isPublishing } =
    usePublishCustomAgent();
  const { mutate: unpublishAgent, isPending: isUnpublishing } =
    useUnpublishCustomAgent();

  const isToggling = isActivating || isPublishing || isUnpublishing;

  const rootId = agent.rootVersionId ?? agent._id;
  const isActive = agent.status === 'active';
  const isUnpublishedDraft =
    agent.status === 'draft' && agent.versionNumber === 1;

  const handleActivate = useCallback(() => {
    const callbacks = {
      onSuccess: () => {
        toast({
          title: t('customAgents.agentPublished'),
          variant: 'success',
        });
      },
      onError: (error: Error) => {
        console.error('Failed to activate agent:', error);
        toast({
          title: t('customAgents.agentPublishFailed'),
          variant: 'destructive',
        });
      },
    };

    if (agent.status === 'draft') {
      publishAgent({ customAgentId: toId<'customAgents'>(rootId) }, callbacks);
    } else {
      activateVersion(
        {
          customAgentId: toId<'customAgents'>(rootId),
          targetVersion: agent.versionNumber,
        },
        callbacks,
      );
    }
  }, [
    activateVersion,
    publishAgent,
    rootId,
    agent.versionNumber,
    agent.status,
    t,
  ]);

  const handleDeactivateConfirm = useCallback(() => {
    unpublishAgent(
      { customAgentId: toId<'customAgents'>(rootId) },
      {
        onSuccess: () => {
          setShowDeactivateDialog(false);
          toast({
            title: t('customAgents.agentDeactivated'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to deactivate agent:', error);
          toast({
            title: t('customAgents.agentDeactivateFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [unpublishAgent, rootId, t]);

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        handleActivate();
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
        description={description}
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
