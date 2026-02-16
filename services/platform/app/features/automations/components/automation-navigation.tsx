'use client';

import { useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  CircleStop,
  MoreVertical,
  Upload,
  Pencil,
} from 'lucide-react';

import type { Doc } from '@/convex/_generated/dataModel';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useCreateDraftFromActive,
  usePublishAutomationDraft,
  useUnpublishAutomation,
} from '../hooks/mutations';
import { useListWorkflowVersions } from '../hooks/queries';
import { useAutomationVersionNavigation } from '../hooks/use-automation-version-navigation';

interface AutomationNavigationProps {
  organizationId: string;
  automationId?: string;
  userRole?: string | null;
  automation?: Doc<'wfDefinitions'> | null;
  isLoading?: boolean;
}

export function AutomationNavigation({
  organizationId,
  automationId,
  userRole,
  automation,
  isLoading,
}: AutomationNavigationProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { navigateToVersion } = useAutomationVersionNavigation(
    organizationId,
    automationId ?? '',
  );
  const { user } = useAuth();

  const { mutate: publishAutomation, isPending: isPublishing } =
    usePublishAutomationDraft();
  const { mutateAsync: createDraftFromActive, isPending: isCreatingDraft } =
    useCreateDraftFromActive();
  const { mutate: unpublishAutomation, isPending: isUnpublishing } =
    useUnpublishAutomation();

  const { data: versions } = useListWorkflowVersions(
    organizationId,
    automation?.name,
  );

  const navigationItems: TabNavigationItem[] = automationId
    ? [
        {
          label: t('navigation.editor'),
          href: `/dashboard/${organizationId}/automations/${automationId}?panel=ai-chat`,
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

  const handlePublish = () => {
    if (!automationId || !user?.email) {
      toast({
        title: t('navigation.toast.unableToPublish'),
        variant: 'destructive',
      });
      return;
    }

    publishAutomation(
      {
        wfDefinitionId: toId<'wfDefinitions'>(automationId),
        publishedBy: user.email,
      },
      {
        onSuccess: () => {
          toast({
            title: t('navigation.toast.published'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to publish automation:', error);
          toast({
            title:
              error instanceof Error
                ? error.message
                : t('navigation.toast.publishFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleCreateDraft = async () => {
    if (!automationId || !user?.email) {
      toast({
        title: t('navigation.toast.unableToCreateDraft'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await createDraftFromActive({
        wfDefinitionId: toId<'wfDefinitions'>(automationId),
        createdBy: user.email,
      });

      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: result.draftId },
        search: { panel: 'ai-chat' },
      });

      if (result.isNewDraft) {
        toast({
          title: t('navigation.toast.draftCreated'),
          variant: 'success',
        });
      } else {
        toast({
          title: t('navigation.toast.navigatingToExisting'),
        });
      }
    } catch (error) {
      console.error('Failed to create draft:', error);
      toast({
        title:
          error instanceof Error
            ? error.message
            : t('navigation.toast.draftFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleUnpublish = () => {
    if (!automationId || !user?.userId) {
      toast({
        title: t('navigation.toast.unableToDeactivate'),
        variant: 'destructive',
      });
      return;
    }

    unpublishAutomation(
      {
        wfDefinitionId: toId<'wfDefinitions'>(automationId),
        updatedBy: user.userId,
      },
      {
        onSuccess: () => {
          toast({
            title: t('navigation.toast.deactivated'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to unpublish automation:', error);
          toast({
            title:
              error instanceof Error
                ? error.message
                : t('navigation.toast.deactivateFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <TabNavigation
      items={navigationItems}
      userRole={userRole}
      standalone={false}
      ariaLabel={tCommon('aria.automationsNavigation')}
    >
      <div className="ml-auto flex items-center gap-2">
        {isLoading && (
          <>
            <div className="hidden items-center gap-2 md:flex">
              <Skeleton className="h-8 w-12 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </>
        )}

        {/* Version select - hidden on mobile (shown in first header row instead) */}
        {!isLoading && automation && versions && versions.length > 0 && (
          <DropdownMenu
            trigger={
              <Button
                variant="secondary"
                size="sm"
                className="hidden h-8 text-sm md:flex"
              >
                {`v${automation.versionNumber}`}
                <ChevronDown className="ml-1 size-3" aria-hidden="true" />
              </Button>
            }
            items={[
              versions.map(
                (version: Doc<'wfDefinitions'>): DropdownMenuItem => ({
                  type: 'item' as const,
                  label: (
                    <>
                      <span>{`v${version.versionNumber}`}</span>
                      <span className="text-muted-foreground ml-1 text-xs">
                        {version.status === 'draft' && tCommon('status.draft')}
                        {version.status === 'active' &&
                          tCommon('status.active')}
                        {version.status === 'archived' &&
                          tCommon('status.archived')}
                      </span>
                    </>
                  ),
                  onClick: () => navigateToVersion(version._id),
                  className: cn(version._id === automationId && 'bg-accent/50'),
                }),
              ),
            ]}
            align="end"
            contentClassName="w-40"
          />
        )}

        {/* Desktop: Show buttons directly */}
        {!isLoading && (
          <div className="hidden items-center gap-4 md:flex">
            {(automation?.status === 'draft' ||
              automation?.status === 'archived') && (
              <Button onClick={handlePublish} disabled={isPublishing} size="sm">
                {isPublishing
                  ? t('navigation.publishing')
                  : t('navigation.publish')}
              </Button>
            )}

            {automation?.status === 'active' && (
              <>
                <Button
                  onClick={handleUnpublish}
                  disabled={isUnpublishing}
                  size="sm"
                  variant="secondary"
                >
                  <CircleStop className="mr-1.5 size-3.5" aria-hidden="true" />
                  {isUnpublishing
                    ? tCommon('actions.deactivating')
                    : tCommon('actions.deactivate')}
                </Button>
                <Button
                  onClick={handleCreateDraft}
                  disabled={isCreatingDraft}
                  size="sm"
                  variant="secondary"
                >
                  {tCommon('actions.edit')}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Mobile: Show options dropdown */}
        {!isLoading &&
          (automation?.status === 'draft' ||
            automation?.status === 'active' ||
            automation?.status === 'archived') && (
            <DropdownMenu
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label={tCommon('aria.actionsMenu')}
                >
                  <MoreVertical className="size-5" />
                </Button>
              }
              items={[
                [
                  ...(automation?.status === 'draft' ||
                  automation?.status === 'archived'
                    ? [
                        {
                          type: 'item' as const,
                          label: isPublishing
                            ? t('navigation.publishing')
                            : t('navigation.publish'),
                          icon: Upload,
                          onClick: handlePublish,
                          disabled: isPublishing,
                        },
                      ]
                    : []),
                  ...(automation?.status === 'active'
                    ? [
                        {
                          type: 'item' as const,
                          label: isUnpublishing
                            ? tCommon('actions.deactivating')
                            : tCommon('actions.deactivate'),
                          icon: CircleStop,
                          onClick: handleUnpublish,
                          disabled: isUnpublishing,
                        },
                        {
                          type: 'item' as const,
                          label: tCommon('actions.edit'),
                          icon: Pencil,
                          onClick: handleCreateDraft,
                          disabled: isCreatingDraft,
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
