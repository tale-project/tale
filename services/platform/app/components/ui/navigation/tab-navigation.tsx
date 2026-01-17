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
import { cn } from '@/lib/utils/cn';
import { useResizeObserver } from '@/app/hooks/use-resize-observer';

export interface TabNavigationItem {
  /** Display label for the tab */
  label: string;
  /** URL path for the tab */
  href: string;
  /** Optional roles required to view this tab */
  roles?: string[];
  /** Match mode for this specific item (overrides default) */
  matchMode?: 'exact' | 'startsWith';
}

export interface TabNavigationProps {
  /** Navigation items to display */
  items: TabNavigationItem[];
  /** User role for filtering items (optional) */
  userRole?: string | null;
  /** Default match mode for determining active state */
  matchMode?: 'exact' | 'startsWith';
  /** Custom className for the nav element */
  className?: string;
  /** Accessible label for the navigation */
  ariaLabel?: string;
  /** Whether to prefetch linked pages */
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

const hasRequiredRole = (
  userRole?: string | null,
  requiredRoles?: string[],
): boolean => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  const ur = userRole.toLowerCase();
  const rr = requiredRoles.map((r) => r.toLowerCase());
  return rr.includes(ur);
};

export function TabNavigation({
  items,
  userRole,
  matchMode = 'startsWith',
  className,
  ariaLabel,
  prefetch,
  children,
  standalone = true,
}: TabNavigationProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0 });
  // Track if we should animate (only after initial render)
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const hasInitialized = useRef(false);

  // Filter items by role
  const accessibleItems = useMemo(
    () => items.filter((item) => hasRequiredRole(userRole, item.roles)),
    [items, userRole],
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
    const refs: (HTMLElement | null)[] = [navRef.current, ...itemRefs.current];
    return { current: refs };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Rebuild refs array when item count changes
  }, [accessibleItems.length]);

  // Re-measure on resize
  useResizeObserver(allRefs, updateIndicator, {
    listenToWindow: true,
    deps: [accessibleItems.length],
  });

  return (
    <nav
      ref={navRef}
      className={cn(
        'relative border-b border-border px-4 min-h-11 flex flex-nowrap items-center gap-4 shrink-0',
        standalone && 'bg-background z-10',
        className,
      )}
      aria-label={ariaLabel}
    >
      {accessibleItems.map((item, index) => {
        const isActive = isPathActive(item);

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            to={item.href}
            preload={prefetch ? 'intent' : false}
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
