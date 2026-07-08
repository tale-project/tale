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
  /**
   * Extra routes (besides `href`) that should keep this tab highlighted — for
   * a sibling sub-view that doesn't share the tab's href prefix (e.g. the Tasks
   * tab staying active on the project's `/metrics` route). Each path matches the
   * current pathname exactly OR as a parent prefix (`<path>/…`).
   */
  additionalActivePaths?: string[];
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
  // The <nav> owns the bottom border, so the active indicator is anchored to it
  // (not to `scrollRef`) — see the indicator's JSX comment for why.
  const navRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0 });
  // Track if we should animate (only after initial render)
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const hasInitialized = useRef(false);
  // Whether the tab strip actually overflows its container. The trailing
  // action group's left shadow is a "tabs scroll under here" affordance, so it
  // must only show when there is something to scroll — otherwise it reads as a
  // stray shadow floating beside the buttons on a wide viewport.
  const [isScrollable, setIsScrollable] = useState(false);

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
      const baseMatch =
        mode === 'exact'
          ? pathname === hrefPath
          : pathname.startsWith(hrefPath);
      if (baseMatch) return true;
      // A tab can also claim related sibling routes (e.g. Tasks → /metrics).
      return (item.additionalActivePaths ?? []).some((raw) => {
        const path = raw.split('?')[0];
        return pathname === path || pathname.startsWith(`${path}/`);
      });
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
    const navElement = navRef.current;
    const activeElement =
      activeIndex !== -1 ? itemRefs.current[activeIndex] : null;
    if (navElement && activeElement) {
      // Measure with bounding rects relative to the <nav>, not `offsetLeft`.
      // The indicator now lives in the <nav> while the active tab lives in the
      // horizontally-scrolling inner container, so they no longer share an
      // offset parent. The tab's on-screen `left` already reflects the
      // scroller's `scrollLeft`; subtracting the nav's `left` maps it into the
      // indicator's containing block. (Assumes the <nav> has no horizontal
      // padding/border — the component keeps `px-*` on the inner scroller.)
      const navRect = navElement.getBoundingClientRect();
      const itemRect = activeElement.getBoundingClientRect();
      const nextWidth = itemRect.width;
      const nextLeft = itemRect.left - navRect.left;
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
  }, [activeIndex]);

  // Measure whether the tab strip overflows (drives the trailing shadow).
  const measureScrollable = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const next = scroller.scrollWidth - scroller.clientWidth > 1;
    setIsScrollable((prev) => (prev === next ? prev : next));
  }, []);

  // Update indicator on active item change
  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  // Re-measure overflow when the item set changes (and on mount).
  useEffect(() => {
    measureScrollable();
  }, [measureScrollable, accessibleItems.length]);

  // Re-measure once web fonts finish loading — belt-and-braces. The indicator
  // width/left come from `offsetWidth`/`offsetLeft`, measured against whatever
  // glyphs are painted. Inter is now preloaded at app boot (see
  // packages/ui/src/fonts.ts), so on a cold load it is normally cached before
  // the first paint and no fallback→Inter swap occurs. This guard still covers
  // the slow-network case where Inter lands after the first measure: without it
  // the underline would stay sized for the fallback text. `updateIndicator`
  // no-ops when the values are unchanged, so the extra call is cheap.
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) {
      return undefined;
    }
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) updateIndicator();
    });
    const onLoadingDone = () => updateIndicator();
    document.fonts.addEventListener('loadingdone', onLoadingDone);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener('loadingdone', onLoadingDone);
    };
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

  // Keep the indicator pinned to the active tab while the strip scrolls
  // horizontally. The indicator sits in the <nav> (so it can rest on the bottom
  // border, which the overflow-clipped scroller can't reach), so unlike the old
  // in-scroller indicator it does NOT move with the tabs for free — we
  // re-measure on scroll. The slide transition is suppressed during the scroll
  // so the underline tracks the tab 1:1 instead of lagging 200ms behind it, and
  // restored once scrolling settles so tab switches still animate.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      const indicator = indicatorRef.current;
      if (indicator) indicator.style.transition = 'none';
      updateIndicator();
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        const settled = indicatorRef.current;
        if (settled) settled.style.transition = '';
      }, 150);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, [updateIndicator]);

  // Combine refs for resize observation. The scroll container's width drives
  // both the indicator measurement and the active-tab scroll-into-view.
  const allRefs = useMemo(() => {
    const refs: (HTMLElement | null)[] = [
      scrollRef.current,
      ...itemRefs.current.slice(0, accessibleItems.length),
    ];
    return { current: refs };
  }, [accessibleItems]);

  // Re-measure on resize. Horizontal window/container drags fire the observer
  // many times per second; the indicator's 200ms slide transition chases each
  // measurement and shows up as a visible flicker (the underline lagging /
  // jittering behind the active tab as it moves with the layout). Vertical
  // resize doesn't reach this codepath because none of the measured rects
  // change. Pattern mirrors the scroll handler below: suppress the transition
  // for the duration of the resize burst, then restore after a short idle so
  // genuine tab switches still animate.
  const resizeRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const updateIndicatorForResize = useCallback(() => {
    const indicator = indicatorRef.current;
    if (indicator) indicator.style.transition = 'none';
    updateIndicator();
    measureScrollable();
    if (resizeRestoreTimerRef.current) {
      clearTimeout(resizeRestoreTimerRef.current);
    }
    resizeRestoreTimerRef.current = setTimeout(() => {
      const settled = indicatorRef.current;
      if (settled) settled.style.transition = '';
      resizeRestoreTimerRef.current = null;
    }, 150);
  }, [updateIndicator]);
  useEffect(
    () => () => {
      if (resizeRestoreTimerRef.current) {
        clearTimeout(resizeRestoreTimerRef.current);
      }
    },
    [],
  );

  useResizeObserver(allRefs, updateIndicatorForResize, {
    listenToWindow: true,
    deps: [accessibleItems.length],
  });

  return (
    <nav
      ref={navRef}
      className={cn(
        // A single fixed height for EVERY tab strip — list and detail alike.
        // `min-h-13` (52px) clamps both a bare tab row and one carrying the
        // taller `h-8` editor actions (Save/Discard/History) to the same height,
        // which plain `py-3` can't do (the taller content would win). It also
        // matches the breadcrumb header (`h-13`). `page-action-header` mirrors
        // this so moving between tabbed and non-tabbed pages doesn't bounce.
        'relative border-b border-border min-h-13 flex items-stretch shrink-0',
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
                'relative flex h-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm py-1 text-sm font-medium transition-colors outline-none focus-visible:outline-none',
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
      </div>

      {/* Animated active indicator. Rendered as a child of the <nav> rather than
          the scroll container so it can sit flush on the nav's bottom border:
          the scroll container is `overflow-x: auto` (which forces `overflow-y`
          to clip too), so a child anchored to `bottom-0` there floats above the
          border by the nav's bottom padding. Its position is measured in JS
          relative to the nav and re-synced on scroll. */}
      {activeIndex !== -1 && (
        <div
          ref={indicatorRef}
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-0 h-0.5',
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

      {/* Trailing action group — pinned to the right, outside the scroll area,
          so it stays in view while the tabs scroll under it. The left shadow +
          background fade make the scrolling tabs visibly slide beneath it —
          shown ONLY when the strip actually overflows, else it reads as a stray
          shadow floating beside the buttons on a wide viewport. */}
      {children && (
        <div
          className={cn(
            'bg-background relative z-[1] flex shrink-0 items-center gap-2 self-stretch pr-4 pl-3',
            isScrollable &&
              'shadow-[-12px_0_12px_-12px_rgba(0,0,0,0.18)] dark:shadow-[-12px_0_12px_-12px_rgba(0,0,0,0.6)]',
          )}
        >
          {children}
        </div>
      )}
    </nav>
  );
}
