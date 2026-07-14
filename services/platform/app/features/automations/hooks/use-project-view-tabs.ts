'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import type { TabNavigationItem } from '@/app/components/ui/navigation/tab-navigation';
import type { Id } from '@/convex/_generated/dataModel';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';
import { startCase } from '@/lib/utils/string';

import { viewRouteId } from '../components/automation-view-body';
import { isAutomationViewErrorStub, useAutomations } from './use-automations';
import { useProjectAutomations } from './use-install-state';

/**
 * The project tab strip's view tabs: one tab per bundled view of every
 * project-scoped automation bound to this project (1 view = 1 tab — a view's
 * own sub-tabs live inside it). Labels resolve the pack's
 * `i18n.<locale>.title`; an untitled or invalid view falls back to its
 * start-cased route id. Sorted by automation slug so the strip is stable
 * across reloads.
 */
export function useProjectViewTabs(
  organizationId: string,
  projectId: Id<'projects'>,
): TabNavigationItem[] {
  const { locale } = useLocale();
  const { automations: bound } = useProjectAutomations(projectId);
  const { automations: installed } = useAutomations(organizationId);

  return useMemo(() => {
    const bySlug = new Map(installed.map((a) => [a.slug, a]));
    return [...bound]
      .sort((a, b) => a.automationSlug.localeCompare(b.automationSlug))
      .flatMap((binding) => {
        const automation = bySlug.get(binding.automationSlug);
        if (!automation || automation.scope !== 'project') return [];
        return automation.views.map((view, index): TabNavigationItem => {
          const routeId = viewRouteId(view, index);
          const title = isAutomationViewErrorStub(view)
            ? undefined
            : (resolveLocalizedProp(view.title, view.i18n, 'title', locale) ??
              view.title);
          return {
            label: title ?? startCase(routeId),
            href: `/dashboard/${organizationId}/projects/${projectId}/views/${automation.slug}/${routeId}`,
            matchMode: 'exact',
          };
        });
      });
  }, [bound, installed, locale, organizationId, projectId]);
}
