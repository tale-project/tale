'use client';

import { useQuery } from 'convex/react';
import { ChevronDown, CircleStop, FlaskConical } from 'lucide-react';
import { useState, useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { Badge } from '@/app/components/ui/feedback/badge';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useRollbackCustomAgentVersion,
  usePublishCustomAgent,
  useUnpublishCustomAgent,
} from '../hooks/use-custom-agent-mutations';
import { AUTO_SAVE_PORTAL_ID } from './auto-save-indicator';

interface CustomAgentNavigationProps {
  organizationId: string;
  agentId: string;
  currentVersion: number;
  onTestClick: () => void;
}

export function CustomAgentNavigation({
  organizationId,
  agentId,
  currentVersion,
  onTestClick,
}: CustomAgentNavigationProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const rollback = useRollbackCustomAgentVersion();
  const publishAgent = usePublishCustomAgent();
  const unpublishAgent = useUnpublishCustomAgent();
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(
    null,
  );
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);

  const versions = useQuery(api.custom_agents.queries.getCustomAgentVersions, {
    customAgentId: agentId as Id<'customAgents'>,
  });

  const publishedVersions = useMemo(
    () => versions?.filter((v) => v.status !== 'draft') ?? [],
    [versions],
  );

  const hasActiveVersion = useMemo(
    () => versions?.some((v) => v.status === 'active') ?? false,
    [versions],
  );

  const basePath = `/dashboard/${organizationId}/custom-agents/${agentId}`;

  const navigationItems: TabNavigationItem[] = [
    {
      label: t('customAgents.navigation.general'),
      href: basePath,
      matchMode: 'exact',
    },
    {
      label: t('customAgents.navigation.instructionsModel'),
      href: `${basePath}/instructions`,
      matchMode: 'exact',
    },
    {
      label: t('customAgents.navigation.tools'),
      href: `${basePath}/tools`,
      matchMode: 'exact',
    },
    {
      label: t('customAgents.navigation.knowledge'),
      href: `${basePath}/knowledge`,
      matchMode: 'exact',
    },
    {
      label: t('customAgents.navigation.webhook'),
      href: `${basePath}/webhook`,
      matchMode: 'exact',
    },
  ];

  const handleRollback = async (targetVersion: number) => {
    setRollingBackVersion(targetVersion);
    try {
      await rollback({
        customAgentId: agentId as Id<'customAgents'>,
        targetVersion,
      });
      toast({
        title: t('customAgents.rolledBack', { version: targetVersion }),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.rollbackFailed'),
        variant: 'destructive',
      });
    } finally {
      setRollingBackVersion(null);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await publishAgent({
        customAgentId: agentId as Id<'customAgents'>,
      });
      toast({
        title: t('customAgents.agentPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentPublishFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setIsUnpublishing(true);
    try {
      await unpublishAgent({
        customAgentId: agentId as Id<'customAgents'>,
      });
      toast({
        title: t('customAgents.agentDeactivated'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentDeactivateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsUnpublishing(false);
    }
  };

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      ariaLabel={tCommon('aria.customAgentsNavigation')}
    >
      <div className="ml-auto flex items-center gap-2">
        <div id={AUTO_SAVE_PORTAL_ID} />
        {versions && versions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-sm">
                v{currentVersion}
                <ChevronDown className="ml-1 size-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 space-y-1">
              <DropdownMenuItem disabled className="bg-accent/50">
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>
                      {t('customAgents.versions.version', {
                        number: currentVersion,
                      })}
                    </span>
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {t('customAgents.versions.draft')}
                    </Badge>
                  </div>
                </div>
              </DropdownMenuItem>

              {publishedVersions.length > 0 && <DropdownMenuSeparator />}

              {publishedVersions.map((version) => (
                <DropdownMenuItem
                  key={version._id}
                  onClick={() => {
                    if (
                      version.status === 'archived' &&
                      rollingBackVersion === null
                    ) {
                      handleRollback(version.versionNumber);
                    }
                  }}
                  disabled={
                    version.status === 'active' || rollingBackVersion !== null
                  }
                  className={cn(version.status === 'active' && 'bg-accent/50')}
                >
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>
                        {t('customAgents.versions.version', {
                          number: version.versionNumber,
                        })}
                      </span>
                      {version.status === 'active' && (
                        <Badge
                          variant="green"
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {t('customAgents.versions.active')}
                        </Badge>
                      )}
                    </div>
                    {version.status === 'archived' && (
                      <span className="text-muted-foreground text-xs">
                        {rollingBackVersion === version.versionNumber
                          ? t('customAgents.versions.rollingBack')
                          : t('customAgents.versions.rollback')}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button onClick={onTestClick} variant="outline" size="sm">
          <FlaskConical className="mr-1.5 size-3.5" aria-hidden="true" />
          {t('customAgents.navigation.test')}
        </Button>

        <Button onClick={handlePublish} disabled={isPublishing} size="sm">
          {isPublishing
            ? t('customAgents.navigation.publishing')
            : t('customAgents.navigation.publish')}
        </Button>

        {hasActiveVersion && (
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
        )}
      </div>
    </TabNavigation>
  );
}
