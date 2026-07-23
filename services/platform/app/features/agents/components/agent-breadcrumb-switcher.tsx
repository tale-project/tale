'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import {
  useAgentInstallations,
  useListAgents,
} from '@/app/features/agents/hooks/queries';
import { toConfigurableAgent } from '@/app/features/agents/utils/agent-list-item';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { cn } from '@/lib/utils/cn';

import { agentSwitchPathname } from '../lib/agent-switch-path';

/**
 * Breadcrumb leaf for an agent detail page: the current display name opens a
 * searchable switcher of sibling agents so the operator can jump between them
 * without returning to the Agents list. Portable editor tabs (instructions,
 * tools, …) stay put.
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
  const installs = useAgentInstallations(organizationId);

  const options = useMemo<SearchableSelectOption[]>(() => {
    // Offer only INSTALLED + enabled agents as switch targets — the same gate
    // the Agents list applies (see `agents-table.tsx`). The on-disk catalog
    // `useListAgents` returns also carries un-installed and retired agents,
    // which must not appear here.
    const enabledSlugs = new Set<string>();
    const states = installs.data as
      | ReadonlyArray<{ agentSlug: string; enabled: boolean }>
      | undefined;
    for (const s of states ?? []) {
      if (s.enabled) enabledSlugs.add(s.agentSlug);
    }

    const rows: SearchableSelectOption[] = [];
    for (const raw of rawAgents ?? []) {
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      // `agent.name` is the slug; install state keys on `agentSlug`.
      if (!enabledSlugs.has(agent.name)) continue;
      rows.push({
        value: agent.name,
        label: resolveAgentLocale(agent, locale).displayName || agent.name,
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [rawAgents, installs.data, locale]);

  if (options.length === 0) {
    return <>{displayName}</>;
  }

  return (
    <SearchableSelect
      variant="switcher"
      align="start"
      contentClassName="min-w-64"
      value={agentId}
      options={options}
      title={t('agents.switcher.title')}
      searchPlaceholder={t('agents.switcher.searchPlaceholder')}
      emptyText={t('agents.switcher.empty')}
      aria-label={t('agents.switcher.ariaLabel', { name: displayName })}
      onValueChange={(nextId) => {
        if (nextId === agentId) return;
        const to = agentSwitchPathname(
          location.pathname,
          organizationId,
          agentId,
          nextId,
        );
        void navigate({ to, search: location.search });
      }}
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
