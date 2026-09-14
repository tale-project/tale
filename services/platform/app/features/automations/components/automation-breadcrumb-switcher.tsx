'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { HeaderBreadcrumbSwitcher } from '@/app/components/layout/header-breadcrumb-switcher';
import type { SearchableSelectOption } from '@/app/components/ui/forms/searchable-select';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { useAutomations } from '../hooks/queries';
import {
  automationDetailPathname,
  automationSwitchPathname,
} from '../lib/detail-paths';
import { automationTargetProjectId } from '../lib/list-target';

/**
 * Breadcrumb leaf for an automation page: the shared `HeaderBreadcrumbSwitcher`
 * over the org hub's complete listing, including project-bound automations.
 * Entering a project's detail must not remove the other siblings. A pick
 * keeps the current project when bound there; otherwise it routes like an
 * org list row to its own project or the org detail — and it keeps the tab
 * that is open (Editor, Versions, Runs), the way the project switcher keeps
 * a project's tab.
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
  /** Preserve this project's context when the selected automation is bound to it. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const automationsQuery = useAutomations(organizationId, undefined, true);

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      // Organization automations first, then project-bound ones, with slug
      // order within each group. The caption disambiguates same-named packs
      // and lets the search match the slug as well as the display name.
      [...(automationsQuery.data ?? [])]
        .sort(
          (a, b) =>
            Number(a.projectIds.length > 0) - Number(b.projectIds.length > 0) ||
            a.name.localeCompare(b.name),
        )
        .map((automation) => ({
          value: automation.name,
          group:
            automation.projectIds.length === 0 ? 'organization' : 'project',
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
        const boundProjectIds = row?.projectIds ?? [];
        const targetProjectId = automationTargetProjectId({
          ...(projectId !== undefined &&
            boundProjectIds.includes(projectId) && {
              listProjectId: projectId,
            }),
          boundProjectIds,
        });
        void navigate({
          to: automationSwitchPathname(
            location.pathname,
            automationDetailPathname({
              organizationId,
              automationSlug,
              ...(projectId !== undefined && { projectId }),
            }),
            automationDetailPathname({
              organizationId,
              automationSlug: name,
              ...(targetProjectId !== undefined && {
                projectId: targetProjectId,
              }),
            }),
          ),
        });
      }}
    />
  );
}
