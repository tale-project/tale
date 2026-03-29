'use client';

import { CircleStop, Upload } from 'lucide-react';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useToggleWorkflowEnabled } from '../hooks/file-mutations';

interface AutomationNavigationProps {
  organizationId: string;
  automationId?: string;
  isEnabled?: boolean;
  isLoading?: boolean;
}

export function AutomationNavigation({
  organizationId,
  automationId,
  isEnabled = false,
  isLoading,
}: AutomationNavigationProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();

  const { mutate: toggleEnabled, isPending: isToggling } =
    useToggleWorkflowEnabled();

  const navigationItems: TabNavigationItem[] = automationId
    ? [
        {
          label: t('navigation.editor'),
          href: `/dashboard/${organizationId}/automations/${automationId}`,
          matchMode: 'exact',
        },
        {
          label: t('executions.title'),
          href: `/dashboard/${organizationId}/automations/${automationId}/executions`,
        },
        {
          label: t('configuration.title'),
          href: `/dashboard/${organizationId}/automations/${automationId}/configuration`,
        },
        {
          label: t('triggers.title'),
          href: `/dashboard/${organizationId}/automations/${automationId}/triggers`,
        },
      ]
    : [];

  if (!automationId) {
    return null;
  }

  const handlePublish = async () => {
    try {
      await toggleEnabled({
        orgSlug: 'default',
        workflowSlug: automationId,
      });
      toast({
        title: t('navigation.toast.published'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to publish automation:', error);
      toast({
        title:
          error instanceof Error
            ? error.message
            : t('navigation.toast.publishFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleUnpublish = async () => {
    try {
      await toggleEnabled({
        orgSlug: 'default',
        workflowSlug: automationId,
      });
      toast({
        title: t('navigation.toast.deactivated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to unpublish automation:', error);
      toast({
        title:
          error instanceof Error
            ? error.message
            : t('navigation.toast.deactivateFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      ariaLabel={tCommon('aria.automationsNavigation')}
    >
      <div className="ml-auto flex items-center gap-2">
        {!isLoading && !isEnabled && (
          <div className="hidden items-center gap-2 md:flex">
            <Button
              onClick={() => void handlePublish()}
              disabled={isToggling}
              size="sm"
            >
              {isToggling
                ? t('navigation.publishing')
                : t('navigation.publish')}
            </Button>
          </div>
        )}

        {!isLoading && isEnabled && (
          <div className="hidden items-center gap-2 md:flex">
            <Button
              onClick={() => void handleUnpublish()}
              disabled={isToggling}
              size="sm"
              variant="secondary"
            >
              <CircleStop className="mr-1.5 size-3.5" aria-hidden="true" />
              {isToggling
                ? tCommon('actions.deactivating')
                : tCommon('actions.deactivate')}
            </Button>
          </div>
        )}

        {!isLoading && (
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={tCommon('aria.actionsMenu')}
              >
                <CircleStop className="size-5" />
              </Button>
            }
            items={[
              [
                ...(!isEnabled
                  ? [
                      {
                        type: 'item' as const,
                        label: isToggling
                          ? t('navigation.publishing')
                          : t('navigation.publish'),
                        icon: Upload,
                        onClick: () => void handlePublish(),
                        disabled: isToggling,
                      },
                    ]
                  : []),
                ...(isEnabled
                  ? [
                      {
                        type: 'item' as const,
                        label: isToggling
                          ? tCommon('actions.deactivating')
                          : tCommon('actions.deactivate'),
                        icon: CircleStop,
                        onClick: () => void handleUnpublish(),
                        disabled: isToggling,
                      },
                    ]
                  : []),
              ] satisfies DropdownMenuItem[],
            ]}
            align="end"
            contentClassName="w-40"
          />
        )}
      </div>
    </TabNavigation>
  );
}
