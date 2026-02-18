'use client';

import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, CircleStop, FlaskConical, Pencil } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useActivateCustomAgentVersion,
  useCreateDraftFromVersion,
  usePublishCustomAgent,
  useUnpublishCustomAgent,
} from '../hooks/mutations';
import { useCustomAgentVersion } from '../hooks/use-custom-agent-version-context';
import { AUTO_SAVE_PORTAL_ID } from './auto-save-indicator';

interface CustomAgentNavigationProps {
  organizationId: string;
  agentId: string;
  onTestClick: () => void;
}

export function CustomAgentNavigation({
  organizationId,
  agentId,
  onTestClick,
}: CustomAgentNavigationProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { agent, versions, hasDraft, draftVersionNumber } =
    useCustomAgentVersion();

  const { mutate: publishAgent, isPending: isPublishing } =
    usePublishCustomAgent();
  const { mutate: unpublishAgent, isPending: isUnpublishing } =
    useUnpublishCustomAgent();
  const { mutate: activateVersion, isPending: isActivating } =
    useActivateCustomAgentVersion();
  const { mutateAsync: createDraft, isPending: isCreatingDraft } =
    useCreateDraftFromVersion();

  const basePath = `/dashboard/${organizationId}/custom-agents/${agentId}`;
  const versionSearch =
    agent.status !== 'draft' ? { v: agent.versionNumber } : undefined;

  const navigationItems: TabNavigationItem[] = [
    {
      label: t('customAgents.navigation.general'),
      href: basePath,
      matchMode: 'exact',
      search: versionSearch,
    },
    {
      label: t('customAgents.navigation.instructionsModel'),
      href: `${basePath}/instructions`,
      matchMode: 'exact',
      search: versionSearch,
    },
    {
      label: t('customAgents.navigation.tools'),
      href: `${basePath}/tools`,
      matchMode: 'exact',
      search: versionSearch,
    },
    {
      label: t('customAgents.navigation.knowledge'),
      href: `${basePath}/knowledge`,
      matchMode: 'exact',
      search: versionSearch,
    },
    {
      label: t('customAgents.navigation.webhook'),
      href: `${basePath}/webhook`,
      matchMode: 'exact',
      search: versionSearch,
    },
  ];

  const navigateToVersion = useCallback(
    (versionNum: number) => {
      void navigate({
        to: '/dashboard/$id/custom-agents/$agentId',
        params: { id: organizationId, agentId },
        search: { v: versionNum },
      });
    },
    [navigate, organizationId, agentId],
  );

  const navigateToDraft = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/custom-agents/$agentId',
      params: { id: organizationId, agentId },
      search: {},
    });
  }, [navigate, organizationId, agentId]);

  const handlePublish = () => {
    publishAgent(
      { customAgentId: toId<'customAgents'>(agentId) },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.agentPublished'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentPublishFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleUnpublish = () => {
    unpublishAgent(
      { customAgentId: toId<'customAgents'>(agentId) },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.agentDeactivated'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentDeactivateFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleActivate = () => {
    activateVersion(
      {
        customAgentId: toId<'customAgents'>(agentId),
        targetVersion: agent.versionNumber,
      },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.agentPublished'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error(error);
          toast({
            title: t('customAgents.agentPublishFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleCreateDraft = async () => {
    if (hasDraft && draftVersionNumber) {
      navigateToDraft();
      return;
    }

    try {
      await createDraft({
        customAgentId: toId<'customAgents'>(agentId),
        sourceVersionNumber: agent.versionNumber,
      });
      navigateToDraft();
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions],
  );

  const isDraft = agent.status === 'draft';
  const isActive = agent.status === 'active';
  const isArchived = agent.status === 'archived';

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      ariaLabel={tCommon('aria.customAgentsNavigation')}
    >
      <div className="ml-auto flex items-center gap-2">
        <div id={AUTO_SAVE_PORTAL_ID} />

        {sortedVersions.length > 0 && (
          <DropdownMenu
            trigger={
              <Button variant="secondary" size="sm" className="h-8 text-sm">
                v{agent.versionNumber}
                <ChevronDown className="ml-1 size-3" aria-hidden="true" />
              </Button>
            }
            items={[
              sortedVersions.map<DropdownMenuItem>((version) => ({
                type: 'item',
                label: (
                  <div className="flex w-full items-center gap-2">
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
                    {version.status === 'draft' && (
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {t('customAgents.versions.draft')}
                      </Badge>
                    )}
                    {version.status === 'archived' && (
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {t('customAgents.versions.archived')}
                      </Badge>
                    )}
                  </div>
                ),
                onClick: () => navigateToVersion(version.versionNumber),
                className: cn(
                  version.versionNumber === agent.versionNumber &&
                    'bg-accent/50',
                ),
              })),
            ]}
            align="end"
            contentClassName="w-56"
          />
        )}

        <Button onClick={onTestClick} variant="secondary" size="sm">
          <FlaskConical className="mr-1.5 size-3.5" aria-hidden="true" />
          {t('customAgents.navigation.test')}
        </Button>

        {isDraft && (
          <Button onClick={handlePublish} disabled={isPublishing} size="sm">
            {isPublishing
              ? t('customAgents.navigation.publishing')
              : t('customAgents.navigation.publish')}
          </Button>
        )}

        {isActive && (
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
              <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
              {hasDraft
                ? t('customAgents.navigation.goToDraft')
                : tCommon('actions.edit')}
            </Button>
          </>
        )}

        {isArchived && (
          <>
            <Button onClick={handleActivate} disabled={isActivating} size="sm">
              {isActivating
                ? t('customAgents.navigation.publishing')
                : t('customAgents.navigation.publish')}
            </Button>
            <Button
              onClick={handleCreateDraft}
              disabled={isCreatingDraft}
              size="sm"
              variant="secondary"
            >
              <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
              {hasDraft
                ? t('customAgents.navigation.goToDraft')
                : tCommon('actions.edit')}
            </Button>
          </>
        )}
      </div>
    </TabNavigation>
  );
}
