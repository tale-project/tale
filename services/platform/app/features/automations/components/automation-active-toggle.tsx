'use client';

import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useToggleWorkflowEnabled } from '../hooks/file-mutations';

interface AutomationActiveToggleProps {
  automation: { _id: string; name: string; status: string };
  label?: string;
}

export function AutomationActiveToggle({
  automation,
  label,
}: AutomationActiveToggleProps) {
  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');

  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);

  const { mutate: toggleEnabled, isPending: isToggling } =
    useToggleWorkflowEnabled();

  const isActive = automation.status === 'active';
  const isDraft = automation.status === 'draft';

  const handleActivate = useCallback(async () => {
    try {
      await toggleEnabled({
        orgSlug: 'default',
        workflowSlug: automation._id,
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
    }
  }, [toggleEnabled, automation._id, tToast]);

  const handleDeactivateConfirm = useCallback(async () => {
    try {
      await toggleEnabled({
        orgSlug: 'default',
        workflowSlug: automation._id,
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
    }
  }, [toggleEnabled, automation._id, tToast]);

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
        aria-label={tAutomations('activeToggle.ariaLabel')}
      />

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
