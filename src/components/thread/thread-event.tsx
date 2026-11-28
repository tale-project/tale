'use client';

/**
 * What happened between the messages of a thread — a status move, an
 * assignment, an agent's run — as one quiet line in the avatar gutter: a
 * small glyph where an avatar would sit, then the sentence in `text-xs`,
 * then the time.
 *
 * Bursts stay short: `ThreadEventGroup` folds a run of consecutive events
 * into one summary line ("4 updates") that opens in place, with a thin rule
 * in the gutter tying the opened lines together.
 *
 * Wording, values and what a line opens are the host's. Write each sentence
 * whole in the reader's language — never assemble it from lower-cased
 * fragments, which breaks German nouns — and mark the actor with
 * `ThreadEventActor`.
 */

import { ChevronRight, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useId,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

import { cn } from '../../lib/cn';

type ThreadEventElement = 'div' | 'li';

/** A polymorphic root takes a callback ref: a ref object typed for one
 * element would not fit the other. */
function useRootRef(ref: Ref<HTMLElement> | undefined) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
}

/** The gutter cell: as wide as a message's avatar, so events and messages
 * share one left edge. */
function Gutter({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center">
      <span
        data-slot="thread-event-glyph"
        className="relative flex items-center justify-center rounded-full p-0.5"
      >
        {children}
      </span>
    </span>
  );
}

/** The actor of an event sentence: the one name in full foreground. */
export function ThreadEventActor({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('text-foreground font-medium', className)}>
      {children}
    </span>
  );
}

export interface ThreadEventProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> {
  /** The root element; `li` inside a thread list or a group. @default 'div' */
  as?: ThreadEventElement;
  /** A Lucide glyph for the gutter, drawn muted at 14px. */
  icon?: LucideIcon;
  /** Colour the glyph where the glyph is the fact (a status). */
  iconClassName?: string;
  /** A custom gutter mark instead of `icon`, such as a status glyph. */
  glyph?: ReactNode;
  /** The sentence. */
  children: ReactNode;
  /** When it happened — usually `<ThreadTime />`. */
  time?: ReactNode;
  /** Something at the end of the line, such as a status badge. */
  trailing?: ReactNode;
  /**
   * Given with `detail`, the sentence becomes a button that opens the detail
   * under it.
   */
  expanded?: boolean;
  onToggle?: () => void;
  /** What the line opens: a quoted value, a run's outcome. */
  detail?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function ThreadEvent({
  as: Tag = 'div',
  icon: Icon,
  iconClassName,
  glyph,
  children,
  time,
  trailing,
  expanded = false,
  onToggle,
  detail,
  className,
  ref,
  ...props
}: ThreadEventProps) {
  const setRoot = useRootRef(ref);
  const detailId = useId();
  const mark =
    glyph ??
    (Icon !== undefined && (
      <Icon
        aria-hidden
        className={cn('text-muted-foreground size-3.5', iconClassName)}
      />
    ));
  const sentence = (
    <>
      {children}
      {time !== undefined && (
        <>
          <span aria-hidden className="mx-1.5">
            ·
          </span>
          <span className="whitespace-nowrap">{time}</span>
        </>
      )}
    </>
  );
  const toggles = onToggle !== undefined && detail !== undefined;

  return (
    <Tag
      ref={setRoot}
      {...props}
      className={cn('flex min-w-0 flex-col', className)}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Gutter>{mark}</Gutter>
        {toggles ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            {...(expanded ? { 'aria-controls': detailId } : {})}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left text-xs leading-6 transition-colors focus-visible:ring-1 focus-visible:outline-none motion-reduce:transition-none"
          >
            {sentence}
            <ChevronRight
              aria-hidden
              className={cn(
                'ml-1 inline size-3 align-[-1px] transition-transform motion-reduce:transition-none',
                expanded && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-6">
            {sentence}
          </p>
        )}
        {trailing !== undefined && (
          <span className="flex min-h-6 shrink-0 items-center">{trailing}</span>
        )}
      </div>
      {toggles && expanded && (
        <div id={detailId} className="text-muted-foreground pl-8 text-xs">
          {detail}
        </div>
      )}
    </Tag>
  );
}

export interface ThreadEventGroupProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> {
  /** The root element; `li` inside a thread list. @default 'div' */
  as?: ThreadEventElement;
  /** The folded line, such as "4 updates · Anna, My Opus Agent #3". */
  summary: ReactNode;
  /** When — usually the span of the folded events. */
  time?: ReactNode;
  /** The gutter glyph of the folded line. */
  icon?: LucideIcon;
  /** The folded events: `<ThreadEvent as="li">` each. */
  children: ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  ref?: Ref<HTMLElement>;
}

export function ThreadEventGroup({
  as: Tag = 'div',
  summary,
  time,
  icon: Icon,
  children,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  className,
  ref,
  ...props
}: ThreadEventGroupProps) {
  const setRoot = useRootRef(ref);
  const listId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
  const expanded = expandedProp ?? uncontrolled;
  const toggle = () => {
    const next = !expanded;
    if (expandedProp === undefined) setUncontrolled(next);
    onExpandedChange?.(next);
  };

  return (
    <Tag
      ref={setRoot}
      {...props}
      data-state={expanded ? 'open' : 'closed'}
      className={cn('flex min-w-0 flex-col', className)}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        {...(expanded ? { 'aria-controls': listId } : {})}
        className="group/thread-event-group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-w-0 items-start gap-2 rounded-sm text-left text-xs leading-6 transition-colors focus-visible:ring-1 focus-visible:outline-none motion-reduce:transition-none"
      >
        <Gutter>
          {Icon !== undefined && <Icon aria-hidden className="size-3.5" />}
        </Gutter>
        <span className="min-w-0 flex-1">
          {summary}
          {time !== undefined && (
            <>
              <span aria-hidden className="mx-1.5">
                ·
              </span>
              <span className="whitespace-nowrap">{time}</span>
            </>
          )}
          <ChevronRight
            aria-hidden
            className={cn(
              'ml-1 inline size-3 align-[-1px] transition-transform motion-reduce:transition-none',
              expanded && 'rotate-90',
            )}
          />
        </span>
      </button>
      {expanded && (
        <ul
          id={listId}
          className={cn(
            'relative mt-1 flex flex-col gap-1',
            // The rule runs down the gutter behind the glyphs, which cut it
            // with the thread's background.
            'before:bg-border before:pointer-events-none before:absolute before:inset-y-0 before:left-[11.5px] before:w-px',
            '[&_[data-slot=thread-event-glyph]]:bg-background',
          )}
        >
          {children}
        </ul>
      )}
    </Tag>
  );
}
