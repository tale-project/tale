'use client';

import { Link, useLocation } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useResizeObserver } from '@/app/hooks/use-resize-observer';
import { type AppAction, type AppSubject } from '@/lib/permissions/ability';
import { cn } from '@/lib/utils/cn';

export interface TabNavigationItem {
  /** Display label for the tab */
  label: string;
  /** URL path for the tab */
  href: string;
  /** CASL ability check required to show this tab. When absent, always visible. */
  can?: [AppAction, AppSubject];
  /** Match mode for this specific item (overrides default) */
  matchMode?: 'exact' | 'startsWith';
  /** Search params to include in the link */
  search?: Record<string, unknown>;
}

export interface TabNavigationProps {
  /** Navigation items to display */
  items: TabNavigationItem[];
  /** Default match mode for determining active state */
  matchMode?: 'exact' | 'startsWith';
  /** Custom className for the nav element */
  className?: string;
  /** Accessible label for the navigation */
  ariaLabel?: string;
  /** Whether to prefetch linked pages (defaults to true) */
  prefetch?: boolean;
  /** Additional content to render (e.g., buttons, dropdowns) */
  children?: ReactNode;
  /**
   * When true (default), applies sticky positioning and z-index.
   * When false, renders without sticky for use inside StickyHeader wrapper.
   * @default true
   */
  standalone?: boolean;
}

export function TabNavigation({
  items,
  matchMode = 'startsWith',
  className,
  ariaLabel,
  prefetch = true,
  children,
  standalone = true,
}: TabNavigationProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const ability = useAbility();
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0 });
  // Track if we should animate (only after initial render)
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const hasInitialized = useRef(false);

  // Filter items by ability
  const accessibleItems = useMemo(
    () =>
      items.filter(
        (item) => !item.can || ability.can(item.can[0], item.can[1]),
      ),
    [items, ability],
  );

  // Determine if a path matches an item
  const isPathActive = useCallback(
    (item: TabNavigationItem): boolean => {
      const mode = item.matchMode ?? matchMode;
      // Strip query parameters from href for comparison since pathname doesn't include them
      const hrefPath = item.href.split('?')[0];
      return mode === 'exact'
        ? pathname === hrefPath
        : pathname.startsWith(hrefPath);
    },
    [pathname, matchMode],
  );

  // Find active item index
  const activeIndex = useMemo(
    () => accessibleItems.findIndex(isPathActive),
    [accessibleItems, isPathActive],
  );

  // Update indicator position
  const updateIndicator = useCallback(() => {
    if (activeIndex !== -1 && itemRefs.current[activeIndex]) {
      const activeElement = itemRefs.current[activeIndex];
      if (activeElement) {
        setIndicatorStyle({
          width: activeElement.offsetWidth,
          left: activeElement.offsetLeft,
        });

        // Enable animations after first position is set
        if (!hasInitialized.current) {
          hasInitialized.current = true;
          requestAnimationFrame(() => {
            setShouldAnimate(true);
          });
        }
      }
    }
  }, [activeIndex]);

  // Update indicator on active item change
  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  // Combine refs for resize observation
  const allRefs = useMemo(() => {
    const refs: (HTMLElement | null)[] = [
      navRef.current,
      ...itemRefs.current.slice(0, accessibleItems.length),
    ];
    return { current: refs };
  }, [accessibleItems]);

  // Re-measure on resize
  useResizeObserver(allRefs, updateIndicator, {
    listenToWindow: true,
    deps: [accessibleItems.length],
  });

  return (
    <nav
      ref={navRef}
      className={cn(
        'scrollbar-hide relative border-b border-border px-4 min-h-12 flex flex-nowrap items-center gap-4 shrink-0 overflow-x-auto',
        standalone && 'bg-background z-10',
        className,
      )}
      aria-label={ariaLabel}
    >
      {accessibleItems.map((item, index) => {
        const isActive = isPathActive(item);
        const [path, queryString] = item.href.split('?');
        const hrefSearch = queryString
          ? Object.fromEntries(new URLSearchParams(queryString))
          : undefined;

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            to={path}
            search={item.search ?? hrefSearch}
            preload={prefetch ? 'render' : false}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative h-full flex items-center py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}

      {/* Animated indicator */}
      {activeIndex !== -1 && (
        <div
          className={cn(
            'absolute bottom-0 h-0.5 bg-foreground',
            shouldAnimate && 'transition-all duration-200 ease-out',
          )}
          style={{
            width: `${indicatorStyle.width}px`,
            left: `${indicatorStyle.left}px`,
          }}
        />
      )}

      {children}
    </nav>
  );
}
