'use client';

import { BottomTabBar, type BottomTabBarItem } from '@tale/ui/bottom-tab-bar';
import { useMobileKeyboard } from '@tale/ui/use-mobile-keyboard';
import { useScrollCompact } from '@tale/ui/use-scroll-compact';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { House } from 'lucide-react';
import { useLayoutEffect, useMemo } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { useAbility } from '@/app/hooks/use-ability';
import { useDisplayMode } from '@/app/hooks/use-display-mode';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useT } from '@/lib/i18n/client';

export interface MobileBottomNavProps {
  organizationId: string;
}

function isPathMatch(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isItemActive(item: NavItem, pathname: string): boolean {
  return item.isActivePath
    ? item.isActivePath(pathname)
    : isPathMatch(item.href, pathname) ||
        (item.subItems?.some((sub) => isPathMatch(sub.href, pathname)) ??
          false);
}

/**
 * The phone's tab bar: the same sections as the desktop rail, from the same
 * list (`useNavigationItems`), so the two navigations cannot drift — Home,
 * Knowledge, Automations and Settings, four tabs and no overflow sheet.
 * Hidden on `md+`, where the rail takes over.
 *
 * One difference from the rail: Home opens the Home list — on a phone the
 * list of chats, tasks and conversations IS the Home screen, where a desktop
 * keeps it as the panel beside the page. A tab always lands on its section's
 * own first page, whatever was open there before.
 */
export function MobileBottomNav({ organizationId }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ability = useAbility();
  const { accentColor } = useBrandingContext();
  const { t: tNav } = useT('navigation');
  const { primary, pinned } = useNavigationItems(organizationId);
  const { isStandalone, isMobileSafari } = useDisplayMode();
  const keyboard = useMobileKeyboard();
  const { compact, expand } = useScrollCompact(pathname, keyboard.open);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(
      'boot-safari-toolbar',
      isMobileSafari && !isStandalone,
    );
  }, [isMobileSafari, isStandalone]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-mobile-keyboard', keyboard.open);
    if (keyboard.height !== undefined) {
      root.style.setProperty('--mobile-visual-height', `${keyboard.height}px`);
    } else {
      root.style.removeProperty('--mobile-visual-height');
    }
    return () => {
      root.removeAttribute('data-mobile-keyboard');
      root.style.removeProperty('--mobile-visual-height');
    };
  }, [keyboard.open, keyboard.height]);

  const items = useMemo<BottomTabBarItem[]>(
    () =>
      [...primary, ...pinned]
        .filter((item) => !item.can || ability.can(item.can[0], item.can[1]))
        .map((item, index) => {
          const active = isItemActive(item, pathname);
          // A zero is the resting state, not a chip reading "0".
          const showBadge = item.badge !== undefined && item.badge > 0;
          const isHome = index === 0;
          return {
            key: item.href,
            label: item.label,
            icon: item.icon ?? House,
            active,
            accentColor: active && accentColor ? accentColor : undefined,
            badge: showBadge ? item.badge : undefined,
            badgeLabel: showBadge ? item.badgeLabel : undefined,
            onSelect: () => {
              void navigate(
                isHome
                  ? {
                      to: '/dashboard/$id/home',
                      params: { id: organizationId },
                    }
                  : { to: item.to, params: item.params },
              );
            },
          };
        }),
    [primary, pinned, ability, pathname, accentColor, navigate, organizationId],
  );

  return (
    <BottomTabBar
      items={items}
      ariaLabel={tNav('aria.primaryNavigation')}
      compact={compact}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) expand();
      }}
      onClickCapture={expand}
    />
  );
}
