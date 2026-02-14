'use client';

import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useRepublishAutomation,
  useUnpublishAutomation,
} from '../hooks/mutations';

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

  const { mutate: republishAutomation, isPending: isRepublishing } =
    useRepublishAutomation();
  const { mutate: unpublishAutomation, isPending: isUnpublishing } =
    useUnpublishAutomation();

  const isToggling = isRepublishing || isUnpublishing;

  const isActive = automation.status === 'active';
  const isDraft = automation.status === 'draft';

  const handleActivate = useCallback(() => {
    if (!user) return;
    republishAutomation(
      {
        wfDefinitionId: automation._id,
        publishedBy: user.email ?? user.userId,
      },
      {
        onSuccess: () => {
          toast({
            title: tToast('success.automationPublished'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to activate automation:', error);
          toast({
            title: tToast('error.automationPublishFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [republishAutomation, automation._id, user, tToast]);

  const handleDeactivateConfirm = useCallback(() => {
    if (!user) return;
    unpublishAutomation(
      {
        wfDefinitionId: automation._id,
        updatedBy: user.userId,
      },
      {
        onSuccess: () => {
          setShowDeactivateDialog(false);
          toast({
            title: tToast('success.automationDeactivated'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to deactivate automation:', error);
          toast({
            title: tToast('error.automationDeactivateFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [unpublishAutomation, automation._id, user, tToast]);

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
