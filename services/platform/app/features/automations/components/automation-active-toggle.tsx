'use client';

import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useRepublishAutomation } from '../hooks/use-republish-automation';
import { useUnpublishAutomation } from '../hooks/use-unpublish-automation';

interface AutomationActiveToggleProps {
  automation: Doc<'wfDefinitions'>;
  label?: string;
}

export function AutomationActiveToggle({
  automation,
  label,
}: AutomationActiveToggleProps) {
  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { user } = useAuth();

  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const republishAutomation = useRepublishAutomation();
  const unpublishAutomation = useUnpublishAutomation();

  const isActive = automation.status === 'active';
  const isDraft = automation.status === 'draft';

  const handleActivate = useCallback(async () => {
    if (!user) return;
    setIsToggling(true);
    try {
      await republishAutomation({
        wfDefinitionId: automation._id,
        publishedBy: user.email ?? user.userId,
      });
      toast({
        title: tToast('success.automationPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to activate automation:', error);
      toast({
        title: tToast('error.automationPublishFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsToggling(false);
    }
  }, [republishAutomation, automation._id, user, tToast]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!user) return;
    setIsToggling(true);
    try {
      await unpublishAutomation({
        wfDefinitionId: automation._id,
        updatedBy: user.userId,
      });
      setShowDeactivateDialog(false);
      toast({
        title: tToast('success.automationDeactivated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to deactivate automation:', error);
      toast({
        title: tToast('error.automationDeactivateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsToggling(false);
    }
  }, [unpublishAutomation, automation._id, user, tToast]);

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
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <Switch
          checked={isActive}
          onCheckedChange={handleToggle}
          disabled={isDraft || isToggling}
          label={label}
          aria-label={tAutomations('activeToggle.ariaLabel')}
        />
      </div>

      <ConfirmDialog
        open={showDeactivateDialog}
        onOpenChange={setShowDeactivateDialog}
        title={tAutomations('deactivateDialog.title')}
        description={tAutomations('deactivateDialog.description', {
          name: automation.name,
        })}
        confirmText={tCommon('actions.deactivate')}
        loadingText={tCommon('actions.deactivating')}
        isLoading={isToggling}
        onConfirm={handleDeactivateConfirm}
      />
    </>
  );
}
