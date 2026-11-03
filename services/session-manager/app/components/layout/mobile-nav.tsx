import { BottomTabBar, type BottomTabBarItem } from '@tale/ui/bottom-tab-bar';
import { useMobileKeyboard } from '@tale/ui/use-mobile-keyboard';
import { useScrollCompact } from '@tale/ui/use-scroll-compact';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useLayoutEffect, useMemo } from 'react';

import { isItemActive, useNavItems } from '@/app/hooks/use-nav-items';
import { useT } from '@/lib/i18n/client';

/**
 * The phone's tab bar: the same sections as the rail, from the same list. Hidden
 * on `md+`, where the rail takes over. A tab always opens its section's first
 * page, whatever was open there before.
 *
 * It does what the platform's bar does (`mobile-bottom-nav.tsx`): while the
 * software keyboard is open it tells the document (`data-mobile-keyboard` and
 * `--mobile-visual-height` on `<html>`), where the shared styles hide the bar
 * and fit the shell above the keyboard; and as the page scrolls it shrinks to a
 * capsule of icons, growing back on a tap or on keyboard focus.
 */
export function MobileNav() {
  const { t } = useT('navigation');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { primary, pinned } = useNavItems();
  const keyboard = useMobileKeyboard();
  const { compact, expand } = useScrollCompact(pathname, keyboard.open);

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
      [...primary, ...pinned].map((item) => ({
        key: item.to,
        label: item.label,
        icon: item.icon,
        active: isItemActive(item, pathname),
        onSelect: () => {
          void navigate({ to: item.to });
        },
      })),
    [primary, pinned, pathname, navigate],
  );

  return (
    <BottomTabBar
      items={items}
      ariaLabel={t('aria.primary')}
      compact={compact}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) expand();
      }}
      onClickCapture={expand}
    />
  );
}
