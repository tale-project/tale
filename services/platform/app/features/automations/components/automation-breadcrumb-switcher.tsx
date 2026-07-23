'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { resolveAutomationLocale } from '@/lib/shared/utils/resolve-automation-locale';
import { cn } from '@/lib/utils/cn';

import { useAutomations } from '../hooks/use-automations';
import { useAutomationInstallStates } from '../hooks/use-install-state';
import {
  automationInstalledTabValues,
  automationSwitchLocation,
} from '../lib/automation-switch-path';

/**
 * Breadcrumb leaf for an automation detail page: the current name opens a
 * searchable switcher of INSTALLED sibling automations (same membership as the
 * hub's Installed tab — install row present, no bundles). Portable `?tab=`
 * values (Configuration, Integrations, shared workflow tabs when both sides
 * have them) are kept; a tab the target does not expose is dropped so the page
 * lands on its own default instead of a missing Editor/Triggers surface.
 */
export function AutomationBreadcrumbSwitcher({
  organizationId,
  automationSlug,
  displayName,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  displayName: string;
  /** When set, switches stay on the project-scoped automation route. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const ability = useAbility();
  const isDeveloper = ability.can('read', 'developerSettings');
  const { automations } = useAutomations(organizationId);
  const { bySlug: installBySlug } = useAutomationInstallStates(organizationId);

  const siblings = useMemo(
    () =>
      automations
        .filter(
          (automation) =>
            automation.kind !== 'bundle' &&
            installBySlug.get(automation.slug) != null,
        )
        .map((automation) => ({
          slug: automation.slug,
          name: resolveAutomationLocale(automation, locale).name,
          automation,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [automations, installBySlug, locale],
  );

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      siblings.map((sibling) => ({
        value: sibling.slug,
        label: sibling.name,
      })),
    [siblings],
  );

  const siblingBySlug = useMemo(
    () => new Map(siblings.map((sibling) => [sibling.slug, sibling])),
    [siblings],
  );

  if (options.length === 0) {
    return <>{displayName}</>;
  }

  return (
    <SearchableSelect
      variant="switcher"
      align="start"
      contentClassName="min-w-64"
      value={automationSlug}
      options={options}
      title={t('switcher.title')}
      searchPlaceholder={t('switcher.searchPlaceholder')}
      emptyText={t('switcher.empty')}
      aria-label={t('switcher.ariaLabel', { name: displayName })}
      onValueChange={(nextSlug) => {
        if (nextSlug === automationSlug) return;
        const sibling = siblingBySlug.get(nextSlug);
        if (!sibling) return;
        const next = automationSwitchLocation({
          organizationId,
          toSlug: sibling.slug,
          projectId,
          search: location.search as Record<string, unknown>,
          targetTabValues: automationInstalledTabValues(
            sibling.automation,
            isDeveloper,
          ),
        });
        void navigate({ to: next.pathname, search: next.search });
      }}
      trigger={
        <button
          type="button"
          aria-label={t('switcher.ariaLabel', { name: displayName })}
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
