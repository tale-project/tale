'use client';

import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useAbility } from '@/app/hooks/use-ability';
import { useIsMac } from '@/app/hooks/use-is-mac';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  labelFadeClass,
  ROW_TRANSITION_CLASS,
  rowWidthStyle,
  TOOLTIP_SHORTCUT_CLASS,
} from './sidebar-motion';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

export interface SidebarNavItemProps {
  item: NavItem;
  /** Sidebar state: full labelled row (true) ↔ 32×32 icon tile (false). */
  expanded: boolean;
}

/**
 * One primary-nav row. Constant geometry across states: the icon sits 6px into
 * the row in both, so expand/collapse only animates the row width (in sync
 * with the panel) and fades the label — icons never move.
 */
export function SidebarNavItem({ item, expanded }: SidebarNavItemProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const ability = useAbility();
  const { accentColor } = useBrandingContext();

  const isActive = item.isActivePath
    ? item.isActivePath(pathname)
    : isPathMatch(item.href, pathname) ||
      item.subItems?.some((subItem) => isPathMatch(subItem.href, pathname));

  if (item.can && !ability.can(item.can[0], item.can[1])) {
    return null;
  }

  const Icon = item.icon;

  const activeStyle =
    isActive && accentColor
      ? { backgroundColor: `${accentColor}26`, color: accentColor }
      : undefined;

  // Collapsed rows are icon-only, so each link carries its label as an
  // `aria-label` for the accessible name; the sighted-hover affordance is the
  // right-side tooltip (with a shortcut chip for items owning a global
  // binding). Expanded rows show the label, so the tooltip drops away.
  const tooltipContent = expanded ? null : item.shortcut ? (
    <>
      {item.label}
      <span className={TOOLTIP_SHORTCUT_CLASS}>{item.shortcut}</span>
    </>
  ) : (
    item.label
  );

  const rowContent = (
    <div
      className={cn(
        'relative flex h-8 items-center gap-2.5 overflow-hidden rounded-md pr-2 pl-1.5',
        ROW_TRANSITION_CLASS,
        isActive
          ? accentColor
            ? ''
            : 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      style={{ ...rowWidthStyle(expanded), ...activeStyle }}
      data-active={isActive}
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {Icon && <Icon className="size-5 shrink-0" />}
        {item.badge !== undefined && item.badge > 0 && (
          <span
            aria-label={`${item.badge}`}
            className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums"
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          labelFadeClass(expanded),
        )}
      >
        {item.label}
      </span>
    </div>
  );

  const linkClassName =
    'focus-visible:ring-ring inline-block rounded-md focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset';

  const link = item.external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.label}
      className={linkClassName}
    >
      {rowContent}
    </a>
  ) : (
    <Link
      to={item.to}
      params={item.params}
      preload="render"
      aria-label={item.label}
      className={linkClassName}
    >
      {rowContent}
    </Link>
  );

  return (
    <li className="relative">
      <Tooltip content={tooltipContent} side="right">
        {link}
      </Tooltip>
    </li>
  );
}

export interface SidebarNavProps {
  organizationId: string;
  expanded: boolean;
}

/** The primary destinations list (owns the global new-chat shortcut). */
export function SidebarNav({ organizationId, expanded }: SidebarNavProps) {
  const { t: tCommon } = useT('common');
  const { primary } = useNavigationItems(organizationId);
  const navigate = useNavigate();
  const isMac = useIsMac();

  // New-chat shortcut, registered on the always-mounted sidebar so it works
  // from anywhere in the dashboard. ⌥⌘N on Mac, Alt+Ctrl+N elsewhere —
  // Option+N is a dead key on macOS, so match on `code` ("KeyN"), not `key`.
  // Navigating to the base chat route resets to a fresh chat: when leaving an
  // open thread the chat layout's own thread→new effect clears the prior
  // state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        void navigate({
          to: '/dashboard/$id/chat',
          params: { id: organizationId },
        });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, navigate, organizationId]);

  return (
    <nav aria-label={tCommon('aria.mainNavigation')} className="px-2">
      <ul role="list" className="flex list-none flex-col gap-0.5">
        {primary.map((item) => (
          <SidebarNavItem key={item.href} item={item} expanded={expanded} />
        ))}
      </ul>
    </nav>
  );
}
