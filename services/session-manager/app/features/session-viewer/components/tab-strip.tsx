import { cn } from '@tale/ui/cn';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { IconButton } from '@tale/ui/icon-button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tooltip } from '@tale/ui/tooltip';
import { useResizeObserver } from '@tale/ui/use-resize-observer';
import { ChevronDown, LoaderCircle, Plus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { SPIN_CLASS } from '@/app/lib/pending-icon';
import { useT } from '@/lib/i18n/client';
import type { TabInfo } from '@/lib/live-view';

import { tabTarget } from '../lib/tab-keys';
import { tabLabel } from '../lib/tab-label';
import { TOUCH_REACH, TOUCH_TARGET } from '../lib/touch';
import { wheelPixels } from '../lib/wheel';

/** How a tab was chosen: a click moves the keyboard to the page, the arrow keys keep it on the tabs. */
export type ActivateSource = 'pointer' | 'keyboard';

interface TabStripProps {
  tabs: readonly TabInfo[];
  /** The connection is not live: tabs cannot be chosen, opened or closed. */
  disabled: boolean;
  /** The first connection is being made: nothing is known of the tabs yet. */
  loading?: boolean;
  onActivate: (id: number, source: ActivateSource) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  className?: string;
}

/**
 * The columns of the tabs, and of the close buttons that lie over them: the
 * same ones, so that each button stays over its tab. A tab takes 11rem and
 * shrinks with the room down to 6rem; past that the strip scrolls and the menu
 * of tabs has the rest.
 */
const TRACKS = 'grid auto-cols-[minmax(6rem,11rem)] grid-flow-col gap-1';

/**
 * The fade that says that more tabs lie beyond an edge: 1rem wide (`w-4`). The
 * strip keeps a tab that it brings into view this far from the edge, out of
 * it (`scroll-px-4` does the same for a tab that the keyboard reaches).
 */
const FADE =
  'pointer-events-none absolute inset-y-1 z-10 w-4 from-muted to-transparent';
const FADE_WIDTH = 16;

/**
 * The tabs of the session's browser, drawn here: they are not part of the
 * picture. One tab is active (the one in the picture); the arrow keys move
 * between them, Home and End go to the first and the last, Delete closes one.
 * A tab also closes with its button or a click of the middle button. Tabs that
 * do not fit scroll sideways, also with a wheel that only turns up and down,
 * and all of them are in a menu next to the strip.
 *
 * A tab list holds tabs and nothing else, so the close buttons are not in it:
 * they lie over the tabs in a row of their own. The one of the active tab is
 * a stop of the tab key; the others are reached by the pointer, or by Delete
 * on the tab.
 */
export function TabStrip({
  tabs,
  disabled,
  loading = false,
  onActivate,
  onClose,
  onNew,
  className,
}: TabStripProps) {
  const { t } = useT('viewer');
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const newTabRef = useRef<HTMLButtonElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const activeId = tabs.find((tab) => tab.active)?.id;
  // More tabs than room: the menu is there. Which way the strip can still scroll: the fades.
  const [overflowing, setOverflowing] = useState(false);
  const [more, setMore] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const room = scroller.scrollWidth - scroller.clientWidth;
    setOverflowing(room > 1);
    const before = scroller.scrollLeft > 1;
    const after = scroller.scrollLeft < room - 1;
    setMore((now) =>
      now.before === before && now.after === after ? now : { before, after },
    );
  }, []);

  // The tabs are what the strip is wide enough for, or not: measured after
  // each render (they change it), when the strip is resized, and when it scrolls.
  useLayoutEffect(measure);
  useResizeObserver(scrollerRef, measure);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return undefined;
    scroller.addEventListener('scroll', measure, { passive: true });
    return () => scroller.removeEventListener('scroll', measure);
  }, [measure]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      // A wheel that turns by lines (Firefox) or by pages says so: a page is
      // the width of the strip.
      scroller.scrollLeft += wheelPixels(event, scroller.clientWidth).dy;
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  // A tab that became active (a new one, or one the page chose) comes into
  // view, clear of the fade at the edge, before the screen is painted. The
  // strip is scrolled by hand: `scrollIntoView` also makes the tab the place
  // the tab key goes on from, so that the first Tab of a page skipped all that
  // comes before the strip. It is done again when the strip begins to
  // overflow: the button of the menu of tabs comes then and takes room from
  // it, and a tab brought into view for the room before would be half under
  // the edge.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const tab =
      activeId === undefined ? undefined : buttons.current.get(activeId);
    // A strip that holds all its tabs has nothing to scroll.
    if (!overflowing || scroller === null || tab === undefined) return;
    const strip = scroller.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    const beyondLeft = strip.left + FADE_WIDTH - box.left;
    const beyondRight = box.right - (strip.right - FADE_WIDTH);
    if (beyondLeft > 0) scroller.scrollLeft -= beyondLeft;
    else if (beyondRight > 0) scroller.scrollLeft += beyondRight;
  }, [activeId, overflowing]);

  /**
   * Closes a tab. A keyboard that is in the strip stays in it: the focus goes
   * to the neighbour of the tab that goes (else to the button for a new one),
   * not to the page behind it, which is where a removed button drops it.
   */
  const closeTab = (index: number) => {
    const neighbour = tabs[index + 1] ?? tabs[index - 1];
    if (rootRef.current?.contains(document.activeElement)) {
      const next =
        neighbour === undefined
          ? newTabRef.current
          : buttons.current.get(neighbour.id);
      next?.focus();
    }
    onClose(tabs[index].id);
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (disabled) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      closeTab(index);
      return;
    }
    const target = tabTarget(event.key, index, tabs.length);
    const next = target === null ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onActivate(next.id, 'keyboard');
    buttons.current.get(next.id)?.focus();
  };

  // The middle button closes a tab, as in a browser.
  const onAuxClick = (event: MouseEvent, id: number) => {
    if (event.button === 1 && !disabled) onClose(id);
  };

  const untitled = t('tabs.untitled');

  return (
    <div
      ref={rootRef}
      className={cn('flex min-w-0 items-center gap-1', className)}
    >
      <div
        className={cn(
          'relative flex min-w-0',
          // No tabs and none to come: an empty strip would be a speck.
          tabs.length === 0 && !loading && 'hidden',
        )}
      >
        {/* A flex container scrolls with its padding at the end too (a block
            would cut the last tab off at the edge). Its one child shrinks from
            the width the tabs want (11rem each) to the least they take (6rem),
            and the columns of both rows with it. */}
        <div
          ref={scrollerRef}
          className="scrollbar-hide bg-muted flex min-w-0 scroll-px-4 overflow-x-auto rounded-lg p-1"
        >
          <div className="relative">
            {tabs.length === 0 &&
              loading && (
                // Where the first tab will be. The stage says that it connects; this only keeps the place.
                <div aria-hidden="true">
                  <Skeletonize loading>
                    <SkeletonBox>
                      <span className="block h-8 w-44" />
                    </SkeletonBox>
                  </Skeletonize>
                </div>
              )}
            <div role="tablist" aria-label={t('tabs.label')} className={TRACKS}>
              {tabs.map((tab, index) => (
                <Tooltip
                  key={tab.id}
                  content={
                    tab.title || tab.url ? (
                      <span className="block break-all">
                        {tab.title && (
                          <span className="block font-medium">{tab.title}</span>
                        )}
                        {tab.url && <span className="block">{tab.url}</span>}
                      </span>
                    ) : null
                  }
                >
                  <button
                    ref={(node) => {
                      if (node === null) buttons.current.delete(tab.id);
                      else buttons.current.set(tab.id, node);
                    }}
                    type="button"
                    role="tab"
                    aria-selected={tab.active}
                    aria-busy={tab.loading || undefined}
                    aria-disabled={disabled || undefined}
                    aria-keyshortcuts="Delete"
                    tabIndex={
                      tab.active || (activeId === undefined && index === 0)
                        ? 0
                        : -1
                    }
                    onClick={() => {
                      if (!disabled) onActivate(tab.id, 'pointer');
                    }}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    onAuxClick={(event) => onAuxClick(event, tab.id)}
                    className={cn(
                      // The ring is inset: the list scrolls, and a ring drawn outside the tab is cut off by it (as in `Tabs`, `packages/ui/src/components/navigation/tabs.tsx`).
                      'focus-visible:ring-ring relative flex h-8 min-w-0 items-center gap-2 rounded-t-md rounded-b-xs border-b-2 pr-8 pl-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset',
                      'transition-colors duration-[var(--duration-short)] motion-reduce:transition-none',
                      'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
                      TOUCH_TARGET,
                      TOUCH_REACH,
                      // The mark of the active tab is a border, and in forced colours it takes the system's selection colour: a fill is dropped there.
                      tab.active
                        ? 'bg-tab text-foreground border-foreground font-medium shadow-sm forced-colors:[border-bottom-color:Highlight]'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground border-transparent forced-colors:[border-bottom-color:Canvas]',
                    )}
                  >
                    {tab.loading && (
                      <LoaderCircle
                        className={cn('size-3.5 shrink-0', SPIN_CLASS)}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 truncate">
                      {tabLabel(tab, untitled)}
                    </span>
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className={cn('pointer-events-none absolute inset-0', TRACKS)}>
              {tabs.map((tab, index) => (
                <div
                  key={tab.id}
                  className="flex items-center justify-end pr-1"
                >
                  <IconButton
                    icon={X}
                    size="sm"
                    aria-label={
                      tabs.length === 1
                        ? t('tabs.closeLast', {
                            title: tabLabel(tab, untitled),
                          })
                        : t('tabs.close', { title: tabLabel(tab, untitled) })
                    }
                    tabIndex={tab.active ? 0 : -1}
                    disabled={disabled}
                    onClick={() => closeTab(index)}
                    className={cn(
                      'pointer-events-auto size-6',
                      TOUCH_TARGET,
                      TOUCH_REACH,
                      disabled && 'invisible',
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        {more.before && (
          <div
            aria-hidden="true"
            className={cn(FADE, 'left-1 rounded-l-md bg-gradient-to-r')}
          />
        )}
        {more.after && (
          <div
            aria-hidden="true"
            className={cn(FADE, 'right-1 rounded-r-md bg-gradient-to-l')}
          />
        )}
      </div>
      {overflowing && (
        <DropdownMenu
          align="end"
          disabled={disabled}
          // A menu, not a page: a long title is cut short, as it is in the strip, and does not widen the list to the width of the screen.
          contentClassName="max-w-[min(18rem,var(--radix-dropdown-menu-content-available-width))]"
          trigger={
            <IconButton
              icon={ChevronDown}
              size="sm"
              aria-label={t('tabs.more')}
              disabled={disabled}
              className={cn('shrink-0', TOUCH_REACH)}
            />
          }
          items={[
            tabs.map((tab) => ({
              type: 'item' as const,
              label: (
                <span className="min-w-0 flex-1 truncate">
                  {tabLabel(tab, untitled)}
                </span>
              ),
              selected: tab.active,
              // The menu gives the keyboard back to its own button when it closes.
              onClick: () => onActivate(tab.id, 'keyboard'),
            })),
          ]}
        />
      )}
      <IconButton
        ref={newTabRef}
        icon={Plus}
        size="sm"
        aria-label={t('tabs.new')}
        disabled={disabled}
        onClick={onNew}
        className={cn('shrink-0', TOUCH_REACH)}
      />
    </div>
  );
}
