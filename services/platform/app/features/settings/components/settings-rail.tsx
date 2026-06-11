'use client';

import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { API_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/api/nav-items';
import { GOVERNANCE_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/governance/nav-items';
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
  labelKey: 'personal' | 'organization';
  items: RailItem[];
}

/**
 * Left-rail settings navigation (replaces the horizontal tab strip). Renders
 * grouped sections — PERSONAL / ORGANIZATION — with indented rows. The two
 * sections that own sub-routes (API, Governance) are expandable rows: their
 * children render inline and indented while the current path is within that
 * section, and collapse to a single chevroned row otherwise. This mirrors the
 * Pencil `SettingsRailGovExpanded` component.
 */
export function SettingsRail({
  organizationId,
  showAccountTab = true,
}: SettingsRailProps) {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const { t: tGov } = useT('governance');
  const ability = useAbility();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const base = `/dashboard/${organizationId}/settings`;

  const sections = useMemo<RailSection[]>(() => {
    const personal: RailItem[] = [
      { kind: 'leaf', labelKey: 'account', path: 'account' },
      { kind: 'leaf', labelKey: 'personalization', path: 'personalization' },
    ];
    if (!showAccountTab) personal.shift();

    const organization: RailItem[] = [
      {
        kind: 'leaf',
        labelKey: 'organization',
        path: 'organization',
        can: ['read', 'orgSettings'],
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
        labelKey: 'branding',
        path: 'branding',
        can: ['read', 'orgSettings'],
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
        labelKey: 'providers',
        path: 'providers',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'skills',
        path: 'skills',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
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
        labelKey: 'dataResidency',
        path: 'deployment',
        matchMode: 'startsWith',
        can: ['read', 'orgSettings'],
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
    ];

    return [
      { key: 'personal', labelKey: 'personal', items: personal },
      { key: 'organization', labelKey: 'organization', items: organization },
    ];
  }, [showAccountTab, tNav, tGov]);

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
    <nav
      aria-label={tNav('userSettings')}
      className="bg-background border-border flex w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r py-6 pr-3 pl-4"
    >
      {sections.map((section) => {
        const visible = section.items.filter(
          (item) => !item.can || ability.can(item.can[0], item.can[1]),
        );
        if (visible.length === 0) return null;

        return (
          <div key={section.key} className="flex flex-col gap-1">
            <div className="px-2">
              <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                {tSettings(`menu.railSections.${section.labelKey}`)}
              </span>
            </div>
            <ul className="flex flex-col gap-0.5 pt-2">
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
                    expanded={isGroupActive(item)}
                    childrenItems={item.children}
                    pathname={pathname}
                  />
                ),
              )}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

const ROW_BASE =
  'flex items-center rounded-md px-2 py-1.5 text-[13px] transition-colors';

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
      <Link
        to={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW_BASE,
          active
            ? 'bg-muted text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          className,
        )}
      >
        {label}
      </Link>
    </li>
  );
}

/**
 * Expandable section row. The parent links to the section landing page and
 * carries a chevron; when the current route is within the section the chevron
 * points down and the children render indented beneath it. Otherwise the
 * chevron points right and the children are hidden — auto-expand-on-active-route
 * (no manual toggle, so navigation drives the disclosure state).
 */
function RailExpandableGroup({
  href,
  label,
  expanded,
  childrenItems,
  pathname,
}: {
  href: string;
  label: string;
  expanded: boolean;
  childrenItems: { slug: string; label: string }[];
  pathname: string;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // The parent row is "active" only on the section's exact landing page; once a
  // child is selected the highlight moves to that child.
  const parentActive = pathname === href;

  return (
    <li>
      <Link
        to={href}
        aria-current={parentActive ? 'page' : undefined}
        aria-expanded={expanded}
        className={cn(
          ROW_BASE,
          'justify-between',
          parentActive
            ? 'bg-muted text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
      >
        <span>{label}</span>
        <Chevron aria-hidden className="text-muted-foreground size-3.5" />
      </Link>
      {expanded && childrenItems.length > 0 && (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {childrenItems.map((child) => {
            const childHref = `${href}/${child.slug}`;
            const active =
              pathname === childHref || pathname.startsWith(`${childHref}/`);
            return (
              <RailRow
                key={child.slug}
                href={childHref}
                label={child.label}
                active={active}
                className="pl-5"
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}
