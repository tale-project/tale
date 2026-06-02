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

import { useBrandingContext } from '@/app/components/branding/branding-provider';
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
  /** Optional trailing element rendered after the label (e.g. status badge) */
  trailing?: ReactNode;
  /**
   * Top-level controller keys whose dirty state should surface as a dot on
   * this tab. Intersect with `TabNavigation.dirtyKeys` from a parent editor
   * controller. Omit to never render the dot.
   */
  dirtyKeys?: readonly string[];
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
  /**
   * Set of top-level controller keys currently dirty. When supplied, any
   * tab whose `dirtyKeys` intersects the set renders a small dot before
   * the label. Drives the per-tab "unsaved changes" indicator.
   */
  dirtyKeys?: ReadonlySet<string>;
}

export function TabNavigation({
  items,
  matchMode = 'startsWith',
  className,
  ariaLabel,
  prefetch = true,
  children,
  standalone = true,
  dirtyKeys,
}: TabNavigationProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const ability = useAbility();
  const { accentColor } = useBrandingContext();
  // The horizontally-scrolling tab list. Kept separate from the outer <nav> so
  // the trailing button group can sit outside the scroll area and stay pinned
  // to the right while only the tabs scroll. All measurement/scroll logic reads
  // this element, so the <nav> itself needs no ref.
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  // Update indicator position. Skip the setState when the measured values
  // are unchanged — otherwise a `ResizeObserver` re-attach (which fires the
  // callback synchronously on observe()) would queue a redundant re-render
  // each cycle, and a parent that produces a fresh `items` array per render
  // would feed that cycle into a max-update-depth loop.
  const updateIndicator = useCallback(() => {
    if (activeIndex !== -1 && itemRefs.current[activeIndex]) {
      const activeElement = itemRefs.current[activeIndex];
      if (activeElement) {
        const nextWidth = activeElement.offsetWidth;
        const nextLeft = activeElement.offsetLeft;
        setIndicatorStyle((prev) =>
          prev.width === nextWidth && prev.left === nextLeft
            ? prev
            : { width: nextWidth, left: nextLeft },
        );

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

  // Scroll the active tab into view when it's offscreen — important on
  // narrow viewports where the tab strip overflows horizontally. Without
  // this, opening a settings sub-page (e.g. /settings/account) on mobile
  // can leave the active tab hidden off the right edge. Adjusts `scrollLeft`
  // directly so we never scroll an outer container.
  useEffect(() => {
    const scroller = scrollRef.current;
    const active = itemRefs.current[activeIndex];
    if (!scroller || !active) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;

    const target =
      active.offsetLeft + active.offsetWidth / 2 - scroller.clientWidth / 2;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const clamped = Math.max(0, Math.min(target, max));
    if (Math.abs(scroller.scrollLeft - clamped) < 1) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    scroller.scrollTo({
      left: clamped,
      behavior:
        prefersReducedMotion || !hasInitialized.current ? 'auto' : 'smooth',
    });
  }, [activeIndex]);

  // Combine refs for resize observation. The scroll container's width drives
  // both the indicator measurement and the active-tab scroll-into-view.
  const allRefs = useMemo(() => {
    const refs: (HTMLElement | null)[] = [
      scrollRef.current,
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
      className={cn(
        'relative border-b border-border min-h-11 flex items-stretch shrink-0',
        standalone && 'bg-background z-10',
        className,
      )}
      aria-label={ariaLabel}
    >
      <div
        ref={scrollRef}
        className="scrollbar-hide relative flex min-w-0 flex-1 items-center gap-4 overflow-x-auto px-4"
      >
        {accessibleItems.map((item, index) => {
          const isActive = isPathActive(item);
          const [path, queryString] = item.href.split('?');
          const hrefSearch = queryString
            ? Object.fromEntries(new URLSearchParams(queryString))
            : undefined;
          const isItemDirty =
            dirtyKeys !== undefined &&
            (item.dirtyKeys?.some((k) => dirtyKeys.has(k)) ?? false);

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
                "relative h-full flex items-center gap-1.5 py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 rounded-sm focus-visible:outline-none focus-visible:after:content-[''] focus-visible:after:absolute focus-visible:after:-inset-x-1 focus-visible:after:inset-y-0.5 focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset focus-visible:after:pointer-events-none justify-center",
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {isItemDirty && (
                <span
                  aria-hidden="true"
                  className="inline-block size-1.5 rounded-full bg-amber-500"
                />
              )}
              {item.label}
              {item.trailing}
            </Link>
          );
        })}

        {/* Animated indicator */}
        {activeIndex !== -1 && (
          <div
            className={cn(
              'absolute bottom-0 h-0.5',
              !accentColor && 'bg-foreground',
              shouldAnimate &&
                'transition-all duration-200 ease-out motion-reduce:transition-none',
            )}
            style={{
              width: `${indicatorStyle.width}px`,
              left: `${indicatorStyle.left}px`,
              backgroundColor: accentColor || undefined,
            }}
          />
        )}
      </div>

      {/* Trailing action group — pinned to the right, outside the scroll area,
          so it stays in view while the tabs scroll under it. The left shadow +
          background fade make the scrolling tabs visibly slide beneath it. */}
      {children && (
        <div className="bg-background relative z-[1] flex shrink-0 items-center gap-2 self-stretch pr-4 pl-3 shadow-[-12px_0_12px_-12px_rgba(0,0,0,0.18)] dark:shadow-[-12px_0_12px_-12px_rgba(0,0,0,0.6)]">
          {children}
        </div>
      )}
    </nav>
  );
}
