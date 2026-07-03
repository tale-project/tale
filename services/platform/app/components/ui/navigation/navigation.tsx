'use client';

import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { UserButton } from '@/app/components/user-button';
import { NotificationBell } from '@/app/features/notifications/components/notification-bell';
import { useAbility } from '@/app/hooks/use-ability';
import { useIsMac } from '@/app/hooks/use-is-mac';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from './navigation-menu';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

function NavigationItem({ item }: { item: NavItem }) {
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

  const iconActiveStyle =
    isActive && accentColor ? { color: accentColor } : undefined;

  // Rail links are icon-only, so each link carries its label as an `aria-label`
  // for the accessible name (screen readers, keyboard users). The tooltip is the
  // sighted-hover affordance and, for items that own a global keyboard shortcut,
  // also shows a hint chip so the binding is discoverable.
  const tooltipContent = item.shortcut ? (
    <>
      {item.label}
      <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
        {item.shortcut}
      </span>
    </>
  ) : (
    item.label
  );

  if (item.external) {
    return (
      <NavigationMenuItem className={cn('relative')}>
        <Tooltip content={tooltipContent} side="right">
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.label}
            className="focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            <div
              className={cn(
                'relative flex items-center justify-center p-2 rounded-lg transition-colors',
                isActive ? (accentColor ? '' : 'bg-muted') : 'hover:bg-muted',
              )}
              style={activeStyle}
              data-active={isActive}
            >
              {Icon && (
                <Icon
                  className={cn(
                    'size-5 shrink-0 text-muted-foreground',
                    isActive && !accentColor && 'text-foreground',
                  )}
                  style={iconActiveStyle}
                />
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  aria-label={`${item.badge}`}
                  className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums"
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>
          </a>
        </Tooltip>
      </NavigationMenuItem>
    );
  }

  return (
    <NavigationMenuItem className={cn('relative')}>
      <Tooltip content={tooltipContent} side="right">
        <Link
          to={item.to}
          params={item.params}
          preload="render"
          aria-label={item.label}
          className="focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          <div
            className={cn(
              'relative flex items-center justify-center p-2 rounded-lg transition-colors',
              isActive ? (accentColor ? '' : 'bg-muted') : 'hover:bg-muted',
            )}
            style={activeStyle}
            data-active={isActive}
          >
            {Icon && (
              <Icon
                className={cn(
                  'size-5 shrink-0 text-muted-foreground',
                  isActive && !accentColor && 'text-foreground',
                )}
                style={iconActiveStyle}
              />
            )}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                aria-label={`${item.badge}`}
                className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums"
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </div>
        </Link>
      </Tooltip>
    </NavigationMenuItem>
  );
}

export interface NavigationProps {
  organizationId: string;
}

export function Navigation({ organizationId }: NavigationProps) {
  const { t: tCommon } = useT('common');
  const { primary, pinned } = useNavigationItems(organizationId);
  const navigate = useNavigate();
  const isMac = useIsMac();

  // New-chat shortcut, registered on the always-mounted rail so it works from
  // anywhere in the dashboard (it used to live in the chat header and only
  // fired while a chat was open). ⌥⌘N on Mac, Alt+Ctrl+N elsewhere — Option+N
  // is a dead key on macOS, so match on `code` ("KeyN"), not `key`. Navigating
  // to the base chat route resets to a fresh chat: when leaving an open thread
  // the chat layout's own thread→new effect clears the prior state.
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
    <NavigationMenu
      aria-label={tCommon('aria.mainNavigation')}
      className="border-border flex h-full flex-col"
    >
      <div className="flex flex-shrink-0 items-center justify-center py-3">
        <Link
          to="/dashboard/$id/chat"
          params={{ id: organizationId }}
          className="flex items-center justify-center"
        >
          <TaleLogo />
        </Link>
      </div>
      <div className="mx-1 min-h-0 flex-1 overflow-y-auto py-4">
        <NavigationMenuList className="block space-y-2 space-x-0">
          {primary.map((item) => (
            <NavigationItem key={item.href} item={item} />
          ))}
        </NavigationMenuList>
      </div>
      <div className="flex flex-shrink-0 flex-col items-center gap-2 py-3">
        <NotificationBell organizationId={organizationId} />
        <NavigationMenuList className="block space-y-2 space-x-0">
          {pinned.map((item) => (
            <NavigationItem key={item.href} item={item} />
          ))}
        </NavigationMenuList>
        <UserButton />
      </div>
    </NavigationMenu>
  );
}
