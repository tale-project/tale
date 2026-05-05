'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { Check, Paperclip, Plus, Swords } from 'lucide-react';
import { type ReactNode, useCallback, useMemo } from 'react';

import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
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
import { useArenaModeOptional } from './arena/arena-mode-context';

interface ComposerModeMenuProps {
  organizationId: string;
  onAttachFile?: () => void;
  fileUploadDisabled?: boolean;
  disabled?: boolean;
}

function labelWithHint(label: string, hint: string): ReactNode {
  return (
    <span className="flex flex-1 items-center justify-between gap-3">
      <span className="truncate">{label}</span>
      <span className="text-muted-foreground shrink-0 text-xs">{hint}</span>
    </span>
  );
}

export function ComposerModeMenu({
  organizationId,
  onAttachFile,
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

    if (!fileUploadDisabled && onAttachFile) {
      groups.push([
        {
          type: 'item',
          label: t('addFiles'),
          icon: Paperclip,
          onClick: onAttachFile,
        },
      ]);
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
              label: isActive ? `${modeLabel} ✓` : modeLabel,
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
              label: labelWithHint(
                modeLabel,
                t('requiresIntegration', {
                  name: readiness.titleBySlug.get(missing[0]) ?? missing[0],
                }),
              ),
              icon: resolveCapabilityIcon(agent.composerMode?.icon),
              onClick: () => openIntegrations(missing[0]),
            };
        modeGroup.push(item);
      }
      if (hasArena) {
        modeGroup.push({
          type: 'item',
          label: isArenaActive
            ? `${tChat('arena.label')} ✓`
            : tChat('arena.label'),
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
            label: labelWithHint(
              capability.label,
              t('requiresIntegration', { name: title }),
            ),
            icon: capability.icon,
            onClick: () => openIntegrations(capability.slug),
          });
          continue;
        }
        capabilityGroup.push({
          type: 'item',
          label: capability.label,
          icon: isOn ? Check : capability.icon,
          onClick: () => setCapabilityEnabled(capability.slug, !isOn),
        });
      }
      groups.push(capabilityGroup);
    }

    return groups;
  }, [
    fileUploadDisabled,
    onAttachFile,
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
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('openMenu')}
          aria-haspopup="menu"
          disabled={disabled}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      }
      items={items}
      align="start"
    />
  );
}
