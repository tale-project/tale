'use client';

import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMac } from '@tale/ui/use-is-mac';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { useAbility } from '@/app/hooks/use-ability';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useT } from '@/lib/i18n/client';

import { TOOLTIP_SHORTCUT_CLASS } from './sidebar-motion';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

function isItemActive(item: NavItem, pathname: string): boolean {
  return item.isActivePath
    ? item.isActivePath(pathname)
    : isPathMatch(item.href, pathname) ||
        (item.subItems?.some((subItem) =>
          isPathMatch(subItem.href, pathname),
        ) ??
          false);
}

export interface SidebarNavItemProps {
  item: NavItem;
  /**
   * The list draws the active fill as ONE shared pill that glides between
   * tiles (see `SidebarNav`); the tile then only switches its icon colour.
   * Standalone tiles (the pinned footer) paint their own fill.
   */
  sharedIndicator?: boolean;
}

/**
 * One primary-nav tile: a 36×36 icon-only link. The label rides along as the
 * accessible name (`aria-label`); the sighted-hover affordance is the
 * right-side tooltip (with a shortcut chip for items owning a global
 * binding).
 */
export function SidebarNavItem({
  item,
  sharedIndicator = false,
}: SidebarNavItemProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const ability = useAbility();
  const { accentColor } = useBrandingContext();

  const isActive = isItemActive(item, pathname);

  if (item.can && !ability.can(item.can[0], item.can[1])) {
    return null;
  }

  // Where this tile goes: the section's own landing page, every time. A rail
  // click is a request for the section, not for the last place inside it, so
  // it always lands on the same page — the first tab of a tabbed section —
  // whatever the user did there before.
  const linkProps = {
    to: item.to,
    params: item.params,
    ...(isActive && item.reentrySearch !== undefined
      ? { search: item.reentrySearch }
      : {}),
    preload: 'render',
  } as const;

  const Icon = item.icon;

  const activeStyle =
    isActive && accentColor
      ? sharedIndicator
        ? { color: accentColor }
        : { backgroundColor: `${accentColor}26`, color: accentColor }
      : undefined;

  // The tile's accessible name carries the badge. The link sets `aria-label`,
  // which overrides descendant content, so a count left inside `rowContent`
  // reaches no screen reader at all — and a bare "3" would say nothing anyway.
  // `badgeLabel` is the translated meaning ("3 unread conversations").
  const showBadge = item.badge !== undefined && item.badge > 0;
  const accessibleName =
    showBadge && item.badgeLabel !== undefined
      ? `${item.label}, ${item.badgeLabel}`
      : item.label;

  const tooltipContent = item.shortcut ? (
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
        'relative flex size-9 items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 active:scale-[0.94] motion-reduce:transition-none',
        isActive
          ? accentColor || sharedIndicator
            ? accentColor
              ? ''
              : 'text-foreground'
            : 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      style={activeStyle}
      data-active={isActive}
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {Icon && (
          <Icon
            className={cn(
              'size-5 shrink-0 transition-[stroke-width] duration-150',
              isActive && '[stroke-width:2.25]',
            )}
          />
        )}
        {showBadge && (
          <span
            // Re-keyed on the count so a new arrival pops the chip again.
            key={item.badge}
            aria-hidden="true"
            className="bg-primary text-primary-foreground ring-background animate-in zoom-in-50 absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums ring-2 duration-300 motion-reduce:animate-none"
          >
            {(item.badge ?? 0) > 99 ? '99+' : item.badge}
          </span>
        )}
      </span>
    </div>
  );

  const linkClassName =
    'focus-visible:ring-ring inline-block rounded-md focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset';

  const link = item.external ? (
    <a
      data-indicator-key={item.href}
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={accessibleName}
      className={linkClassName}
    >
      {rowContent}
    </a>
  ) : (
    <Link
      {...linkProps}
      data-indicator-key={item.href}
      aria-label={accessibleName}
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
}

/** The primary destinations list (owns the global new-chat shortcut). */
export function SidebarNav({ organizationId }: SidebarNavProps) {
  const { t: tCommon } = useT('common');
  const { primary } = useNavigationItems(organizationId);
  const navigate = useNavigate();
  const isMac = useIsMac();
  const { pathname } = useLocation();
  const { accentColor } = useBrandingContext();
  const activeHref =
    primary.find((item) => isItemActive(item, pathname))?.href ?? null;
  // One pill for the whole list: it glides from the tile you left to the
  // tile you chose, instead of one fill blinking out while another blinks in.
  const indicator = useSlidingIndicator<HTMLUListElement>(
    activeHref,
    primary.length,
  );

  // New-chat shortcut, registered on the always-mounted sidebar so it works
  // from anywhere in the dashboard. ⌥⌘N on Mac, Alt+Ctrl+N elsewhere —
  // Option+N is a dead key on macOS, so match on `code` ("KeyN"), not `key`.
  // `?new=1` keeps a fresh composer; plain /chat resumes the last thread.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        void navigate({
          to: '/dashboard/$id/chat',
          params: { id: organizationId },
          search: { new: true },
        });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, navigate, organizationId]);

  return (
    <nav aria-label={tCommon('aria.mainNavigation')}>
      <ul
        ref={indicator.containerRef}
        role="list"
        className="relative flex list-none flex-col gap-2"
      >
        <span
          aria-hidden
          style={
            accentColor
              ? { ...indicator.style, backgroundColor: `${accentColor}26` }
              : indicator.style
          }
          className={cn(
            'pointer-events-none absolute top-0 left-0 rounded-md',
            !accentColor && 'bg-muted',
            indicator.animated &&
              '[transition:transform_300ms_var(--ease-out-quint),opacity_150ms] motion-reduce:transition-none',
          )}
        />
        {primary.map((item) => (
          <SidebarNavItem key={item.href} item={item} sharedIndicator />
        ))}
      </ul>
    </nav>
  );
}
