'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
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
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/use-convex-auth';
import type { Doc, Id } from '@/convex/_generated/dataModel';
import { ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface AutomationNavigationProps {
  userRole?: string | null;
  automation?: Doc<'wfDefinitions'> | null;
}

interface NavItem {
  label: string;
  href: string;
  roles?: string[];
}

const hasRequiredRole = (
  userRole?: string | null,
  requiredRoles?: string[],
): boolean => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  return requiredRoles.includes(userRole);
};

export default function AutomationNavigation({
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

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const navRef = useRef<HTMLElement | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({
    width: 0,
    left: 0,
  });

  const publishAutomation = useMutation(api.wf_definitions.publishDraftPublic);

  const createDraftFromActive = useMutation(
    api.wf_definitions.createDraftFromActivePublic,
  );

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

  const navigationItems: NavItem[] = automationId
    ? [
        {
          label: t('navigation.editor'),
          href: `/dashboard/${organizationId}/automations/${automationId}`,
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

  // Filter out items that are not accessible
  const accessibleItems = navigationItems.filter((item) =>
    hasRequiredRole(userRole, item.roles),
  );

  // Find active item index among accessible items
  const activeIndex = accessibleItems.findIndex((item) => {
    // For Editor, check exact match. For sub-pages, check if path starts with href
    if (item.label === t('navigation.editor')) {
      return pathname === item.href;
    }
    return pathname.startsWith(item.href);
  });

  // Function to update indicator position
  const updateIndicator = useCallback(() => {
    if (activeIndex !== -1 && itemRefs.current[activeIndex]) {
      const activeElement = itemRefs.current[activeIndex];
      if (activeElement) {
        setIndicatorStyle({
          width: activeElement.offsetWidth,
          left: activeElement.offsetLeft,
        });
      }
    }
  }, [activeIndex]);

  // Update indicator position and width when active item or accessible items change
  useEffect(() => {
    updateIndicator();
  }, [updateIndicator, accessibleItems.length]);

  // Re-measure on window resize
  useEffect(() => {
    const handleResize = () => {
      updateIndicator();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateIndicator]);

  // Re-measure on layout changes using ResizeObserver
  useEffect(() => {
    if (!navRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      updateIndicator();
    });

    resizeObserver.observe(navRef.current);

    // Also observe all navigation items for size changes
    itemRefs.current.forEach((ref) => {
      if (ref) {
        resizeObserver.observe(ref);
      }
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateIndicator, accessibleItems.length]);

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
          error instanceof Error ? error.message : t('navigation.toast.draftFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handleVersionChange = (versionId: string) => {
    // Navigate to the selected version
    const currentPath = pathname.split('/automations/')[0];
    router.push(`${currentPath}/automations/${versionId}`);
  };

  return (
    <nav
      ref={navRef}
      className="bg-background sticky top-12 z-10 border-b border-border px-4 flex items-center gap-4 min-h-12"
    >
      {accessibleItems.map((item, index) => {
        // Check if current path matches the nav item
        // For Editor, check exact match. For sub-pages, check if path starts with href
        const isActive =
          item.label === t('navigation.editor')
            ? pathname === item.href
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            href={item.href}
            className={cn(
              'h-full flex items-center text-sm font-medium transition-colors cursor-pointer',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {/* Single animated indicator */}
      {activeIndex !== -1 && (
        <div
          className="absolute bottom-0 h-0.5 bg-foreground transition-all duration-200 ease-out"
          style={{
            width: `${indicatorStyle.width}px`,
            left: `${indicatorStyle.left}px`,
          }}
        />
      )}

      <div className="flex items-center gap-4 ml-auto">
        {automation && versions && versions.length > 0 && (
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className="text-sm h-8">
                  {automation.version}
                  <span className="text-xs text-muted-foreground ml-1">
                    {automation.status === 'draft' && `- ${tCommon('status.draft')}`}
                    {automation.status === 'active' && `- ${tCommon('status.active')}`}
                    {automation.status === 'archived' && `- ${t('navigation.archived')}`}
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
                              {version.status === 'draft' && `- ${tCommon('status.draft')}`}
                              {version.status === 'active' && `- ${tCommon('status.active')}`}
                              {version.status === 'archived' && `- ${t('navigation.archived')}`}
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
            {isPublishing ? t('navigation.publishing') : t('navigation.publish')}
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
            {isPublishing ? t('navigation.rollingBack') : t('navigation.rollback')}
          </Button>
        )}
      </div>
    </nav>
  );
}
