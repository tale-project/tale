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
  useUnpublishCustomAgent,
} from '../hooks/use-custom-agent-mutations';

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
  const [isToggling, setIsToggling] = useState(false);

  const activateVersion = useActivateCustomAgentVersion();
  const unpublishAgent = useUnpublishCustomAgent();

  const rootId = agent.rootVersionId ?? agent._id;
  const isActive = agent.status === 'active';
  const isDraft = agent.status === 'draft';

  const handleActivate = useCallback(async () => {
    setIsToggling(true);
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
      console.error('Failed to activate agent:', error);
      toast({
        title: t('customAgents.agentPublishFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsToggling(false);
    }
  }, [activateVersion, rootId, agent.versionNumber, t]);

  const handleDeactivateConfirm = useCallback(async () => {
    setIsToggling(true);
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
    } finally {
      setIsToggling(false);
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
        disabled={isDraft || isToggling}
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
