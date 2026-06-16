'use client';

import { Button } from '@tale/ui/button';
import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import { useNavigate } from '@tanstack/react-router';
import {
  Camera,
  FolderOpen,
  MonitorPlay,
  Paperclip,
  Plus,
  Swords,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useLiveBrowserOptional } from '@/app/features/workspace/components/live-browser-context';
import { useWorkspaceFilesOptional } from '@/app/features/workspace/components/workspace-files-context';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import {
  getAgentMissingIntegrations,
  resolveCapabilityIcon,
  useComposerCapabilities,
  useIntegrationReadiness,
} from '../hooks/use-composer-capabilities';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useSandboxPanesAvailable } from '../hooks/use-sandbox-panes';
import { useArenaModeOptional } from './arena/arena-mode-context';

interface ComposerModeMenuProps {
  organizationId: string;
  /** Current thread (gates the mobile sandbox-view entries). */
  threadId?: string;
  onAttachFile?: () => void;
  /** Capture a screenshot and attach it. Omitted when unsupported/disabled. */
  onTakeScreenshot?: () => void;
  fileUploadDisabled?: boolean;
  disabled?: boolean;
}

export function ComposerModeMenu({
  organizationId,
  threadId,
  onAttachFile,
  onTakeScreenshot,
  fileUploadDisabled = false,
  disabled = false,
}: ComposerModeMenuProps) {
  const { t } = useT('composer');
  const { t: tChat } = useT('chat');
  const navigate = useNavigate();
  const { setSelectedAgent, enabledCapabilities, setCapabilityEnabled } =
    useChatLayout();
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const { agents } = useChatAgents(organizationId);

  // Mobile-only: the desktop sandbox panes are right-edge strips, but there's no
  // room for them under `md`, so surface the Workspace-files / Live-browser
  // toggles here in the always-reachable `+` menu (the composer has no pill for
  // them anymore). Same gate as the desktop strips, via the shared hook.
  const isMobile = useIsMobile();
  const files = useWorkspaceFilesOptional();
  const live = useLiveBrowserOptional();
  const sandboxPanesAvailable = useSandboxPanesAvailable(
    organizationId,
    threadId,
  );
  const showSandboxViews =
    isMobile && sandboxPanesAvailable && !!files && !!live;
  const capabilities = useComposerCapabilities(organizationId);
  const readiness = useIntegrationReadiness(organizationId);
  const arenaContext = useArenaModeOptional();

  const modeAgents = useMemo(() => {
    if (!agents) return [];
    return agents
      .filter((a) => a.composerMode)
      .sort((a, b) => {
        const aOrder = a.composerMode?.order ?? 100;
        const bOrder = b.composerMode?.order ?? 100;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [agents]);

  const chatAgent = useMemo(
    () => agents?.find((a) => a.name === 'chat-agent') ?? null,
    [agents],
  );

  const switchTo = useCallback(
    (agentName: string) => {
      const next = agents?.find((a) => a.name === agentName);
      if (!next) return;
      setSelectedAgent({
        name: next.name,
        displayName: next.displayName,
      });
    },
    [agents, setSelectedAgent],
  );

  const openIntegrations = useCallback(
    (slug?: string) => {
      void navigate({
        to: '/dashboard/$id/settings/integrations',
        params: { id: organizationId },
        search: { tab: 'all', slug },
      });
    },
    [navigate, organizationId],
  );

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const groups: DropdownMenuGroup[] = [];

    if ((!fileUploadDisabled && onAttachFile) || onTakeScreenshot) {
      const attachGroup: DropdownMenuGroup = [];
      if (!fileUploadDisabled && onAttachFile) {
        attachGroup.push({
          type: 'item',
          label: t('addFiles'),
          icon: Paperclip,
          onClick: onAttachFile,
        });
      }
      if (onTakeScreenshot) {
        attachGroup.push({
          type: 'item',
          label: t('takeScreenshot'),
          icon: Camera,
          onClick: onTakeScreenshot,
        });
      }
      groups.push(attachGroup);
    }

    const hasArena = arenaContext != null;
    const isArenaActive = arenaContext?.isArenaMode === true;
    if (modeAgents.length > 0 || hasArena) {
      const modeGroup: DropdownMenuGroup = [
        { type: 'label', content: t('modeHeader') },
      ];
      for (const agent of modeAgents) {
        const isActive = effectiveAgent?.name === agent.name && !isArenaActive;
        const modeLabel = agent.composerMode?.label ?? agent.displayName;
        const missing = getAgentMissingIntegrations(agent, readiness);
        const modeReady = missing.length === 0;
        const item: DropdownMenuItem = modeReady
          ? {
              type: 'item',
              label: modeLabel,
              selected: isActive,
              icon: resolveCapabilityIcon(agent.composerMode?.icon),
              onClick: () => {
                if (isActive) {
                  if (chatAgent) switchTo(chatAgent.name);
                  return;
                }
                if (isArenaActive) arenaContext.exitArenaMode();
                switchTo(agent.name);
              },
            }
          : {
              type: 'item',
              label: modeLabel,
              trailing: t('requiresIntegration', {
                name: readiness.titleBySlug.get(missing[0]) ?? missing[0],
              }),
              icon: resolveCapabilityIcon(agent.composerMode?.icon),
              onClick: () => openIntegrations(missing[0]),
            };
        modeGroup.push(item);
      }
      if (hasArena) {
        modeGroup.push({
          type: 'item',
          label: tChat('arena.label'),
          selected: isArenaActive,
          icon: Swords,
          onClick: () => {
            if (isArenaActive) {
              arenaContext.exitArenaMode();
              return;
            }
            const isInComposerMode = modeAgents.some(
              (a) => a.name === effectiveAgent?.name,
            );
            if (isInComposerMode && chatAgent) {
              switchTo(chatAgent.name);
            }
            arenaContext.enableArenaMode();
          },
        });
      }
      groups.push(modeGroup);
    }

    if (capabilities.length > 0) {
      const capabilityGroup: DropdownMenuGroup = [
        { type: 'label', content: t('capabilityHeader') },
      ];
      for (const capability of capabilities) {
        const isOn =
          enabledCapabilities.includes(capability.slug) && capability.ready;
        if (!capability.ready) {
          const title =
            readiness.titleBySlug.get(capability.slug) ?? capability.slug;
          capabilityGroup.push({
            type: 'item',
            label: capability.label,
            trailing: t('requiresIntegration', { name: title }),
            icon: capability.icon,
            onClick: () => openIntegrations(capability.slug),
          });
          continue;
        }
        capabilityGroup.push({
          type: 'item',
          label: capability.label,
          icon: capability.icon,
          selected: isOn,
          onClick: () => setCapabilityEnabled(capability.slug, !isOn),
        });
      }
      groups.push(capabilityGroup);
    }

    if (showSandboxViews && files && live) {
      groups.push([
        { type: 'label', content: tChat('sandbox.label') },
        {
          type: 'item',
          label: tChat('workspaceFiles.toggleLabel', {
            defaultValue: 'Workspace files',
          }),
          icon: FolderOpen,
          selected: files.isOpen,
          onClick: () => files.toggle(),
        },
        {
          type: 'item',
          label: tChat('liveBrowser.toggleLabel', {
            defaultValue: 'Live browser',
          }),
          icon: MonitorPlay,
          selected: live.isOpen,
          onClick: () => live.toggle(),
        },
      ]);
    }

    return groups;
  }, [
    showSandboxViews,
    files,
    live,
    fileUploadDisabled,
    onAttachFile,
    onTakeScreenshot,
    modeAgents,
    chatAgent,
    effectiveAgent?.name,
    capabilities,
    readiness,
    enabledCapabilities,
    setCapabilityEnabled,
    switchTo,
    openIntegrations,
    arenaContext,
    t,
    tChat,
  ]);

  if (items.length === 0) {
    return null;
  }

  return (
    <DropdownMenu
      tooltip={t('openMenu')}
      tooltipSide="top"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('openMenu')}
          aria-haspopup="menu"
          disabled={disabled}
          className="focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      }
      items={items}
      align="start"
    />
  );
}
