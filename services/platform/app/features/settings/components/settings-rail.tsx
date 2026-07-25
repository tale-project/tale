'use client';

import { Stack } from '@tale/ui/layout';
import { useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import {
  SUB_PANEL_ROW_CLASS,
  SubPanelDisclosureBody,
  SubPanelRowLink,
  SubPanelSectionHeader,
  useSubPanelRowTreatment,
} from '@/app/components/layout/sub-panel-list';
import { useAbility } from '@/app/hooks/use-ability';
import { API_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/api/-nav-items';
import { GOVERNANCE_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/governance/-nav-items';
import { METRICS_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/metrics/-nav-items';
import { useT } from '@/lib/i18n/client';
import type { AppAction, AppSubject } from '@/lib/permissions/ability';
import { cn } from '@/lib/utils/cn';

interface SettingsRailProps {
  organizationId: string;
  /** Hide the Account row (callers that render account elsewhere). */
  showAccountTab?: boolean;
}

/** A leaf navigation row. */
interface RailLeaf {
  kind: 'leaf';
  /** i18n key under the `navigation` namespace. */
  labelKey: string;
  /** Path segment(s) appended to the settings base path. */
  path: string;
  /** Active-state match strategy. */
  matchMode?: 'exact' | 'startsWith';
  can?: [AppAction, AppSubject];
}

/** An expandable row whose sub-items render inline when its route is active. */
interface RailGroup {
  kind: 'group';
  labelKey: string;
  path: string;
  can?: [AppAction, AppSubject];
  /** Sub-items shown indented under the group when the section is active. */
  children: {
    /** Path segment appended to the group's base path. */
    slug: string;
    /** Resolved, already-localized label. */
    label: string;
  }[];
}

type RailItem = RailLeaf | RailGroup;

interface RailSection {
  /** Stable React key for the section. */
  key: string;
  /** i18n key under `settings.menu.railSections`. */
  labelKey: 'personal' | 'organization' | 'advanced';
  items: RailItem[];
}

/**
 * Left-rail settings navigation (replaces the horizontal tab strip). Renders
 * grouped sections — PERSONAL / ORGANIZATION / ADVANCED — with indented
 * rows. The two rows that own sub-routes (Governance, API) are expandable:
 * their children render inline and indented while the current path is within
 * that section, and collapse to a single chevroned row otherwise. This mirrors
 * the Pencil `SettingsRailGovExpanded` component.
 */
export function SettingsRail({
  organizationId,
  showAccountTab = true,
}: SettingsRailProps) {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const { t: tGov } = useT('governance');
  const { t: tMetrics } = useT('metrics');
  const ability = useAbility();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const base = `/dashboard/${organizationId}/settings`;

  const sections = useMemo<RailSection[]>(() => {
    const personal: RailItem[] = [
      { kind: 'leaf', labelKey: 'account', path: 'account' },
      { kind: 'leaf', labelKey: 'personalization', path: 'personalization' },
      { kind: 'leaf', labelKey: 'notifications', path: 'notifications' },
      { kind: 'leaf', labelKey: 'environment', path: 'environment' },
    ];
    if (!showAccountTab) personal.shift();

    const organization: RailItem[] = [
      {
        kind: 'leaf',
        labelKey: 'organization',
        path: 'organization',
        can: ['read', 'orgSettings'],
      },
      // Day-1 recovery after skip-provider: AI providers first among the
      // remaining org settings so "Settings → AI providers" is easy to find.
      {
        kind: 'leaf',
        labelKey: 'providers',
        path: 'providers',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'teams',
        path: 'teams',
        matchMode: 'startsWith',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'skills',
        path: 'skills',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'integrations',
        path: 'integrations',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'branding',
        path: 'branding',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'sandboxes',
        path: 'sandboxes',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'group',
        labelKey: 'governance',
        path: 'governance',
        can: ['read', 'orgSettings'],
        children: GOVERNANCE_NAV_ITEMS.map((item) => ({
          slug: item.slug,
          label: tGov(`groups.${item.labelKey}`),
        })),
      },
      {
        kind: 'group',
        labelKey: 'metrics',
        path: 'metrics',
        can: ['read', 'orgSettings'],
        children: METRICS_NAV_ITEMS.map((item) => ({
          slug: item.slug,
          label: tMetrics(`groups.${item.labelKey}`),
        })),
      },
    ];

    const advanced: RailItem[] = [
      {
        kind: 'group',
        labelKey: 'api',
        path: 'api',
        can: ['read', 'developerSettings'],
        children: API_NAV_ITEMS.map((item) => ({
          slug: item.slug,
          label: tNav(item.labelKey),
        })),
      },
      {
        kind: 'leaf',
        labelKey: 'enterpriseSso',
        path: 'enterprise-sso',
        matchMode: 'startsWith',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'dataResidency',
        path: 'data-residency',
        can: ['read', 'orgSettings'],
      },
    ];

    return [
      { key: 'personal', labelKey: 'personal', items: personal },
      { key: 'organization', labelKey: 'organization', items: organization },
      { key: 'advanced', labelKey: 'advanced', items: advanced },
    ];
  }, [showAccountTab, tNav, tGov, tMetrics]);

  const isLeafActive = (item: RailLeaf): boolean => {
    const href = `${base}/${item.path}`;
    return item.matchMode === 'startsWith'
      ? pathname === href || pathname.startsWith(`${href}/`)
      : pathname === href;
  };

  const isGroupActive = (item: RailGroup): boolean => {
    const href = `${base}/${item.path}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <SubPanel as="nav" ariaLabel={tNav('userSettings')}>
      <Stack gap={6} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => {
          const visible = section.items.filter(
            (item) => !item.can || ability.can(item.can[0], item.can[1]),
          );
          if (visible.length === 0) return null;

          return (
            <Stack key={section.key} gap={1}>
              <SubPanelSectionHeader
                label={tSettings(`menu.railSections.${section.labelKey}`)}
              />
              <ul className="flex flex-col gap-0.5">
                {visible.map((item) =>
                  item.kind === 'leaf' ? (
                    <RailRow
                      key={item.path}
                      href={`${base}/${item.path}`}
                      label={tNav(item.labelKey)}
                      active={isLeafActive(item)}
                    />
                  ) : (
                    <RailExpandableGroup
                      key={item.path}
                      href={`${base}/${item.path}`}
                      label={tNav(item.labelKey)}
                      active={isGroupActive(item)}
                      childrenItems={item.children}
                      pathname={pathname}
                    />
                  ),
                )}
              </ul>
            </Stack>
          );
        })}
      </Stack>
    </SubPanel>
  );
}

function RailRow({
  href,
  label,
  active,
  className,
}: {
  href: string;
  label: string;
  active: boolean;
  className?: string;
}) {
  return (
    <li>
      <SubPanelRowLink to={href} active={active} className={className}>
        {label}
      </SubPanelRowLink>
    </li>
  );
}

/**
 * Expandable section row. The row is a disclosure button (not a link): it
 * toggles its children open/closed, each group independently of the others.
 * Navigating into the section (via a child link, a deep link, or the mobile
 * overview) auto-opens the group, but never forces it closed — the user owns
 * the disclosure state from then on.
 */
function RailExpandableGroup({
  href,
  label,
  active,
  childrenItems,
  pathname,
}: {
  href: string;
  label: string;
  /** Whether the current route lives inside this section. */
  active: boolean;
  childrenItems: { slug: string; label: string }[];
  pathname: string;
}) {
  const [open, setOpen] = useState(active);

  // Auto-open when the route enters the section (deep links, mobile overview,
  // redirects) — but never auto-close; collapsing is the user's call.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  // Highlight the collapsed parent when the current page lives inside it, so
  // the active location stays visible; expanded, the child row carries it.
  const parentActive = active && !open;
  const parentTreatment = useSubPanelRowTreatment(parentActive);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'w-full cursor-pointer justify-between text-left',
          parentTreatment.className,
        )}
        {...(parentTreatment.style !== undefined
          ? { style: parentTreatment.style }
          : {})}
      >
        <span>{label}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      <SubPanelDisclosureBody open={open}>
        {childrenItems.length > 0 && (
          <ul className="mt-0.5 flex flex-col gap-0.5 pb-0.5">
            {childrenItems.map((child) => {
              const childHref = `${href}/${child.slug}`;
              const childActive =
                pathname === childHref || pathname.startsWith(`${childHref}/`);
              return (
                <RailRow
                  key={child.slug}
                  href={childHref}
                  label={child.label}
                  active={childActive}
                  className="pl-5"
                />
              );
            })}
          </ul>
        )}
      </SubPanelDisclosureBody>
    </li>
  );
}
