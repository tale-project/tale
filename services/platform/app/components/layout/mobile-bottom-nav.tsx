'use client';

import { BottomTabBar, type BottomTabBarItem } from '@tale/ui/bottom-tab-bar';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
  Bot,
  BrainIcon,
  Folder,
  Inbox,
  MessageCircle,
  MoreHorizontal,
  Settings as SettingsIcon,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { useAbility } from '@/app/hooks/use-ability';
import { useDisplayMode } from '@/app/hooks/use-display-mode';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface MobileBottomNavProps {
  organizationId: string;
}

interface PrimaryTab {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Path prefix used to compute `active`. */
  activePrefix: string;
  /** Optional CASL gate. */
  gate?: () => boolean;
}

interface OverflowItem {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
  activePrefix: string;
  /** Optional override for the default `activePrefix` startsWith check. */
  isActive?: (pathname: string) => boolean;
  gate?: () => boolean;
}

/**
 * In-flow bottom tab bar wired with the platform's primary destinations. Hidden
 * on `md+` viewports — desktop continues to use the sidebar. Lives alongside
 * (not inside) the hamburger drawer so secondary navigation (org switcher,
 * account, sub-routes) stays available without crowding the tab bar.
 *
 * Layout: a row of primary nav destinations followed by a "More" tab that
 * opens a bottom sheet listing the destinations that don't fit (Knowledge,
 * Automations) — the standard iOS overflow pattern. Each tab highlights only
 * when its route is active.
 */
export function MobileBottomNav({ organizationId }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const ability = useAbility();
  const { accentColor } = useBrandingContext();
  const { t: tNav } = useT('navigation');
  const { t: tProjects } = useT('projects');
  const [moreOpen, setMoreOpen] = useState(false);
  const { isStandalone, isMobileSafari } = useDisplayMode();
  // Mobile Safari doesn't expose its bottom toolbar via safe-area-inset, so
  // `pb-(--safe-bottom)` resolves to 0 and the tab bar collides with the
  // toolbar. Reserve extra clearance only in that case — installed PWAs and
  // other browsers already get correct insets.
  const needsSafariBottomClearance = isMobileSafari && !isStandalone;

  const tabs = useMemo<PrimaryTab[]>(
    () => [
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
        key: 'chat',
        label: tNav('chatWithAI'),
        icon: MessageCircle,
        to: `/dashboard/${organizationId}/chat`,
        activePrefix: `/dashboard/${organizationId}/chat`,
      },
      {
        key: 'agents',
        label: tNav('agents'),
        icon: Bot,
        to: `/dashboard/${organizationId}/agents`,
        activePrefix: `/dashboard/${organizationId}/agents`,
        gate: () => ability.can('write', 'agents'),
      },
    ],
    [ability, organizationId, tNav, tProjects],
  );

  const overflow = useMemo<OverflowItem[]>(
    () => [
      {
        key: 'knowledge',
        label: tNav('knowledge'),
        icon: BrainIcon,
        to: `/dashboard/${organizationId}/documents`,
        activePrefix: `/dashboard/${organizationId}/documents`,
      },
      {
        key: 'automations',
        label: tNav('automations'),
        icon: Workflow,
        to: `/dashboard/${organizationId}/automations`,
        activePrefix: `/dashboard/${organizationId}/automations`,
      },
      {
        key: 'settings',
        label: tNav('userSettings'),
        icon: SettingsIcon,
        to: `/dashboard/${organizationId}/settings`,
        activePrefix: `/dashboard/${organizationId}/settings`,
      },
    ],
    [organizationId, tNav],
  );

  const pathname = location.pathname;
  const isPathActive = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  const matchesOverflowItem = (item: OverflowItem) =>
    item.isActive ? item.isActive(pathname) : isPathActive(item.activePrefix);
  const moreActive = overflow.some(matchesOverflowItem);

  const items = useMemo<BottomTabBarItem[]>(() => {
    const primary: BottomTabBarItem[] = tabs
      .filter((tab) => (tab.gate ? tab.gate() : true))
      .map((tab) => {
        const active = isPathActive(tab.activePrefix);
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
    primary.push({
      key: 'more',
      label: tNav('more'),
      icon: MoreHorizontal,
      active: moreActive,
      accentColor: moreActive && accentColor ? accentColor : undefined,
      onSelect: () => setMoreOpen(true),
    });
    return primary;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isPathActive closes over `pathname`, which is the trigger
  }, [tabs, pathname, navigate, accentColor, moreActive, tNav]);

  return (
    <>
      <BottomTabBar
        items={items}
        ariaLabel={tNav('aria.primaryNavigation')}
        className={cn(needsSafariBottomClearance && 'pb-12')}
      />
      <Sheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        side="bottom"
        title={tNav('more')}
        description={tNav('aria.primaryNavigation')}
        className="h-auto! max-h-[60vh] rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
      >
        <ul role="list" className="flex flex-col gap-1">
          {overflow.map((item) => {
            const Icon = item.icon;
            const active = matchesOverflowItem(item);
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    void navigate({ to: item.to });
                  }}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    active
                      ? 'bg-muted text-foreground'
                      : 'hover:bg-muted/60 text-foreground',
                  )}
                >
                  <Icon
                    className="text-muted-foreground group-hover:text-foreground size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
