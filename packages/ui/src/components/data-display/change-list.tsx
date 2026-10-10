'use client';

/**
 * `@tale/ui/change-list` — what changed between two versions, in words: a
 * kind's badge, a summary of the counts, a field's before and after, and a
 * list of the changed items grouped in sections, each opening to its
 * details. The same family look as the issue list: one Tab stop, the arrows
 * between rows, Enter or Space to open one.
 */

import {
  ArrowRight,
  ArrowRightLeft,
  ChevronDown,
  Minus,
  PenLine,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import {
  Fragment,
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ForwardRefExoticComponent,
  type KeyboardEvent,
  type ReactNode,
  type RefAttributes,
} from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { Button } from '../primitives/button';

/** What happened to an item between two versions. */
export type ChangeKind = 'added' | 'removed' | 'changed' | 'renamed';

/** One glyph per kind, so a kind reads by shape as well as by colour. */
export const CHANGE_KIND_ICON: Readonly<Record<ChangeKind, LucideIcon>> = {
  added: Plus,
  removed: Minus,
  changed: PenLine,
  renamed: ArrowRightLeft,
};

/** A kind's colour as text and border (`--diff-*`): 4.5:1 on the card, the
 *  page and the muted surface in both themes. A rename is a change. */
export const CHANGE_KIND_TEXT: Readonly<Record<ChangeKind, string>> = {
  added: 'text-diff-added',
  removed: 'text-diff-removed',
  changed: 'text-diff-changed',
  renamed: 'text-diff-changed',
};

/** A kind's word, from the catalog's literal keys. */
function useKindWords(): Record<ChangeKind, string> {
  const { t } = useT('changeList');
  return {
    added: t('kind.added'),
    removed: t('kind.removed'),
    changed: t('kind.changed'),
    renamed: t('kind.renamed'),
  };
}

const BADGE_SIZE = {
  sm: 'h-5 gap-1 px-1.5 [&>svg]:size-3',
  md: 'h-6 gap-1.5 px-2 [&>svg]:size-3.5',
} as const;

/**
 * A change's kind as a small outlined badge: its glyph and its word, never
 * colour alone. `sm` (20 px) fits a row of 20 px, such as a flow box's
 * title row.
 */
export function ChangeKindBadge({
  kind,
  size = 'sm',
  className,
}: {
  kind: ChangeKind;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const words = useKindWords();
  const Icon = CHANGE_KIND_ICON[kind];
  return (
    <span
      data-slot="change-kind-badge"
      data-kind={kind}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-current/40 text-xs leading-4 font-medium whitespace-nowrap',
        BADGE_SIZE[size],
        CHANGE_KIND_TEXT[kind],
        className,
      )}
    >
      <Icon aria-hidden="true" className="shrink-0" />
      {words[kind]}
    </span>
  );
}

export interface ChangeSummaryProps {
  /** How many items of each kind; a kind left out or at 0 is not shown. */
  counts: Partial<Record<ChangeKind, number>>;
  /** Parts that changed without a count, in the host's words ("Inputs",
   *  "Tests"). */
  flags?: readonly string[];
  /** `inline`: one line of words. `chips`: a list of small chips. */
  variant?: 'chips' | 'inline';
  /** Names the summary (a list of chips, or a group of words). */
  'aria-label'?: string;
  className?: string;
}

const KINDS: readonly ChangeKind[] = ['added', 'removed', 'changed', 'renamed'];

/** A count as the catalog reads it: a whole number, never below zero. */
function countOf(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * The counts of a comparison in a line — "+2 added · −1 removed · 3 changed
 * · Inputs · Tests" — or as chips. Each count keeps its kind's glyph and
 * colour; the words say it all without them.
 */
export function ChangeSummary({
  counts,
  flags = [],
  variant = 'inline',
  'aria-label': ariaLabel,
  className,
}: ChangeSummaryProps) {
  const { t } = useT('changeList');
  const words: Record<ChangeKind, (count: number) => string> = {
    added: (count) => t('count.added', { count }),
    removed: (count) => t('count.removed', { count }),
    changed: (count) => t('count.changed', { count }),
    renamed: (count) => t('count.renamed', { count }),
  };
  const shown = KINDS.flatMap((kind) => {
    const count = countOf(counts[kind]);
    return count > 0 ? [{ kind, count }] : [];
  });
  if (shown.length === 0 && flags.length === 0) {
    return (
      <p className={cn('text-muted-foreground text-xs', className)}>
        {t('empty')}
      </p>
    );
  }
  const part = (kind: ChangeKind, count: number) => {
    const Icon = CHANGE_KIND_ICON[kind];
    return (
      <span
        data-kind={kind}
        className={cn(
          'inline-flex items-center gap-0.5 tabular-nums',
          CHANGE_KIND_TEXT[kind],
        )}
      >
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        {words[kind](count)}
      </span>
    );
  };
  if (variant === 'chips') {
    return (
      <ul
        role="list"
        aria-label={ariaLabel}
        data-slot="change-summary"
        className={cn('flex flex-wrap items-center gap-1.5 text-xs', className)}
      >
        {shown.map(({ kind, count }) => (
          <li
            key={kind}
            className="inline-flex h-5 items-center rounded-md border border-current/40 px-1.5 font-medium"
          >
            {part(kind, count)}
          </li>
        ))}
        {flags.map((flag) => (
          <li
            key={flag}
            className="bg-muted text-foreground inline-flex h-5 items-center rounded-md px-1.5 font-medium"
          >
            {flag}
          </li>
        ))}
      </ul>
    );
  }
  const items: ReactNode[] = [
    ...shown.map(({ kind, count }) => (
      <Fragment key={kind}>{part(kind, count)}</Fragment>
    )),
    ...flags.map((flag) => (
      <span key={flag} className="text-foreground">
        {flag}
      </span>
    )),
  ];
  const line = (
    <p
      data-slot="change-summary"
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs',
        ariaLabel === undefined && className,
      )}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
          ) : null}
          {item}
        </Fragment>
      ))}
    </p>
  );
  // A name of its own makes the line a group a screen reader announces.
  return ariaLabel === undefined ? (
    line
  ) : (
    <div role="group" aria-label={ariaLabel} className={className}>
      {line}
    </div>
  );
}

export interface FieldChangeRowProps {
  /** The field's name ("Model", "Prompt"). */
  label: ReactNode;
  kind: Exclude<ChangeKind, 'renamed'>;
  /** The value before; left out for an added field. */
  before?: ReactNode;
  /** The value after; left out for a removed field. */
  after?: ReactNode;
  /**
   * `inline`: label, then "before → after" on one line, for short values.
   * `stacked`: the label over a Before and an After line, for longer ones.
   */
  layout?: 'inline' | 'stacked';
  /**
   * A field compared in full in place of its two values: a small
   * `CodeDiff` for code, a `DataDiff` for JSON. Shown under the label.
   */
  detail?: ReactNode;
  /** A muted line under the change ("Also updated in 2 nodes that read it"). */
  note?: ReactNode;
  className?: string;
}

/** A value as it was (on the removed tint) or as it is (on the added). */
function FieldValue({
  side,
  children,
}: {
  side: 'before' | 'after';
  children: ReactNode;
}) {
  const { t } = useT('changeList');
  const Tag = side === 'before' ? 'del' : 'ins';
  return (
    <Tag
      data-side={side}
      className={cn(
        'text-foreground rounded-xs px-1 break-words no-underline',
        side === 'before' ? 'bg-diff-removed-bg' : 'bg-diff-added-bg',
      )}
    >
      <span className="sr-only">
        {side === 'before' ? t('before') : t('after')}{' '}
      </span>
      {children}
    </Tag>
  );
}

/**
 * One field's change: its name, then what it was and what it is — inline
 * ("Model claude-haiku-4-5 → claude-sonnet-4-5"), stacked, or compared in
 * full (`detail`). The old value sits on the removed tint, the new on the
 * added; a screen reader hears "Before:" and "After:".
 */
export function FieldChangeRow({
  label,
  kind,
  before,
  after,
  layout = 'inline',
  detail,
  note,
  className,
}: FieldChangeRowProps) {
  const { t } = useT('changeList');
  const showBefore = kind !== 'added' && before !== undefined;
  const showAfter = kind !== 'removed' && after !== undefined;
  let body: ReactNode;
  if (detail !== undefined) {
    body = <div className="min-w-0">{detail}</div>;
  } else if (layout === 'stacked') {
    body = (
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {showBefore ? (
          <>
            <dt className="text-muted-foreground">{t('before')}</dt>
            <dd className="min-w-0">
              <FieldValue side="before">{before}</FieldValue>
            </dd>
          </>
        ) : null}
        {showAfter ? (
          <>
            <dt className="text-muted-foreground">{t('after')}</dt>
            <dd className="min-w-0">
              <FieldValue side="after">{after}</FieldValue>
            </dd>
          </>
        ) : null}
      </dl>
    );
  } else {
    body = (
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {showBefore ? <FieldValue side="before">{before}</FieldValue> : null}
        {showBefore && showAfter ? (
          <ArrowRight
            aria-hidden="true"
            className="text-muted-foreground size-3 shrink-0 self-center"
          />
        ) : null}
        {showAfter ? <FieldValue side="after">{after}</FieldValue> : null}
      </span>
    );
  }
  return (
    <div
      data-slot="field-change-row"
      data-kind={kind}
      className={cn(
        'flex min-w-0 text-sm',
        layout === 'inline' && detail === undefined
          ? 'flex-wrap items-baseline gap-x-3 gap-y-0.5'
          : 'flex-col gap-1',
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      {body}
      {note === undefined ? null : (
        <span className="text-muted-foreground basis-full text-xs">{note}</span>
      )}
    </div>
  );
}

/** One changed item: a node, an input, a test. */
export interface ChangeItem {
  /** Stable across renders, so focus and the open rows survive an update. */
  id: string;
  kind: ChangeKind;
  title: ReactNode;
  /** A second line: what kind of item it is ("Language model"). */
  subtitle?: ReactNode;
  /** A few words on the row's trailing edge ("Prompt and model changed"). */
  summary?: ReactNode;
  /** What opening the row shows: its fields' changes. */
  detail?: ReactNode;
  /** The item's own glyph, beside its title. */
  icon?: ComponentType<{ className?: string }>;
}

export interface ChangeSection {
  id: string;
  title: string;
  description?: ReactNode;
  items: readonly ChangeItem[];
}

export interface ChangeListHandle {
  /** Focuses the row of `id`, else the list's current row. */
  focus(id?: string): void;
}

export interface ChangeListProps {
  sections: readonly ChangeSection[];
  'aria-label': string;
  /** The open rows, by item id; with `onExpandedChange`, the host's. */
  expanded?: ReadonlySet<string>;
  onExpandedChange?: (ids: Set<string>) => void;
  /** The rows open at first when the host does not hold them.
   *  @default 'none' */
  defaultExpanded?: 'none' | 'first' | 'all';
  /** Called by the action an open row offers (`activateLabel`), or by a
   *  row with no details when it is chosen. */
  onActivate?: (item: ChangeItem) => void;
  /** The open row's action ("Show on the graph"). */
  activateLabel?: string;
  /** The row the host is showing (marked `aria-current`). */
  activeId?: string | null;
  /** Instead of "No changes" when no section has an item. */
  emptyMessage?: ReactNode;
  className?: string;
}

/** Details fade in when a row opens; reduced motion shows them at once. */
const REVEAL =
  'animate-in fade-in duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:animate-none';

const ROW =
  'grid min-h-9 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2 text-left';

function initialExpanded(
  sections: readonly ChangeSection[],
  mode: 'none' | 'first' | 'all',
): Set<string> {
  const open = sections
    .flatMap((section) => section.items)
    .filter((item) => item.detail !== undefined);
  if (mode === 'all') return new Set(open.map((item) => item.id));
  if (mode === 'first' && open[0] !== undefined) return new Set([open[0].id]);
  return new Set();
}

/**
 * The changes of a comparison, grouped in sections (Start, Nodes, End,
 * Tests…): each row a kind's badge, the item's title and a short summary,
 * opening to its details below. One Tab stop: ↑ and ↓ move between rows
 * across the sections, Home and End jump, Enter or Space opens a row. Rows
 * open without moving the page; their details fade in.
 */
export const ChangeList: ForwardRefExoticComponent<
  ChangeListProps & RefAttributes<ChangeListHandle>
> = forwardRef<ChangeListHandle, ChangeListProps>(function ChangeList(
  {
    sections,
    'aria-label': ariaLabel,
    expanded: controlled,
    onExpandedChange,
    defaultExpanded = 'none',
    onActivate,
    activateLabel,
    activeId = null,
    emptyMessage,
    className,
  },
  ref,
) {
  const { t } = useT('changeList');
  const baseId = useId();
  const [own, setOwn] = useState<ReadonlySet<string>>(() =>
    initialExpanded(sections, defaultExpanded),
  );
  const expanded = controlled ?? own;
  const setExpanded = (next: Set<string>) => {
    setOwn(next);
    onExpandedChange?.(next);
  };
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const shown = useMemo(
    () => sections.filter((section) => section.items.length > 0),
    [sections],
  );
  // The rows a keyboard walks: those that open, or that do something.
  const order = useMemo(
    () =>
      shown
        .flatMap((section) => section.items)
        .filter((item) => item.detail !== undefined || onActivate !== undefined)
        .map((item) => item.id),
    [shown, onActivate],
  );
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const listed = (id: string | null): id is string =>
    id !== null && order.includes(id);
  const rovingId = listed(focusedId)
    ? focusedId
    : listed(activeId)
      ? activeId
      : (order[0] ?? null);
  const rovingRef = useRef(rovingId);
  useLayoutEffect(() => {
    rovingRef.current = rovingId;
  }, [rovingId]);

  const focusRow = useCallback((id: string) => {
    const row = rows.current.get(id);
    if (row === undefined) return;
    rovingRef.current = id;
    setFocusedId(id);
    row.focus();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus(id?: string) {
        const target =
          id !== undefined && rows.current.has(id) ? id : rovingRef.current;
        if (target !== null) focusRow(target);
      },
    }),
    [focusRow],
  );

  const onRowKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    const at = order.indexOf(id);
    let next: string | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = order[Math.min(at + 1, order.length - 1)];
        break;
      case 'ArrowUp':
        next = order[Math.max(at - 1, 0)];
        break;
      case 'Home':
        next = order[0];
        break;
      case 'End':
        next = order[order.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== undefined) focusRow(next);
  };

  if (shown.length === 0) {
    return (
      <p
        data-slot="change-list"
        className={cn('text-muted-foreground text-sm', className)}
      >
        {emptyMessage ?? t('empty')}
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="change-list"
      className={cn('flex min-w-0 flex-col gap-4', className)}
    >
      {shown.map((section) => {
        const headingId = `${baseId}-${section.id}`;
        return (
          <section
            key={section.id}
            aria-labelledby={headingId}
            data-section={section.id}
            className="flex flex-col gap-1"
          >
            <h3
              id={headingId}
              className="flex items-baseline gap-2 px-3 text-sm font-medium"
            >
              {section.title}
              <span className="text-muted-foreground text-xs font-normal tabular-nums">
                {section.items.length}
              </span>
            </h3>
            {section.description === undefined ? null : (
              <p className="text-muted-foreground px-3 text-xs">
                {section.description}
              </p>
            )}
            <ul role="list" className="divide-border divide-y">
              {section.items.map((item) => {
                const hasDetail = item.detail !== undefined;
                const open = hasDetail && expanded.has(item.id);
                const detailId = `${baseId}-${item.id}-detail`;
                const Icon = item.icon;
                const content = (
                  <>
                    <ChangeKindBadge kind={item.kind} className="mt-0.5" />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        {Icon === undefined ? null : (
                          <Icon className="text-muted-foreground size-4 shrink-0" />
                        )}
                        <span className="min-w-0 break-words">
                          {item.title}
                        </span>
                      </span>
                      {item.subtitle === undefined ? null : (
                        <span className="text-muted-foreground text-xs break-words">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1.5 pt-0.5 text-right text-xs">
                      {item.summary}
                      {hasDetail ? (
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            'size-4 shrink-0 transition-transform duration-[var(--duration-short)] motion-reduce:transition-none',
                            open && 'rotate-180',
                          )}
                        />
                      ) : null}
                    </span>
                  </>
                );
                const actionable = hasDetail || onActivate !== undefined;
                const isActive = item.id === activeId;
                return (
                  <li key={item.id} data-change-item={item.id}>
                    {actionable ? (
                      <button
                        ref={(node) => {
                          if (node === null) rows.current.delete(item.id);
                          else rows.current.set(item.id, node);
                        }}
                        type="button"
                        tabIndex={item.id === rovingId ? 0 : -1}
                        aria-expanded={hasDetail ? open : undefined}
                        aria-controls={open ? detailId : undefined}
                        aria-current={isActive ? 'true' : undefined}
                        onFocus={() => setFocusedId(item.id)}
                        onKeyDown={(event) => onRowKeyDown(event, item.id)}
                        onClick={() => {
                          if (hasDetail) toggle(item.id);
                          else onActivate?.(item);
                        }}
                        className={cn(
                          ROW,
                          'hover:bg-muted/60 focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                          isActive && 'bg-muted/60',
                        )}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className={ROW}>{content}</div>
                    )}
                    {open ? (
                      <div
                        id={detailId}
                        data-slot="change-detail"
                        className={cn('space-y-2 pr-3 pb-3 pl-9', REVEAL)}
                      >
                        {item.detail}
                        {onActivate !== undefined &&
                        activateLabel !== undefined ? (
                          <div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onActivate(item)}
                            >
                              {activateLabel}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
});
