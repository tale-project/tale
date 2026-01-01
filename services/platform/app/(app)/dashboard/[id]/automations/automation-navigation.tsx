'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { usePublishAutomationDraft } from './hooks/use-publish-automation-draft';
import { useCreateDraftFromActive } from './hooks/use-create-draft-from-active';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from '@/components/ui/navigation-menu';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/components/ui/tab-navigation';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-convex-auth';
import type { Doc, Id } from '@/convex/_generated/dataModel';
import { ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface AutomationNavigationProps {
  userRole?: string | null;
  automation?: Doc<'wfDefinitions'> | null;
}

export function AutomationNavigation({
  userRole,
  automation,
}: AutomationNavigationProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const params = useParams();
  const organizationId = params.id as string;
  const automationId = params.amId as string | undefined;
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  const publishAutomation = usePublishAutomationDraft();
  const createDraftFromActive = useCreateDraftFromActive();

  // Fetch all versions of this automation
  const versions = useQuery(
    api.wf_definitions.listVersionsPublic,
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
        title:
          automation?.status === 'archived'
            ? t('navigation.toast.rolledBack')
            : t('navigation.toast.published'),
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
      router.push(`/dashboard/${organizationId}/automations/${result.draftId}`);

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

  const handleVersionChange = (versionId: string) => {
    const currentPath = pathname.split('/automations/')[0];
    router.push(`${currentPath}/automations/${versionId}`);
  };

  return (
    <TabNavigation
      items={navigationItems}
      userRole={userRole}
      className="top-12"
      ariaLabel={tCommon('aria.automationsNavigation')}
    >
      <div className="flex items-center gap-4 ml-auto">
        {automation && versions && versions.length > 0 && (
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className="text-sm h-8">
                  {automation.version}
                  <span className="text-xs text-muted-foreground ml-1">
                    {automation.status === 'draft' &&
                      `- ${tCommon('status.draft')}`}
                    {automation.status === 'active' &&
                      `- ${tCommon('status.active')}`}
                    {automation.status === 'archived' &&
                      `- ${t('navigation.archived')}`}
                  </span>
                  <ChevronDown
                    className="relative top-[1px] ml-1 size-3 transition duration-300 group-data-[state=open]:rotate-180"
                    aria-hidden="true"
                  />
                </NavigationMenuTrigger>
                <NavigationMenuContent className="md:w-40">
                  <ul className="p-1 space-y-1">
                    {versions.map((version) => (
                      <li key={version._id}>
                        <NavigationMenuLink asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => handleVersionChange(version._id)}
                          >
                            <span>{version.version}</span>
                            <span className="text-xs text-muted-foreground ml-1">
                              {version.status === 'draft' &&
                                `- ${tCommon('status.draft')}`}
                              {version.status === 'active' &&
                                `- ${tCommon('status.active')}`}
                              {version.status === 'archived' &&
                                `- ${t('navigation.archived')}`}
                            </span>
                          </Button>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
            <NavigationMenuViewport />
          </NavigationMenu>
        )}

        {automation?.status === 'draft' && (
          <Button onClick={handlePublish} disabled={isPublishing} size="sm">
            {isPublishing
              ? t('navigation.publishing')
              : t('navigation.publish')}
          </Button>
        )}

        {automation?.status === 'active' && (
          <Button
            onClick={handleCreateDraft}
            disabled={isCreatingDraft}
            size="sm"
            variant="outline"
          >
            {tCommon('actions.edit')}
          </Button>
        )}

        {automation?.status === 'archived' && (
          <Button
            onClick={handlePublish}
            disabled={isPublishing}
            size="sm"
            variant="secondary"
          >
            {isPublishing
              ? t('navigation.rollingBack')
              : t('navigation.rollback')}
          </Button>
        )}
      </div>
    </TabNavigation>
  );
}
