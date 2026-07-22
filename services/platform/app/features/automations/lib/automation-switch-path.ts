import { automationSlugToParam } from '@/lib/shared/schemas/automations';

import { viewRouteId } from '../components/automation-view-body';
import type { AutomationSummary } from '../hooks/use-automations';
import { isAutomationViewErrorStub } from '../hooks/use-automations';

/** Reserved automation-page tab values — must stay in sync with `automation-page.tsx`. */
const RESERVED_TAB_VALUES = [
  'editor',
  'executions',
  'configuration',
  'triggers',
  'integrations',
  'environment',
] as const;

/**
 * Tab values the installed automation page would render for this automation —
 * the same gating as `InstalledAutomationBody` (developer + workflow →
 * Editor/Executions/Triggers/Environment; Integrations + Configuration always;
 * org-scoped bundled views as extra tabs). Used by the breadcrumb switcher so
 * a carried `?tab=` is kept only when the target actually exposes it.
 */
export function automationInstalledTabValues(
  automation: Pick<AutomationSummary, 'scope' | 'workflows' | 'views'>,
  isDeveloper: boolean,
): Set<string> {
  const workflowSlug = automation.workflows[0];
  const showDevTabs = isDeveloper && workflowSlug !== undefined;
  const used = new Set<string>(RESERVED_TAB_VALUES);
  const tabs = new Set<string>(['integrations', 'configuration']);
  if (showDevTabs) {
    tabs.add('editor');
    tabs.add('executions');
    tabs.add('triggers');
    tabs.add('environment');
  }
  if (automation.scope !== 'project') {
    automation.views.forEach((view, index) => {
      const raw = isAutomationViewErrorStub(view)
        ? view.id
        : viewRouteId(view, index);
      let value = raw;
      while (used.has(value)) value = `view-${value}`;
      used.add(value);
      tabs.add(value);
    });
  }
  return tabs;
}

/**
 * Path + search for an automation breadcrumb switch.
 *
 * Always the target automation's detail root (never `/runs/…` — run ids are
 * not portable). `?tab=` is kept only when {@link targetTabValues} includes
 * it; otherwise the search is cleared so the page picks its own default —
 * avoiding a missing Editor/Triggers/… surface on automations without a
 * workflow (or when the operator isn't a developer).
 */
export function automationSwitchLocation({
  organizationId,
  toSlug,
  projectId,
  search,
  targetTabValues,
}: {
  organizationId: string;
  toSlug: string;
  projectId?: string;
  search: Record<string, unknown>;
  targetTabValues: ReadonlySet<string>;
}): { pathname: string; search: Record<string, unknown> } {
  const toParam = automationSlugToParam(toSlug);
  const pathname =
    projectId !== undefined
      ? `/dashboard/${organizationId}/projects/${projectId}/automations/${toParam}`
      : `/dashboard/${organizationId}/automations/${toParam}`;
  const tab = search.tab;
  return {
    pathname,
    search: typeof tab === 'string' && targetTabValues.has(tab) ? { tab } : {},
  };
}
