'use client';

import {
  TabNavigation as UiTabNavigation,
  type TabNavigationItem as UiTabNavigationItem,
  type TabNavigationProps as UiTabNavigationProps,
} from '@tale/ui/tab-navigation';
import { useMemo } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { AppAction, AppSubject } from '@/lib/permissions/ability';

export interface TabNavigationItem extends UiTabNavigationItem {
  /** CASL ability check required to show this tab. When absent, always visible. */
  can?: [AppAction, AppSubject];
}

export interface TabNavigationProps extends Omit<
  UiTabNavigationProps,
  'items'
> {
  items: TabNavigationItem[];
}

/**
 * The platform's tab strip: the shared `@tale/ui` `TabNavigation` with the
 * viewer's CASL ability applied — a tab whose `can` check fails is dropped
 * before the strip lays anything out, so permission-gated sections never
 * flash into view.
 */
export function TabNavigation({ items, ...props }: TabNavigationProps) {
  const ability = useAbility();
  const accessibleItems = useMemo(
    () =>
      items.filter(
        (item) => !item.can || ability.can(item.can[0], item.can[1]),
      ),
    [items, ability],
  );
  return <UiTabNavigation {...props} items={accessibleItems} />;
}
