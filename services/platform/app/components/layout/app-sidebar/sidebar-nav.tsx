'use client';

import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMac } from '@tale/ui/use-is-mac';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { useAbility } from '@/app/hooks/use-ability';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { readNavTarget } from '@/app/lib/nav-memory';
import { useT } from '@/lib/i18n/client';

import { TOOLTIP_SHORTCUT_CLASS } from './sidebar-motion';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

export interface SidebarNavItemProps {
  item: NavItem;
  organizationId: string;
}

/**
 * One primary-nav tile: a 36×36 icon-only link. The label rides along as the
 * accessible name (`aria-label`); the sighted-hover affordance is the
 * right-side tooltip (with a shortcut chip for items owning a global
 * binding).
 */
export function SidebarNavItem({ item, organizationId }: SidebarNavItemProps) {
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

  // Where this tile goes. Already inside the section → its default entry,
  // which is the one-click way back out of a deep page (and, being recorded
  // like any navigation, becomes the new memory so the reset sticks).
  // Elsewhere → the place the user last had open, when one is still live.
  // Read on every render rather than memoized: this component already
  // re-renders on each location change, which is exactly when it changes.
  const remembered =
    isActive || item.section === undefined
      ? undefined
      : readNavTarget(organizationId, item.section);

  const linkProps = remembered
    ? ({
        to: `/dashboard/${organizationId}/${remembered.path}`,
        search: remembered.search,
        // Tells the landing page this place was restored, not chosen, so a
        // deleted entity falls back to the section rather than dead-ending.
        state: { navRestore: true },
        // A restored target is a deep route; prefetching six of them on every
        // dashboard render would load far more than the section roots do.
        preload: 'intent',
      } as const)
    : ({
        to: item.to,
        params: item.params,
        ...(isActive && item.reentrySearch !== undefined
          ? { search: item.reentrySearch }
          : {}),
        preload: 'render',
      } as const);

  const Icon = item.icon;

  const activeStyle =
    isActive && accentColor
      ? { backgroundColor: `${accentColor}26`, color: accentColor }
      : undefined;

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
        'relative flex size-9 items-center justify-center rounded-md',
        isActive
          ? accentColor
            ? ''
            : 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      style={activeStyle}
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
    <Link {...linkProps} aria-label={item.label} className={linkClassName}>
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
      <ul role="list" className="flex list-none flex-col gap-2">
        {primary.map((item) => (
          <SidebarNavItem
            key={item.href}
            item={item}
            organizationId={organizationId}
          />
        ))}
      </ul>
    </nav>
  );
}
