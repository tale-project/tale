import { AppWindow, KeyRound, Network, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

export type NavPath = '/sessions' | '/proxies' | '/secrets' | '/settings';

export interface NavItem {
  to: NavPath;
  icon: LucideIcon;
  label: string;
}

export interface NavItems {
  /** The sections, top of the rail. */
  primary: readonly NavItem[];
  /** Settings, at the foot of the rail. */
  pinned: readonly NavItem[];
}

/** The section a page belongs to: its own path or anything beneath it. */
export function isItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The sections of the app, from one list for the desktop rail and the phone's
 * tab bar, so the two navigations cannot drift. Mirrors `useNavigationItems` of
 * the platform (`app/hooks/use-navigation-items.ts`).
 */
export function useNavItems(): NavItems {
  const { t } = useT('navigation');
  return useMemo(
    () => ({
      primary: [
        { to: '/sessions', icon: AppWindow, label: t('sections.sessions') },
        { to: '/proxies', icon: Network, label: t('sections.proxies') },
        { to: '/secrets', icon: KeyRound, label: t('sections.secrets') },
      ],
      pinned: [
        { to: '/settings', icon: Settings, label: t('sections.settings') },
      ],
    }),
    [t],
  );
}
