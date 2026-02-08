'use client';

import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { usePublishAutomationDraft } from '../hooks/use-publish-automation-draft';
import { useCreateDraftFromActive } from '../hooks/use-create-draft-from-active';
import { useUnpublishAutomation } from '../hooks/use-unpublish-automation';
import { useAutomationVersionNavigation } from '../hooks/use-automation-version-navigation';
import { Button } from '@/app/components/ui/primitives/button';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useToast } from '@/app/hooks/use-toast';
import { useState } from 'react';
import { useAuth } from '@/app/hooks/use-convex-auth';
import type { Doc, Id } from '@/convex/_generated/dataModel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/overlays/dropdown-menu';
import {
  ChevronDown,
  CircleStop,
  MoreVertical,
  Upload,
  Pencil,
} from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface AutomationNavigationProps {
  organizationId: string;
  automationId?: string;
  userRole?: string | null;
  automation?: Doc<'wfDefinitions'> | null;
}

export function AutomationNavigation({
  organizationId,
  automationId,
  userRole,
  automation,
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
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);

  const publishAutomation = usePublishAutomationDraft();
  const createDraftFromActive = useCreateDraftFromActive();
  const unpublishAutomation = useUnpublishAutomation();

  // Fetch all versions of this automation
  const versions = useQuery(
    api.wf_definitions.queries.listVersions,
    automation?.name && organizationId
      ? {
          organizationId: organizationId,
          name: automation.name,
        }
      : 'skip',
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

  const handlePublish = async () => {
    if (!automationId || !user?.email) {
      toast({
        title: t('navigation.toast.unableToPublish'),
        variant: 'destructive',
      });
      return;
    }

    setIsPublishing(true);
    try {
      await publishAutomation({
        wfDefinitionId: automationId as Id<'wfDefinitions'>,
        publishedBy: user.email,
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
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!automationId || !user?.email) {
      toast({
        title: t('navigation.toast.unableToCreateDraft'),
        variant: 'destructive',
      });
      return;
    }

    setIsCreatingDraft(true);
    try {
      const result = await createDraftFromActive({
        wfDefinitionId: automationId as Id<'wfDefinitions'>,
        createdBy: user.email,
      });

      // Navigate to the draft
      navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: result.draftId },
        search: { panel: 'ai-chat' },
      });

      // Show appropriate message based on whether it's new or existing
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
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handleUnpublish = async () => {
    if (!automationId || !user?.userId) {
      toast({
        title: t('navigation.toast.unableToDeactivate'),
        variant: 'destructive',
      });
      return;
    }

    setIsUnpublishing(true);
    try {
      await unpublishAutomation({
        wfDefinitionId: automationId as Id<'wfDefinitions'>,
        updatedBy: user.userId,
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
    } finally {
      setIsUnpublishing(false);
    }
  };

  return (
    <TabNavigation
      items={navigationItems}
      userRole={userRole}
      standalone={false}
      ariaLabel={tCommon('aria.automationsNavigation')}
    >
      <div className="flex items-center gap-2 ml-auto">
        {/* Version select - hidden on mobile (shown in first header row instead) */}
        {automation && versions && versions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="hidden md:flex text-sm h-8"
              >
                {automation.version}
                <ChevronDown className="ml-1 size-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 space-y-1">
              {versions.map((version: Doc<'wfDefinitions'>) => (
                <DropdownMenuItem
                  key={version._id}
                  onClick={() => navigateToVersion(version._id)}
                  className={cn(version._id === automationId && 'bg-accent/50')}
                >
                  <span>{version.version}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    {version.status === 'draft' && tCommon('status.draft')}
                    {version.status === 'active' && tCommon('status.active')}
                    {version.status === 'archived' &&
                      tCommon('status.archived')}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Desktop: Show buttons directly */}
        <div className="hidden md:flex items-center gap-4">
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
                variant="outline"
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
                variant="outline"
              >
                {tCommon('actions.edit')}
              </Button>
            </>
          )}
        </div>

        {/* Mobile: Show options dropdown */}
        {(automation?.status === 'draft' ||
          automation?.status === 'active' ||
          automation?.status === 'archived') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={tCommon('aria.actionsMenu')}
              >
                <MoreVertical className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {(automation?.status === 'draft' ||
                automation?.status === 'archived') && (
                <DropdownMenuItem
                  onClick={handlePublish}
                  disabled={isPublishing}
                >
                  <Upload className="mr-2 size-4" />
                  {isPublishing
                    ? t('navigation.publishing')
                    : t('navigation.publish')}
                </DropdownMenuItem>
              )}
              {automation?.status === 'active' && (
                <>
                  <DropdownMenuItem
                    onClick={handleUnpublish}
                    disabled={isUnpublishing}
                  >
                    <CircleStop className="mr-2 size-4" />
                    {isUnpublishing
                      ? tCommon('actions.deactivating')
                      : tCommon('actions.deactivate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleCreateDraft}
                    disabled={isCreatingDraft}
                  >
                    <Pencil className="mr-2 size-4" />
                    {tCommon('actions.edit')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </TabNavigation>
  );
}
