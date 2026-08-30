'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { HeaderBreadcrumbSwitcher } from '@/app/components/layout/header-breadcrumb-switcher';
import type { SearchableSelectOption } from '@/app/components/ui/forms/searchable-select';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { useAutomations } from '../hooks/queries';
import { automationListTarget } from '../lib/list-target';

/**
 * Breadcrumb leaf for an automation page: the shared `HeaderBreadcrumbSwitcher`
 * over the same listing the Automations table shows — the org's automations
 * (project-bound included) on the org shell, one project's on the project
 * shell. A pick routes exactly like a list row: a single-bound sibling opens
 * inside its project shell, an org-level one on the org detail.
 */
export function AutomationBreadcrumbSwitcher({
  organizationId,
  automationSlug,
  displayName,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** The current automation's display name — the caller already derives it. */
  displayName: string;
  /** When set, offer this project's automations and stay inside its shell. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const automationsQuery = useAutomations(
    organizationId,
    projectId,
    projectId === undefined,
  );

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      // Slug order, matching the list — slugs are folder paths, so siblings
      // group by pack. The slug caption disambiguates same-named packs and
      // lets the search match it, the way the list searches name + slug.
      [...(automationsQuery.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((automation) => ({
          value: automation.name,
          label: automationDisplayName(
            automation.presentation,
            automation.name,
            locale,
          ),
          description: automation.name,
        })),
    [automationsQuery.data, locale],
  );

  return (
    <HeaderBreadcrumbSwitcher
      value={automationSlug}
      options={options}
      displayName={displayName}
      title={t('switcher.title')}
      searchPlaceholder={t('switcher.searchPlaceholder')}
      emptyText={t('switcher.empty')}
      ariaLabel={t('switcher.ariaLabel', { name: displayName })}
      onValueChange={(name) => {
        const row = automationsQuery.data?.find(
          (automation) => automation.name === name,
        );
        void navigate(
          automationListTarget({
            organizationId,
            name,
            boundProjectIds: row?.projectIds ?? [],
            ...(projectId !== undefined && { listProjectId: projectId }),
          }),
        );
      }}
    />
  );
}
