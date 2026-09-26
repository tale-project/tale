'use client';

import { useAccentColor } from '@tale/ui/accent-color';
import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import {
  SECTION_NAV_ROW_CLASS,
  SectionNavPanel,
  SectionNavRow,
  sectionNavRowTone,
} from '@tale/ui/section-nav';
import {
  SubPanelDisclosureBody,
  SubPanelSectionHeader,
} from '@tale/ui/sub-panel-list';
import { useRouterState } from '@tanstack/react-router';
import {
  Bell,
  Box,
  Braces,
  Building2,
  ChartColumn,
  ChevronRight,
  Cpu,
  Database,
  Gauge,
  KeyRound,
  ListPlus,
  Palette,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { API_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/api/-nav-items';
import { GOVERNANCE_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/governance/-nav-items';
import { METRICS_NAV_ITEMS } from '@/app/routes/dashboard/$id/settings/metrics/-nav-items';
import { useT } from '@/lib/i18n/client';
import type { AppAction, AppSubject } from '@/lib/permissions/ability';

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
  icon: LucideIcon;
}

/** An expandable row whose sub-items render inline when its route is active. */
interface RailGroup {
  kind: 'group';
  labelKey: string;
  path: string;
  can?: [AppAction, AppSubject];
  icon: LucideIcon;
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
 * The settings sections, with the rows the caller's role may see. One source
 * for the panel and for the page header, which names the open page.
 */
function useSettingsSections(showAccountTab: boolean): RailSection[] {
  const { t: tNav } = useT('navigation');
  const { t: tGov } = useT('governance');
  const { t: tMetrics } = useT('metrics');
  const ability = useAbility();

  const sections = useMemo<RailSection[]>(() => {
    const personal: RailItem[] = [
      { kind: 'leaf', labelKey: 'account', path: 'account', icon: UserRound },
      {
        kind: 'leaf',
        labelKey: 'personalization',
        path: 'personalization',
        icon: SlidersHorizontal,
      },
      {
        kind: 'leaf',
        labelKey: 'notifications',
        path: 'notifications',
        icon: Bell,
      },
      // No `can`: every role has personal limits to read.
      { kind: 'leaf', labelKey: 'usage', path: 'usage', icon: Gauge },
    ];
    if (!showAccountTab) personal.shift();

    // Order is the designer's reading sequence: who we are (organization,
    // teams, members), then what the workspace runs on (providers,
    // connectors), then the rest.
    const organization: RailItem[] = [
      {
        kind: 'leaf',
        labelKey: 'organization',
        icon: Building2,
        path: 'organization',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'teams',
        icon: UsersRound,
        path: 'teams',
        matchMode: 'startsWith',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'members',
        icon: UserRoundCog,
        path: 'members',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'providers',
        icon: Cpu,
        path: 'providers',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'connectors',
        icon: Plug,
        path: 'connectors',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      // No `can`: any member may read the skills they are allowed to see, and
      // the action gates the skill actions apply per bundle.
      { kind: 'leaf', labelKey: 'skills', path: 'skills', icon: ListPlus },
      {
        kind: 'leaf',
        labelKey: 'branding',
        icon: Palette,
        path: 'branding',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'sandboxes',
        icon: Box,
        path: 'sandboxes',
        matchMode: 'startsWith',
        can: ['read', 'developerSettings'],
      },
      {
        kind: 'group',
        labelKey: 'governance',
        icon: ShieldCheck,
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
        icon: ChartColumn,
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
        icon: Braces,
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
        icon: KeyRound,
        path: 'enterprise-sso',
        matchMode: 'startsWith',
        can: ['read', 'orgSettings'],
      },
      {
        kind: 'leaf',
        labelKey: 'dataResidency',
        icon: Database,
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

  return useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) => !item.can || ability.can(item.can[0], item.can[1]),
          ),
        }))
        .filter((section) => section.items.length > 0),
    [sections, ability],
  );
}

function isLeafActive(item: RailLeaf, base: string, pathname: string) {
  const href = `${base}/${item.path}`;
  return item.matchMode === 'startsWith'
    ? pathname === href || pathname.startsWith(`${href}/`)
    : pathname === href;
}

function isWithin(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The open settings page — the rail entry the path sits in, with its name
 * ("Teams", "Governance · Budgets") for the page header beside the panel (the
 * panel's own header already says Settings) and its href as a stable
 * identity: a drawer or tab route inside a page keeps the page's key, so the
 * page is not remounted under it. `undefined` on the settings index.
 */
export function useSettingsPage(
  organizationId: string,
): { key: string; title: string } | undefined {
  const { t: tNav } = useT('navigation');
  const sections = useSettingsSections(true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const base = `/dashboard/${organizationId}/settings`;
  for (const section of sections) {
    for (const item of section.items) {
      const href = `${base}/${item.path}`;
      if (item.kind === 'leaf') {
        if (isLeafActive(item, base, pathname)) {
          return { key: href, title: tNav(item.labelKey) };
        }
        continue;
      }
      if (!isWithin(href, pathname)) continue;
      const child = item.children.find((entry) =>
        isWithin(`${href}/${entry.slug}`, pathname),
      );
      return child !== undefined
        ? {
            key: `${href}/${child.slug}`,
            title: `${tNav(item.labelKey)} · ${child.label}`,
          }
        : { key: href, title: tNav(item.labelKey) };
    }
  }
  return undefined;
}

/**
 * The Settings panel — the same frame as the Home panel: full height beside
 * the page, the section's name in an `h-13` header, then grouped rows
 * (PERSONAL / ORGANIZATION / ADVANCED) that each carry an icon, like every
 * other row in a section panel. One highlight glides to the open page, the
 * way the rail's does. The rows that own sub-pages (Governance, Metrics, API)
 * are disclosures whose children open inline.
 */
export function SettingsRail({
  organizationId,
  showAccountTab = true,
}: SettingsRailProps) {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sections = useSettingsSections(showAccountTab);
  const base = `/dashboard/${organizationId}/settings`;

  // Which group disclosures are open: a group opens when the route enters it
  // (deep links, redirects) but never closes on its own — collapsing is the
  // user's call.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const activeGroupPath = sections
    .flatMap((section) => section.items)
    .find(
      (item): item is RailGroup =>
        item.kind === 'group' && isWithin(`${base}/${item.path}`, pathname),
    )?.path;
  useEffect(() => {
    if (activeGroupPath === undefined) return;
    setOpenGroups((previous) =>
      previous.has(activeGroupPath)
        ? previous
        : new Set([...previous, activeGroupPath]),
    );
  }, [activeGroupPath]);
  const toggleGroup = (path: string) =>
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // The row the highlight rests on: the open leaf, the open child of an
  // expanded group, or a collapsed group that holds the open page.
  let activeKey: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const href = `${base}/${item.path}`;
      if (item.kind === 'leaf') {
        if (isLeafActive(item, base, pathname)) activeKey = href;
      } else if (isWithin(href, pathname)) {
        const child = item.children.find((entry) =>
          isWithin(`${href}/${entry.slug}`, pathname),
        );
        activeKey =
          openGroups.has(item.path) && child !== undefined
            ? `${href}/${child.slug}`
            : href;
      }
    }
  }
  return (
    <SectionNavPanel
      title={tNav('userSettings')}
      ariaLabel={tNav('userSettings')}
      activeKey={activeKey}
      layoutVersion={`${[...openGroups].join(',')}|${sections.length}`}
    >
      <Stack gap={5}>
        {sections.map((section) => (
          <Stack key={section.key} gap={1}>
            <SubPanelSectionHeader
              label={tSettings(`menu.railSections.${section.labelKey}`)}
            />
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const href = `${base}/${item.path}`;
                return item.kind === 'leaf' ? (
                  <SectionNavRow
                    key={item.path}
                    href={href}
                    label={tNav(item.labelKey)}
                    icon={item.icon}
                    active={href === activeKey}
                  />
                ) : (
                  <RailExpandableGroup
                    key={item.path}
                    href={href}
                    label={tNav(item.labelKey)}
                    icon={item.icon}
                    open={openGroups.has(item.path)}
                    onToggle={() => toggleGroup(item.path)}
                    activeKey={activeKey}
                    childrenItems={item.children}
                  />
                );
              })}
            </ul>
          </Stack>
        ))}
      </Stack>
    </SectionNavPanel>
  );
}

/**
 * Expandable section row. The row is a disclosure button (not a link): it
 * toggles its children open/closed, each group independently of the others.
 * Collapsed, it carries the highlight when the open page lives inside it, so
 * the active location stays visible; expanded, the child row carries it.
 */
function RailExpandableGroup({
  href,
  label,
  icon: Icon,
  open,
  onToggle,
  activeKey,
  childrenItems,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  activeKey: string | null;
  childrenItems: { slug: string; label: string }[];
}) {
  const accentColor = useAccentColor();
  const parentActive = activeKey === href;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-indicator-key={href}
        className={cn(
          SECTION_NAV_ROW_CLASS,
          'cursor-pointer text-left',
          sectionNavRowTone(parentActive),
        )}
        {...(parentActive && accentColor
          ? { style: { color: accentColor } }
          : {})}
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      <SubPanelDisclosureBody open={open}>
        {childrenItems.length > 0 && (
          <ul className="mt-0.5 flex flex-col gap-0.5 pb-0.5">
            {childrenItems.map((child) => {
              const childHref = `${href}/${child.slug}`;
              return (
                <SectionNavRow
                  key={child.slug}
                  href={childHref}
                  label={child.label}
                  active={childHref === activeKey}
                  indent
                />
              );
            })}
          </ul>
        )}
      </SubPanelDisclosureBody>
    </li>
  );
}
