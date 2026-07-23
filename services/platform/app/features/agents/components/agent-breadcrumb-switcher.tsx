'use client';

import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import { useListAgents } from '@/app/features/agents/hooks/queries';
import { toConfigurableAgent } from '@/app/features/agents/utils/agent-list-item';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { cn } from '@/lib/utils/cn';

import { agentSwitchPathname } from '../lib/agent-switch-path';

/**
 * Breadcrumb leaf for an agent detail page: the current display name opens a
 * dropdown of sibling agents so the operator can jump between them without
 * returning to the Agents list. Portable editor tabs (instructions, tools, …)
 * stay put.
 */
export function AgentBreadcrumbSwitcher({
  organizationId,
  agentId,
  displayName,
}: {
  organizationId: string;
  agentId: string;
  displayName: string;
}) {
  const { t } = useT('settings');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { agents: rawAgents } = useListAgents(organizationId);

  const siblings = useMemo(() => {
    const rows = [];
    for (const raw of rawAgents ?? []) {
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      rows.push({
        name: agent.name,
        label: resolveAgentLocale(agent, locale).displayName || agent.name,
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [rawAgents, locale]);

  const items = useMemo<DropdownMenuGroup[]>(
    () => [
      siblings.map((sibling) => ({
        type: 'item' as const,
        label: sibling.label,
        selected: sibling.name === agentId,
        onClick: () => {
          if (sibling.name === agentId) return;
          const to = agentSwitchPathname(
            location.pathname,
            organizationId,
            agentId,
            sibling.name,
          );
          void navigate({ to, search: location.search });
        },
      })),
    ],
    [
      siblings,
      agentId,
      organizationId,
      navigate,
      location.pathname,
      location.search,
    ],
  );

  if (siblings.length === 0) {
    return <>{displayName}</>;
  }

  return (
    <DropdownMenu
      align="start"
      items={items}
      trigger={
        <button
          type="button"
          aria-label={t('agents.switcher.ariaLabel', { name: displayName })}
          className={cn(
            'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm',
            'hover:text-muted-foreground transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          )}
        >
          <span className="min-w-0 truncate">{displayName}</span>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </button>
      }
    />
  );
}
