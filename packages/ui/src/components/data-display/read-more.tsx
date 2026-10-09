'use client';

/**
 * Long content shown at a readable length, with a toggle to read the rest.
 *
 * An agent's report, a pasted log or a handbook-length description would
 * otherwise push everything after it out of view. `ReadMore` clamps such a
 * block to a height (or to a number of lines) and offers "Read more" /
 * "Show less" under it.
 *
 * The content always stays in the DOM: the clamp is CSS (`overflow: hidden`),
 * so find-in-page, copy and screen readers keep the full text. Height mode
 * clamps only when the content is clearly longer than the limit (`slack`):
 * a toggle that revealed two more lines would cost a click for nothing.
 *
 * The block is measured while it is collapsed, and again whenever it or its
 * content resizes (a narrower column, more text arriving), never while the
 * reader has it open.
 */

import { useT } from '@tale/ui/i18n/client';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/** The default clamp: about thirteen lines of `text-sm leading-6` prose. */
const DEFAULT_MAX_HEIGHT = 320;
/** How much longer than the clamp the content must be before it is cut. */
const DEFAULT_SLACK = 96;

export interface ReadMoreProps {
  children: ReactNode;
  /**
   * Height mode: the collapsed height in pixels. Ignored when `lines` is set.
   * @default 320
   */
  maxHeight?: number;
  /**
   * Lines mode: clamp to this many lines with an ellipsis instead of a
   * height. Suits a plain paragraph; use height mode for markdown blocks.
   */
  lines?: number;
  /**
   * Height mode: the content is clamped only when it is taller than
   * `maxHeight + slack`, so the toggle never hides a line or two.
   * @default 96
   */
  slack?: number;
  /** Height mode: fade the last 64px into the surface. @default true */
  fade?: boolean;
  /**
   * The gradient's starting colour, matching the surface behind the
   * content — `from-muted` inside a muted bubble.
   * @default 'from-background'
   */
  fadeClassName?: string;
  /** Controlled open state. */
  expanded?: boolean;
  /** Initial open state when uncontrolled. @default false */
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Replace the default "Read more" / "Show less" labels. */
  labels?: { more: string; less: string };
  /** Where the toggle sits under the content. @default 'start' */
  align?: 'start' | 'end';
  /** Classes for the outer column (content + toggle). */
  className?: string;
  /** Classes for the clamped region, e.g. a bubble's surface and padding. */
  contentClassName?: string;
  toggleClassName?: string;
  /** The clamped region's id, for `aria-controls`. Generated when absent. */
  id?: string;
}

export function ReadMore({
  children,
  maxHeight = DEFAULT_MAX_HEIGHT,
  lines,
  slack = DEFAULT_SLACK,
  fade = true,
  fadeClassName,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  labels,
  align = 'start',
  className,
  contentClassName,
  toggleClassName,
  id,
}: ReadMoreProps) {
  const { t } = useT('common');
  const generatedId = useId();
  const regionId = id ?? generatedId;
  const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
  const expanded = expandedProp ?? uncontrolled;
  const [measured, setMeasured] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const collapsing = useRef(false);
  const measuredOnce = useRef(false);
  const linesMode = lines !== undefined;

  useLayoutEffect(() => {
    const region = regionRef.current;
    const content = contentRef.current;
    if (region === null || content === null) return undefined;
    // Lines mode can only tell overflow while the clamp is on; height mode
    // reads the content's natural height, so one look settles a block that
    // opens expanded.
    const measure = () => {
      setOverflowing(
        linesMode
          ? region.scrollHeight > region.clientHeight + 1
          : region.scrollHeight > maxHeight + slack,
      );
      measuredOnce.current = true;
      setMeasured(true);
    };
    if (expanded) {
      if (!measuredOnce.current && !linesMode) measure();
      return undefined;
    }
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // The region resizes with its column; the inner box with its content.
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, linesMode, maxHeight, slack]);

  // Collapsing a long block can leave the reader far below it: bring the
  // toggle they just pressed back into view.
  useEffect(() => {
    if (expanded || !collapsing.current) return;
    collapsing.current = false;
    toggleRef.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded]);

  // Until the first measure a long block starts clamped rather than
  // flashing at full length; a short one is unaffected by the limit.
  const clamped = !expanded && (linesMode || !measured || overflowing);
  // Open but never measured (lines mode opened by default): the reader
  // still needs the way back.
  const showToggle = overflowing || (expanded && !measured);

  const clampStyle: CSSProperties | undefined = !clamped
    ? undefined
    : linesMode
      ? {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: lines,
          overflow: 'hidden',
        }
      : { maxHeight, overflow: 'hidden' };

  const toggle = () => {
    const next = !expanded;
    if (!next) collapsing.current = true;
    if (expandedProp === undefined) setUncontrolled(next);
    onExpandedChange?.(next);
  };

  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div
        ref={regionRef}
        id={regionId}
        data-slot="read-more-content"
        {...(clamped && overflowing ? { 'data-clamped': '' } : {})}
        className={cn('relative min-w-0', contentClassName)}
        style={clampStyle}
      >
        <div ref={contentRef}>{children}</div>
        {fade && !linesMode && clamped && overflowing && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent',
              fadeClassName ?? 'from-background',
            )}
          />
        )}
      </div>
      {showToggle && (
        <button
          ref={toggleRef}
          // Often rendered inside a <form>: an implicit submit would save.
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={toggle}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 inline-flex h-6 items-center gap-1 rounded-md text-sm font-medium transition-colors focus-visible:ring-1 focus-visible:outline-none motion-reduce:transition-none',
            align === 'end' ? 'self-end' : 'self-start',
            toggleClassName,
          )}
        >
          {expanded
            ? (labels?.less ?? t('actions.showLess'))
            : (labels?.more ?? t('actions.readMore'))}
          <Chevron aria-hidden className="size-4 shrink-0" />
        </button>
      )}
    </div>
  );
}
