'use client';

import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { MobileFloatingActions } from '@/app/components/layout/mobile-floating-actions';
import { useAbility } from '@/app/hooks/use-ability';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { useResizeObserver } from '@/app/hooks/use-resize-observer';
import { useT } from '@/lib/i18n/client';
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
  /**
   * Explicit activeness override — for tab strips whose tabs share one
   * pathname and switch on a search param (the automation detail's `?tab=`),
   * where path matching alone would light up every tab. When set, it wins
   * outright over path matching.
   */
  isActive?: boolean;
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
  /**
   * How the strip handles more tabs than fit the row. `scroll` (default)
   * keeps the horizontal scroller. `menu` clamps the row to the tabs that
   * fit and folds the tail into a trailing "More" dropdown — for strips
   * whose item count is unbounded (e.g. the project tabs, which grow with
   * every bound automation view).
   */
  overflow?: 'scroll' | 'menu';
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
  overflow = 'scroll',
}: TabNavigationProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const ability = useAbility();
  const { accentColor } = useBrandingContext();
  const { t: tCommon } = useT('common');
  // On `< md`, trailing actions move to a floating dock so they no longer
  // pin over the scrolling tabs. Desktop keeps the trailing slot. Single
  // mount either way — never render Save twice.
  const isMobile = useIsMobile();
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

  // --- `overflow="menu"` clamping ------------------------------------------
  // The row renders only the first `visibleCount` tabs; the tail folds into a
  // "More" dropdown. Widths come from a hidden measurement row that always
  // carries EVERY tab (clamped tabs unmount from the real row, so their live
  // widths would be lost the moment they overflow) — measured against the
  // scroller's content box. `null` = not measured yet / everything fits.
  const isMenuOverflow = overflow === 'menu';
  const measureRowRef = useRef<HTMLDivElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  const updateOverflowClamp = useCallback(() => {
    if (!isMenuOverflow) return;
    const scroller = scrollRef.current;
    const row = measureRowRef.current;
    if (!scroller || !row) return;
    const scrollerStyle = getComputedStyle(scroller);
    const available =
      scroller.clientWidth -
      (Number.parseFloat(scrollerStyle.paddingLeft) || 0) -
      (Number.parseFloat(scrollerStyle.paddingRight) || 0);
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const measured = Array.from(row.children, (child) =>
      child instanceof HTMLElement ? child.offsetWidth : 0,
    );
    // Last measurement child is the "More" trigger's width twin.
    const moreWidth = measured.pop() ?? 0;
    const total = measured.reduce(
      (sum, width, index) => sum + width + (index > 0 ? gap : 0),
      0,
    );
    let next: number | null = null;
    if (total > available) {
      // Widest prefix that still leaves room for the trailing More trigger.
      let used = moreWidth;
      let fit = 0;
      for (const width of measured) {
        const candidate = used + gap + width;
        if (candidate > available) break;
        used = candidate;
        fit += 1;
      }
      next = fit;
    }
    setVisibleCount((prev) => (prev === next ? prev : next));
  }, [isMenuOverflow]);

  // Clamp before paint so an overflowing strip never flashes unclamped.
  useLayoutEffect(() => {
    updateOverflowClamp();
  }, [updateOverflowClamp, accessibleItems]);

  const visibleItems = useMemo(
    () =>
      isMenuOverflow && visibleCount !== null
        ? accessibleItems.slice(0, visibleCount)
        : accessibleItems,
    [isMenuOverflow, visibleCount, accessibleItems],
  );
  const overflowItems = useMemo(
    () =>
      isMenuOverflow && visibleCount !== null
        ? accessibleItems.slice(visibleCount)
        : [],
    [isMenuOverflow, visibleCount, accessibleItems],
  );

  // Determine if a path matches an item
  const isPathActive = useCallback(
    (item: TabNavigationItem): boolean => {
      if (item.isActive !== undefined) return item.isActive;
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
  // The active tab sits in the clamped-away tail — the More trigger stands in
  // for it (active text colour + the underline indicator).
  const activeInOverflow =
    activeIndex !== -1 && activeIndex >= visibleItems.length;

  // Update indicator position. Skip the setState when the measured values
  // are unchanged — otherwise a `ResizeObserver` re-attach (which fires the
  // callback synchronously on observe()) would queue a redundant re-render
  // each cycle, and a parent that produces a fresh `items` array per render
  // would feed that cycle into a max-update-depth loop.
  const updateIndicator = useCallback(() => {
    const navElement = navRef.current;
    const activeElement = activeInOverflow
      ? moreTriggerRef.current
      : activeIndex !== -1
        ? itemRefs.current[activeIndex]
        : null;
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
  }, [activeIndex, activeInOverflow]);

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
  // directly so we never scroll an outer container. (`menu` strips never
  // overflow the scroller — the clamp guarantees the row fits.)
  useEffect(() => {
    if (isMenuOverflow) return;
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
  }, [activeIndex, isMenuOverflow]);

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
      ...itemRefs.current.slice(0, visibleItems.length),
    ];
    return { current: refs };
  }, [visibleItems]);

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
    updateOverflowClamp();
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
  }, [updateIndicator, measureScrollable, updateOverflowClamp]);
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
    deps: [visibleItems.length],
  });

  // The overflowed tail as dropdown rows. Navigation goes through the router
  // imperatively — the shared DropdownMenu is router-agnostic (its `href`
  // items render plain anchors, which would full-page reload).
  const overflowMenuItems: DropdownMenuGroup[] = useMemo(
    () => [
      overflowItems.map((item) => {
        const [path, queryString] = item.href.split('?');
        const hrefSearch = queryString
          ? Object.fromEntries(new URLSearchParams(queryString))
          : undefined;
        return {
          type: 'item' as const,
          label: item.label,
          selected: isPathActive(item),
          onClick: () => {
            void navigate({ to: path, search: item.search ?? hrefSearch });
          },
        };
      }),
    ],
    [overflowItems, isPathActive, navigate],
  );
  // A dirty tab hidden in the tail still deserves its unsaved-changes dot —
  // surfaced on the More trigger, since the tab itself isn't in the row.
  const overflowHasDirty =
    dirtyKeys !== undefined &&
    overflowItems.some(
      (item) => item.dirtyKeys?.some((k) => dirtyKeys.has(k)) ?? false,
    );

  return (
    <>
      <nav
        ref={navRef}
        className={cn(
          // A single fixed height for EVERY tab strip — list and detail alike.
          // `min-h-13` (52px) clamps both a bare tab row and one carrying the
          // taller `h-8` editor actions (Save/Discard/History) to the same height,
          // which plain `py-3` can't do (the taller content would win). It also
          // matches the breadcrumb header (`h-13`). `page-action-header` mirrors
          // this so moving between tabbed and non-tabbed pages doesn't bounce.
          //
          // `overflow-x-hidden` contains the absolute `overflow="menu"` measure
          // row. That twin is `invisible` but still contributes to ancestor
          // scrollable overflow; without this, PageLayout (`overflow-auto`)
          // gains a phantom horizontal scrollbar and a trackpad swipe shifts
          // the whole project shell sideways even though page content fits.
          'border-border relative flex min-h-13 shrink-0 items-stretch overflow-x-hidden border-b',
          standalone && 'bg-background z-10',
          className,
        )}
        aria-label={ariaLabel}
      >
        <div
          ref={scrollRef}
          className="scrollbar-hide relative flex min-w-0 flex-1 items-center gap-4 overflow-x-auto px-4"
        >
          {visibleItems.map((item, index) => {
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
                // Search-param tab strips share one pathname across items, so
                // the href alone is not unique — the label disambiguates.
                key={`${item.href}|${item.label}`}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                to={path}
                search={item.search ?? hrefSearch}
                preload={prefetch ? 'render' : false}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex h-full shrink-0 items-center justify-center gap-1.5 rounded-sm py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-none',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {isItemDirty && (
                  <>
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 rounded-full bg-amber-500"
                    />
                    {/* The dot alone is decorative (aria-hidden) — this is its
                      text twin, so screen-reader users still hear that the
                      tab carries unsaved changes. The trailing `{' '}`
                      keeps it a separate word from the label that follows
                      (adjacent JSX text nodes concatenate with no space). */}
                    <span className="sr-only">
                      {tCommon('aria.unsavedChanges')}
                    </span>{' '}
                  </>
                )}
                {item.label}
                {item.trailing}
              </Link>
            );
          })}
          {overflowItems.length > 0 && (
            <DropdownMenu
              align="end"
              items={overflowMenuItems}
              trigger={
                <button
                  ref={moreTriggerRef}
                  type="button"
                  aria-label={tCommon('aria.moreTabs')}
                  className={cn(
                    'relative flex h-full shrink-0 items-center justify-center gap-1 rounded-sm py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-none',
                    activeInOverflow
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {overflowHasDirty && (
                    <>
                      <span
                        aria-hidden="true"
                        className="inline-block size-1.5 rounded-full bg-amber-500"
                      />
                      <span className="sr-only">
                        {tCommon('aria.unsavedChanges')}
                      </span>{' '}
                    </>
                  )}
                  {tCommon('moreTabs')}
                  <ChevronDown aria-hidden="true" className="size-4" />
                </button>
              }
            />
          )}
        </div>

        {/* Width twin of every tab (+ the More trigger, last) for the `menu`
          overflow clamp. Clamped-away tabs unmount from the real row, so this
          hidden copy is the only place their widths stay measurable. Same
          typography/gap classes as the live row so the twin widths hold. */}
        {isMenuOverflow && (
          <div
            ref={measureRowRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-4 whitespace-nowrap"
          >
            {accessibleItems.map((item) => (
              <span
                key={`${item.href}|${item.label}`}
                className="flex items-center gap-1.5 py-1 text-sm font-medium"
              >
                {dirtyKeys !== undefined &&
                  (item.dirtyKeys?.some((k) => dirtyKeys.has(k)) ?? false) && (
                    <span className="inline-block size-1.5 rounded-full" />
                  )}
                {item.label}
                {item.trailing}
              </span>
            ))}
            <span className="flex items-center gap-1 py-1 text-sm font-medium">
              {tCommon('moreTabs')}
              <ChevronDown className="size-4" />
            </span>
          </div>
        )}

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

        {/* Trailing action group — desktop only. Pinned to the right, outside the
          scroll area, so it stays in view while the tabs scroll under it. The
          left shadow + background fade make the scrolling tabs visibly slide
          beneath it — shown ONLY when the strip actually overflows, else it
          reads as a stray shadow floating beside the buttons on a wide
          viewport. On mobile, the same children float above the bottom nav. */}
        {children && !isMobile && (
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
      {children && isMobile && (
        <MobileFloatingActions>{children}</MobileFloatingActions>
      )}
    </>
  );
}
