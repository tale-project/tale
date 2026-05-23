'use client';

import { BottomTabBar, type BottomTabBarItem } from '@tale/ui/bottom-tab-bar';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Bot, BrainIcon, Inbox, MessageCircle, Settings } from 'lucide-react';
import { useMemo } from 'react';

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
      {
        key: 'settings',
        label: tNav('settings'),
        icon: Settings,
        to: `/dashboard/${organizationId}/settings`,
        activePrefix: `/dashboard/${organizationId}/settings`,
      },
    ],
    [ability, organizationId, tNav],
  );

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
    <BottomTabBar items={items} ariaLabel={tNav('aria.primaryNavigation')} />
  );
}
