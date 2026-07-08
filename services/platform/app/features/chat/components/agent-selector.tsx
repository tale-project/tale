'use client';

import { Button } from '@tale/ui/button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Bot,
  Box,
  ChevronDown,
  LayoutGrid,
  SlidersHorizontal,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { buildAgentSectionOptions } from '@/app/features/agents/utils/agent-picker-options';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import {
  AUTO_AGENT_SLUG,
  DEFAULT_CHAT_AGENT_SLUG,
} from '@/lib/shared/constants/agents';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents, type ChatAgent } from '../hooks/queries';
import {
  getAgentMissingIntegrations,
  useIntegrationReadiness,
} from '../hooks/use-composer-capabilities';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useThreadAgentLock } from '../hooks/use-thread-agent-lock';

interface AgentSelectorProps {
  organizationId: string;
  /** When the chat belongs to a project that restricts agents, show only the
   *  project's `allowedAgentSlugs`. */
  projectId?: string;
  /** Current thread, when one exists. External-agent threads are bound to
   *  their agent (sandbox session, --resume transcript), so the selector
   *  locks on them instead of offering a switch. */
  threadId?: string;
}

export const AgentSelector = memo(function AgentSelector({
  organizationId,
  projectId,
  threadId,
}: AgentSelectorProps) {
  const { t } = useT('chat');
  const { t: tComposer } = useT('composer');
  const navigate = useNavigate();
  const ability = useAbility();
  const { selectedAgent, setSelectedAgent } = useChatLayout();
  const { agent: effectiveAgent, isLoading: isAgentLoading } =
    useEffectiveAgent(organizationId);
  const { agents: allAgents } = useChatAgents(organizationId);
  const { project } = useProject(
    projectId ? asProjectId(projectId) : undefined,
  );
  const allowedAgentSlugs = project?.allowedAgentSlugs;
  const readiness = useIntegrationReadiness(organizationId);
  const canManageAgents = ability.can('write', 'agents');
  const [open, setOpen] = useState(false);
  const { lockedAgent } = useThreadAgentLock(organizationId, threadId);

  const options = useMemo(() => {
    if (!allAgents) return [];

    // Project restriction: when the project pins an allowed-agents list, only
    // those agents are selectable here.
    const visibleAgents =
      allowedAgentSlugs && allowedAgentSlugs.length > 0
        ? allAgents.filter((agent) => allowedAgentSlugs.includes(agent.name))
        : allAgents;

    const sortAgents = (agents: ChatAgent[]) =>
      [...agents].sort((a, b) => {
        if (a.name === DEFAULT_CHAT_AGENT_SLUG) return -1;
        if (b.name === DEFAULT_CHAT_AGENT_SLUG) return 1;
        return a.displayName.localeCompare(b.displayName);
      });

    const toOption = (agent: ChatAgent): SearchableSelectOption => {
      const missing = getAgentMissingIntegrations(agent, readiness);
      const missingTitle = missing[0]
        ? (readiness.titleBySlug.get(missing[0]) ?? missing[0])
        : undefined;
      return {
        value: agent.name,
        label: agent.displayName,
        description: agent.description,
        labelBadge: missingTitle ? (
          <span className="text-muted-foreground text-xs">
            {tComposer('requiresIntegration', { name: missingTitle })}
          </span>
        ) : undefined,
      };
    };

    const sectioned = buildAgentSectionOptions(
      visibleAgents,
      toOption,
      {
        platform: t('agentSelector.sectionAgents'),
        coding: t('agentSelector.sectionCodingAgents'),
        image: t('agentSelector.sectionImageAgents'),
      },
      sortAgents,
    );

    // "Auto" (the null selection) is pinned first so the user can hand routing
    // back to the system — but it is NOT the default. New sessions open on the
    // Assistant (see DEFAULT_SELECTED_AGENT in chat-layout-context): Auto has to
    // run a routing classifier to pick an agent before it can answer, adding
    // latency to the first token, whereas the general-purpose Assistant is
    // suitable for most messages and starts immediately. Auto is only offered
    // when there's more than one agent to route between — with a single agent
    // there's nothing to choose, so it would be redundant.
    if (visibleAgents.length <= 1) return sectioned;
    return [
      {
        value: AUTO_AGENT_SLUG,
        label: t('agentSelector.auto'),
        description: t('agentSelector.autoDescription'),
      },
      ...sectioned,
    ];
  }, [allAgents, allowedAgentSlugs, readiness, tComposer, t]);

  // Auto is offered only when there's more than one agent (see options above).
  const autoAvailable = options.some((o) => o.value === AUTO_AGENT_SLUG);
  // A null selection means "Auto" when it's available; otherwise the selector
  // reflects the single resolved agent (effectiveAgent).
  const isAuto = autoAvailable && !selectedAgent;

  // Genuinely-no-agents (loaded, not just pending): the org has no agent, or a
  // project's allow-list resolves to nothing. Don't invent an "Assistant" that
  // doesn't exist — show an honest, muted empty label instead. `allAgents` is
  // undefined while loading and [] once loaded, so this is false mid-load
  // (the trigger renders its skeleton via isAgentLoading in that window).
  const hasNoAgents = !isAgentLoading && options.length === 0;

  const currentValue = isAuto
    ? AUTO_AGENT_SLUG
    : (effectiveAgent?.name ?? null);

  const currentLabel = hasNoAgents
    ? t('agentSelector.noAgents')
    : isAuto
      ? t('agentSelector.auto')
      : (effectiveAgent?.displayName ?? t('agentSelector.defaultAgent'));

  const handleSelect = useCallback(
    (value: string) => {
      // Auto mode is represented by a null selection — clears any pin so the
      // server routes each message.
      if (value === AUTO_AGENT_SLUG) {
        setSelectedAgent(null);
        return;
      }
      const agent = allAgents?.find((a) => a.name === value);
      if (!agent) return;
      const missing = getAgentMissingIntegrations(agent, readiness);
      if (missing.length > 0) {
        void navigate({
          to: '/dashboard/$id/settings/integrations',
          params: { id: organizationId },
          search: { tab: 'all', slug: missing[0] },
        });
        return;
      }
      setSelectedAgent({
        name: agent.name,
        displayName: agent.displayName,
      });
    },
    [allAgents, readiness, navigate, organizationId, setSelectedAgent],
  );

  // The footer "Catalog" button sends the user to the agent catalog — the
  // browse-and-install surface — rather than a bare create-agent dialog, so
  // they can pick from the available agents (or create a new one from there).
  const handleAddAgentClick = useCallback(() => {
    setOpen(false);
    void navigate({
      to: '/dashboard/$id/agents/catalog',
      params: { id: organizationId },
    });
  }, [navigate, organizationId]);

  // Right-side action per row: a link to that agent's detail page, mirroring
  // the model selector's provider link. Skipped for the "Auto" pseudo-option
  // (no agent to view) and only shown to users who can manage agents — the
  // detail page is the same `agents` write gate as the Catalog footer button.
  const renderOptionAction = useCallback(
    (option: SearchableSelectOption): ReactNode => {
      if (
        !canManageAgents ||
        option.isSectionHeader ||
        option.value === AUTO_AGENT_SLUG
      ) {
        return null;
      }
      return (
        <Tooltip content={t('agentSelector.viewDetails')} side="top">
          <Link
            to="/dashboard/$id/agents/$agentId"
            params={{ id: organizationId, agentId: option.value }}
            aria-label={t('agentSelector.viewDetails')}
            className="text-muted-foreground hover:text-foreground flex items-center rounded-sm transition-colors"
            // Stop the row's select-and-close handler: clicking the link should
            // open the agent's detail page, not pick the agent.
            onClick={(e) => e.stopPropagation()}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          </Link>
        </Tooltip>
      );
    },
    [canManageAgents, organizationId, t],
  );

  // External-agent thread: the agent can't be switched here — the sandbox
  // session and --resume transcript are bound to it (the backend enforces the
  // same lock). Render a pinned, explained trigger instead of the picker;
  // `aria-disabled` (not native `disabled`) keeps it hoverable/focusable so
  // the explanatory Tooltip can fire (voice-mode-toggle convention).
  if (lockedAgent) {
    return (
      <Tooltip content={t('agentSelector.lockedExternal')} side="top">
        <Button
          type="button"
          className="cursor-not-allowed gap-1.5 sm:min-w-32"
          variant="ghost"
          size="sm"
          aria-disabled="true"
          aria-label={t('agentSelector.lockedExternalLabel', {
            agent: lockedAgent.displayName,
          })}
        >
          <Bot className="size-3.5" aria-hidden="true" />
          <span>{lockedAgent.displayName}</span>
          <Box className="text-muted-foreground size-3" aria-hidden="true" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <SearchableSelect
      value={currentValue}
      onValueChange={handleSelect}
      options={options}
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="top"
      sideOffset={8}
      contentClassName="w-[28rem] max-w-[calc(100vw-2rem)]"
      tooltip={t('agentSelector.label')}
      tooltipSide="top"
      searchPlaceholder={t('agentSelector.searchPlaceholder')}
      emptyText={t('agentSelector.noResults')}
      aria-label={t('agentSelector.label')}
      optionAction={renderOptionAction}
      showRadio
      trigger={
        // min-w-32 (128 px) pins the trigger so the loading→loaded swap
        // doesn't reflow for common labels. Names longer than ~128 px
        // still grow on resolve. On narrow mobile viewports the pin is
        // dropped so the composer toolbar fits without overflowing the
        // send/mic cluster.
        <Button
          type="button"
          className="gap-1.5 sm:min-w-32"
          variant="ghost"
          size="sm"
          aria-label={t('agentSelector.label')}
          disabled={isAgentLoading}
        >
          <Bot className="size-3.5" aria-hidden="true" />
          <Skeletonize
            loading={isAgentLoading}
            label={t('agentSelector.label')}
          >
            <SkeletonBox>
              <span
                className={hasNoAgents ? 'text-muted-foreground' : undefined}
              >
                {currentLabel}
              </span>
            </SkeletonBox>
          </Skeletonize>
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      }
      footer={
        canManageAgents ? (
          <Button
            variant="ghost"
            className="w-full"
            icon={LayoutGrid}
            onClick={handleAddAgentClick}
          >
            {t('agentSelector.addAgent')}
          </Button>
        ) : undefined
      }
    />
  );
});
