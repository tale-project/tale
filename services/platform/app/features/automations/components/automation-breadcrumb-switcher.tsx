'use client';

import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

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
 * dropdown of INSTALLED sibling automations (same membership as the hub's
 * Installed tab — install row present, no bundles). Portable `?tab=` values
 * (Configuration, Integrations, shared workflow tabs when both sides have
 * them) are kept; a tab the target does not expose is dropped so the page
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

  const items = useMemo<DropdownMenuGroup[]>(
    () => [
      siblings.map((sibling) => ({
        type: 'item' as const,
        label: sibling.name,
        selected: sibling.slug === automationSlug,
        onClick: () => {
          if (sibling.slug === automationSlug) return;
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
        },
      })),
    ],
    [
      siblings,
      automationSlug,
      organizationId,
      projectId,
      navigate,
      location.search,
      isDeveloper,
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
