'use client';

import { BottomTabBar, type BottomTabBarItem } from '@tale/ui/bottom-tab-bar';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Bot, BrainIcon, Folder, Inbox, MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

export interface MobileBottomNavProps {
  organizationId: string;
}

interface PrimaryTab {
  key: string;
  label: string;
  icon: BottomTabBarItem['icon'];
  to: string;
  /** Path prefix used to compute `active`. */
  activePrefix: string;
  /** Optional CASL gate. */
  gate?: () => boolean;
}

/**
 * Fixed bottom tab bar wired with the platform's primary destinations. Hidden
 * on `md+` viewports — desktop continues to use the sidebar. Lives alongside
 * (not inside) the hamburger drawer so secondary navigation (org switcher,
 * account, sub-routes) stays available without crowding the tab bar.
 */
export function MobileBottomNav({ organizationId }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const ability = useAbility();
  const { accentColor } = useBrandingContext();
  const { t: tNav } = useT('navigation');
  const { t: tProjects } = useT('projects');

  const tabs = useMemo<PrimaryTab[]>(
    () => [
      {
        key: 'chat',
        label: tNav('chatWithAI'),
        icon: MessageCircle,
        to: `/dashboard/${organizationId}/chat`,
        activePrefix: `/dashboard/${organizationId}/chat`,
      },
      {
        key: 'projects',
        label: tProjects('title'),
        icon: Folder,
        to: `/dashboard/${organizationId}/projects`,
        activePrefix: `/dashboard/${organizationId}/projects`,
        gate: () => ability.can('read', 'projects'),
      },
      {
        key: 'conversations',
        label: tNav('conversations'),
        icon: Inbox,
        to: `/dashboard/${organizationId}/conversations/open`,
        activePrefix: `/dashboard/${organizationId}/conversations`,
      },
      {
        key: 'agents',
        label: tNav('agents'),
        icon: Bot,
        to: `/dashboard/${organizationId}/agents`,
        activePrefix: `/dashboard/${organizationId}/agents`,
        gate: () => ability.can('write', 'agents'),
      },
      {
        key: 'knowledge',
        label: tNav('knowledge'),
        icon: BrainIcon,
        to: `/dashboard/${organizationId}/documents`,
        activePrefix: `/dashboard/${organizationId}/documents`,
      },
    ],
    [ability, organizationId, tNav, tProjects],
  );

  // Publish the bar's measured height as `--mobile-nav-height` so the
  // dashboard `<main>` can reserve exactly the right padding-bottom.
  // `BottomTabBar` labels are `line-clamp-2`, so locales with long words
  // (e.g. de: "Konversationen") wrap and grow the bar past any hard-coded
  // reservation. ResizeObserver keeps the var in sync when fonts load,
  // the locale switches, or rotation reflows labels.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const update = () => {
      document.documentElement.style.setProperty(
        '--mobile-nav-height',
        `${el.offsetHeight}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--mobile-nav-height');
    };
  }, []);

  const items = useMemo<BottomTabBarItem[]>(() => {
    const pathname = location.pathname;
    return tabs
      .filter((tab) => (tab.gate ? tab.gate() : true))
      .map((tab) => {
        const active =
          pathname === tab.activePrefix ||
          pathname.startsWith(`${tab.activePrefix}/`);
        return {
          key: tab.key,
          label: tab.label,
          icon: tab.icon,
          active,
          accentColor: active && accentColor ? accentColor : undefined,
          onSelect: () => {
            void navigate({ to: tab.to });
          },
        };
      });
  }, [tabs, location.pathname, navigate, accentColor]);

  return (
    <BottomTabBar
      ref={navRef}
      items={items}
      ariaLabel={tNav('aria.primaryNavigation')}
    />
  );
}
