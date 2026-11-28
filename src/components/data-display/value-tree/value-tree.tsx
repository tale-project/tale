'use client';

import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Copy,
  Dot,
  EyeOff,
  Minus,
  Plus,
  Route,
  Scissors,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { pathOf, pointerOf } from '../../../data/json-pointer';
import { jsonNormalize } from '../../../data/stable-stringify';
import { useVirtualList } from '../../../hooks/use-virtual-list';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { formatBytes } from '../../../lib/format';
import { Tooltip } from '../../overlays/tooltip';
import { treeKeyAction, typeaheadMatch, type TreeKeyAction } from './keyboard';
import {
  childKeys,
  flattenValue,
  valueAt,
  type ValueElision,
  type ValueMark,
  type ValueMarks,
  type ValueNodeRow,
  type ValueTreeRow,
} from './model';
import { formatValueInline, pathText, summarizeValue } from './summarize';

export { pointerOf, pathOf } from '../../../data/json-pointer';
export type { ValueSummary } from '../../../data/value-summary';
export type {
  ValueElision,
  ValueMark,
  ValueMarkKind,
  ValueMarks,
} from './model';
export {
  formatNumberExact,
  formatValueInline,
  pathText,
  summarizeValue,
  summaryWords,
  type SummarizeOptions,
} from './summarize';

export interface ValueTreeProps {
  value: unknown;
  'aria-label': string;
  /** Out-of-band recording facts (`RecordedValue.elided`): places a
   *  recorder cut, shown as chips, never as values. */
  elided?: readonly ValueElision[];
  /** Pointers whose value is a hidden secret (`RecordedValue.redacted`). */
  redacted?: readonly string[];
  /** Highlights by JSON pointer; `missing` adds a ghost row for a key the
   *  value does not have. A marked place opens up to its mark. */
  marks?: ValueMarks;
  /** Containers above this level open on their own: 1 shows the top level
   *  with its containers closed; `Infinity` opens everything. */
  defaultExpandDepth?: number;
  /** Longer text shows one line, then "Show all N characters": 240. */
  maxStringChars?: number;
  /** Children shown per container before "Show N more": 50. */
  pageSize?: number;
  selectedPointer?: string | null;
  /** Enter or a click on a row; without it a click opens and closes. */
  onSelectPointer?: (pointer: string) => void;
  /** Copy value / Copy path on each row and ⌘C / ⇧⌘C: on by default. */
  copyable?: boolean;
  /** `compact` rows are 24 px (an inspector), `comfortable` 28 px. */
  density?: 'compact' | 'comfortable';
  /** Window the rows; `auto` above 500 shown rows. The tree then scrolls
   *  itself, 32rem tall unless `className` sets a height. */
  virtualize?: boolean | 'auto';
  className?: string;
}

const VIRTUALIZE_ABOVE = 500;
const TYPEAHEAD_MS = 500;

/** Each mark's row tint, gutter glyph and glyph colour. A mark never
 *  speaks by colour alone: the glyph and the row's name say it too. */
const MARK_STYLE: Record<
  Exclude<ValueMark['kind'], 'focus' | 'missing'>,
  { row: string; icon: typeof Plus; iconClass: string }
> = {
  added: { row: 'bg-success/10', icon: Plus, iconClass: 'text-success' },
  removed: {
    row: 'bg-destructive/10',
    icon: Minus,
    iconClass: 'text-destructive',
  },
  // Lucide's dot is a 2-unit circle; a heavier stroke makes it read as a
  // mark beside the plus and the minus.
  changed: {
    row: 'bg-info',
    icon: Dot,
    iconClass: 'text-info-foreground fill-current [stroke-width:5]',
  },
  'type-changed': {
    row: 'bg-amber-500/15',
    icon: ArrowLeftRight,
    iconClass: 'text-amber-700 dark:text-amber-500',
  },
};

function markStyleOf(mark: ValueMark | undefined) {
  switch (mark?.kind) {
    case 'added':
    case 'removed':
    case 'changed':
    case 'type-changed':
      return MARK_STYLE[mark.kind];
    default:
      return undefined;
  }
}

/** A value's colour by type, from the code palette (AA on every surface
 *  code sits on, both themes). */
function valueTone(kind: ValueNodeRow['kind']): string {
  switch (kind) {
    case 'string':
      return 'text-[var(--code-token-string)]';
    case 'number':
      return 'text-[var(--code-token-constant)]';
    case 'boolean':
    case 'null':
      return 'text-[var(--code-token-keyword)]';
    default:
      return 'text-muted-foreground';
  }
}

/** What "Copy value" puts on the clipboard: text as it is, anything else
 *  as JSON. */
function copyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2) ?? '';
}

/** The value as plain JSON data; a value JSON cannot write (one that holds
 *  itself) is shown as given. */
function normalize(value: unknown): unknown {
  try {
    return jsonNormalize(value);
  } catch (error) {
    console.warn('A value tree was given a value JSON cannot write', error);
    return value;
  }
}

function Chip({
  icon: Icon,
  children,
}: {
  icon: typeof Scissors;
  children: ReactNode;
}) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex h-5 shrink-0 items-center gap-1 self-center rounded-full px-1.5 font-sans text-xs">
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      {children}
    </span>
  );
}

/**
 * A value as a tree a person can read and walk with the keyboard: keys,
 * values coloured by type, lists and objects that open, a page of children
 * at a time, long text cut to one line until asked. It also shows what a
 * recorder left out — cut text, dropped items, hidden secrets — as chips,
 * never as values, and highlights by JSON pointer (added, removed,
 * changed, a focus, a key that is missing).
 *
 * Follows the WAI-ARIA tree pattern with one tab stop: ↑/↓ move, → opens,
 * ← closes or goes to the parent, Home/End, `*` opens the siblings, typing
 * jumps to a key, Enter selects (`onSelectPointer`), ⌘/Ctrl+C copies the
 * row's value and ⇧⌘/Ctrl+C its path.
 */
export function ValueTree({
  value,
  'aria-label': ariaLabel,
  elided,
  redacted,
  marks,
  defaultExpandDepth = 1,
  maxStringChars = 240,
  pageSize = 50,
  selectedPointer = null,
  onSelectPointer,
  copyable = true,
  density = 'comfortable',
  virtualize = 'auto',
  className,
}: ValueTreeProps) {
  const { t } = useT('valueTree');
  const { t: tCommon } = useT('common');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const helpId = useId();
  const treeRef = useRef<HTMLDivElement | null>(null);

  const data = useMemo(() => normalize(value), [value]);
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [textOpen, setTextOpen] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState<{
    id: string;
    what: 'value' | 'path';
  } | null>(null);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  const focusRequest = useRef<string | null>(null);
  const typeahead = useRef({ buffer: '', timer: 0 });

  const rows = useMemo(
    () =>
      flattenValue(data, {
        expanded,
        shown,
        defaultExpandDepth,
        pageSize,
        marks,
        elided,
        redacted,
        selectedPointer,
      }),
    [
      data,
      expanded,
      shown,
      defaultExpandDepth,
      pageSize,
      marks,
      elided,
      redacted,
      selectedPointer,
    ],
  );
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.id, index));
    return map;
  }, [rows]);

  const activeIndex = useMemo(() => {
    if (activeId !== null) {
      const at = indexById.get(activeId);
      if (at !== undefined) return at;
      // The active row was closed away: its nearest shown ancestor (for a
      // "Show more" row, the container it pages comes first).
      const [pointer = '', suffix] = activeId.split('\u0000');
      let path: (string | number)[] = [];
      try {
        path = pathOf(pointer);
      } catch (error) {
        console.warn('A value tree lost its active row', error);
      }
      const from = suffix === 'more' ? path.length : path.length - 1;
      for (let depth = from; depth >= 0; depth--) {
        const ancestor = indexById.get(pointerOf(path.slice(0, depth)));
        if (ancestor !== undefined) return ancestor;
      }
    }
    const selected =
      selectedPointer === null ? undefined : indexById.get(selectedPointer);
    return selected ?? 0;
  }, [activeId, indexById, selectedPointer]);
  const activeRowId = rows[activeIndex]?.id ?? null;

  const hasGutter = useMemo(
    () => rows.some((row) => row.type === 'node' && row.mark !== undefined),
    [rows],
  );
  const virtualized =
    virtualize === true ||
    (virtualize === 'auto' && rows.length > VIRTUALIZE_ABOVE);
  const rowHeight = density === 'compact' ? 24 : 28;
  const getScrollElement = useCallback(() => treeRef.current, []);
  const getItemKey = useCallback(
    (index: number) => rows[index]?.id ?? index,
    [rows],
  );
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);
  const virtual = useVirtualList({
    count: rows.length,
    getScrollElement,
    getItemKey,
    estimateSize,
    threshold: virtualized ? 0 : Number.POSITIVE_INFINITY,
    pinnedIndices: [activeIndex],
  });

  const isLongText = useCallback(
    (row: ValueTreeRow) =>
      row.type === 'node' &&
      typeof row.value === 'string' &&
      row.value.length > maxStringChars,
    [maxStringChars],
  );

  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ text, count: previous.count + 1 }));
  }, []);

  // Move focus to a row asked for by the keyboard once it is rendered.
  useLayoutEffect(() => {
    const id = focusRequest.current;
    if (id === null) return;
    const index = indexById.get(id);
    if (index === undefined) return;
    focusRequest.current = null;
    if (virtual.virtualized) virtual.scrollToIndex(index, { align: 'auto' });
    const element = rowElement(treeRef.current, id);
    element?.focus({ preventScroll: true });
    if (!virtual.virtualized) element?.scrollIntoView?.({ block: 'nearest' });
  });

  // A selection made outside the tree scrolls its row into view — only a
  // new selection: the reader's own scrolling stands.
  const latest = useRef({ indexById, virtual });
  latest.current = { indexById, virtual };
  useEffect(() => {
    if (selectedPointer === null) return;
    const { indexById: index, virtual: list } = latest.current;
    const at = index.get(selectedPointer);
    if (at === undefined) return;
    if (list.virtualized) {
      list.scrollToIndex(at, { align: 'auto' });
      return;
    }
    rowElement(treeRef.current, selectedPointer)?.scrollIntoView?.({
      block: 'nearest',
    });
  }, [selectedPointer]);

  useEffect(() => {
    const state = typeahead.current;
    return () => window.clearTimeout(state.timer);
  }, []);

  const focusRow = (id: string) => {
    setActiveId(id);
    focusRequest.current = id;
  };

  const setOpen = (ids: readonly string[], open: boolean) => {
    setExpanded((previous) => {
      const next = new Map(previous);
      for (const id of ids) next.set(id, open);
      return next;
    });
  };

  const setText = (id: string, open: boolean) => {
    setTextOpen((previous) => {
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const showMore = (row: Extract<ValueTreeRow, { type: 'more' }>) => {
    setShown((previous) =>
      new Map(previous).set(row.containerPointer, row.shown + row.next),
    );
    // Focus lands on the first row of the new page.
    let path: (string | number)[] = [];
    try {
      path = pathOf(row.containerPointer);
    } catch (error) {
      console.warn('A value tree could not page a container', error);
      return;
    }
    const key = childKeys(valueAt(data, path))[row.shown];
    if (key !== undefined) focusRow(pointerOf([...path, key]));
  };

  const copy = async (row: ValueTreeRow, what: 'value' | 'path') => {
    if (row.type === 'more') return;
    if (what === 'value' && row.type === 'missing') return;
    const text =
      what === 'path'
        ? pathText(row.path)
        : copyText(row.type === 'node' ? row.value : undefined);
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ id: row.id, what });
      announce(t('copied'));
    } catch (error) {
      console.warn('A value tree could not copy to the clipboard', error);
    }
  };

  useEffect(() => {
    if (copied === null) return undefined;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const activate = (row: ValueTreeRow) => {
    if (row.type === 'more') {
      showMore(row);
      return;
    }
    if (onSelectPointer !== undefined) {
      onSelectPointer(row.pointer);
      return;
    }
    if (row.type !== 'node') return;
    if (row.container) setOpen([row.id], !row.expanded);
    else if (isLongText(row)) setText(row.id, !textOpen.has(row.id));
  };

  const run = (action: TreeKeyAction, row: ValueTreeRow) => {
    switch (action.type) {
      case 'focus': {
        const target = rows[action.index];
        if (target !== undefined) focusRow(target.id);
        return;
      }
      case 'open':
        setOpen([action.id], true);
        return;
      case 'close':
        setOpen([action.id], false);
        return;
      case 'openSiblings':
        setOpen(action.ids, true);
        return;
      case 'openText':
        setText(action.id, true);
        return;
      case 'closeText':
        setText(action.id, false);
        return;
      case 'activate':
        activate(row);
        return;
      case 'copy':
        void copy(row, action.what);
        return;
      case 'type': {
        const state = typeahead.current;
        window.clearTimeout(state.timer);
        state.buffer += action.char;
        state.timer = window.setTimeout(() => {
          state.buffer = '';
        }, TYPEAHEAD_MS);
        const match = typeaheadMatch(rows, activeIndex, state.buffer);
        if (match !== null) focusRow(rows[match].id);
        return;
      }
    }
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const row = rows[index];
    if (row === undefined) return;
    const isCopy =
      (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c';
    if (isCopy) {
      // Text the reader selected inside the tree copies as text.
      const selection = window.getSelection();
      if (
        selection !== null &&
        !selection.isCollapsed &&
        treeRef.current?.contains(selection.anchorNode)
      ) {
        return;
      }
    }
    const action = treeKeyAction(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
      },
      rows,
      index,
      { textOpen, isLongText, copyable },
    );
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    run(action, row);
  };

  const onRowClick = (event: MouseEvent<HTMLElement>, index: number) => {
    const row = rows[index];
    if (row === undefined) return;
    setActiveId(row.id);
    const onChevron =
      event.target instanceof Element &&
      event.target.closest('[data-chevron]') !== null;
    if (row.type === 'node' && row.container && onChevron) {
      setOpen([row.id], !row.expanded);
      return;
    }
    activate(row);
  };

  const quoteText = (text: string) => t('summary.quote', { text });

  const markWords = (mark: ValueMark | undefined): string | null => {
    if (mark === undefined) return null;
    const before =
      mark.before === undefined
        ? undefined
        : formatValueInline(t, mark.before, { locale });
    switch (mark.kind) {
      case 'added':
        return t('mark.added');
      case 'removed':
        return t('mark.removed');
      case 'changed':
        return before === undefined
          ? t('mark.changedPlain')
          : t('mark.changed', { before });
      case 'type-changed':
        return before === undefined
          ? t('mark.typeChangedPlain')
          : t('mark.typeChanged', { before });
      default:
        return null;
    }
  };

  const elisionWords = (elision: ValueElision): string => {
    switch (elision.kind) {
      case 'string':
        return t('elided.string', { count: elision.dropped });
      case 'items':
        return t('elided.items', { count: elision.dropped });
      case 'depth':
        return t('elided.depth');
      default:
        return t('elided.whole', {
          size: formatBytes(elision.dropped, locale),
        });
    }
  };

  /** What stands for a row's value: a chip when the value was not kept. */
  const withheld = (row: ValueNodeRow): string | null => {
    if (row.redacted && !row.container) return t('redacted');
    const cut = row.elided.find(
      (each) => each.kind === 'whole' || each.kind === 'depth',
    );
    return cut === undefined ? null : elisionWords(cut);
  };

  const rowName = (row: ValueTreeRow): string => {
    if (row.type === 'more') return t('showMore', { count: row.next });
    if (row.type === 'missing') return t('missing', { key: String(row.key) });
    const instead = withheld(row);
    const notes = row.elided
      .filter((each) => each.kind === 'string' || each.kind === 'items')
      .map(elisionWords);
    if (row.redacted && row.container) notes.push(t('redacted'));
    let words: string;
    if (instead !== null) words = instead;
    else if (typeof row.value === 'string' && textOpen.has(row.id)) {
      words = quoteText(row.value);
    } else {
      words = row.container
        ? summarizeValue(t, row.value, { locale })
        : formatValueInline(t, row.value, {
            locale,
            maxChars: maxStringChars,
          });
    }
    const said = [words, ...notes].join(', ');
    const name =
      row.key === null
        ? said
        : t('name', { key: String(row.key), value: said });
    const mark = markWords(row.mark);
    return mark === null ? name : t('markedName', { mark, name });
  };

  const rootChips = useMemo(() => {
    if (rows[0]?.type === 'node' && rows[0].key === null) return [];
    return [
      ...(elided ?? []).filter((each) => each.pointer === ''),
      ...((redacted ?? []).includes('') ? ['redacted' as const] : []),
    ];
  }, [rows, elided, redacted]);

  /** On a tinted row, quiet text takes the full foreground: muted grey
   *  drops under 4.5:1 on the amber and green tints. */
  const quietOn = (row: ValueNodeRow) =>
    markStyleOf(row.mark) === undefined
      ? 'text-muted-foreground'
      : 'text-foreground';

  const renderValue = (row: ValueNodeRow): ReactNode => {
    const instead = withheld(row);
    if (instead !== null) {
      return (
        <WithheldChip
          redacted={row.redacted}
          hint={t('redactedHint')}
          label={instead}
        />
      );
    }
    if (row.container || isEmptyContainer(row.value)) {
      return (
        <span className={cn(quietOn(row), 'font-sans')}>
          {summarizeValue(t, row.value, { locale })}
        </span>
      );
    }
    if (row.kind === 'undefined') {
      return (
        <span className={cn(quietOn(row), 'font-sans')}>
          {t('summary.missing')}
        </span>
      );
    }
    if (typeof row.value === 'string') {
      const long = row.value.length > maxStringChars;
      const open = textOpen.has(row.id);
      const text =
        long && !open ? row.value.slice(0, maxStringChars) : row.value;
      return (
        <>
          <span
            className={cn(
              valueTone('string'),
              long && !open
                ? // Cut text keeps to its key's line, filling what is left.
                  'min-w-[12ch] flex-1 basis-0 truncate'
                : 'min-w-0 wrap-anywhere whitespace-pre-wrap',
            )}
          >
            &quot;{text}
            {long && !open ? '…' : ''}&quot;
          </span>
          {long ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                setActiveId(row.id);
                setText(row.id, !open);
              }}
              className={cn(
                quietOn(row),
                'hover:text-foreground shrink-0 cursor-pointer font-sans text-xs underline underline-offset-2',
              )}
            >
              {open
                ? tCommon('actions.showLess')
                : t('showAllText', { count: row.value.length })}
            </button>
          ) : null}
        </>
      );
    }
    return (
      <span className={cn(valueTone(row.kind), 'break-all')}>
        {String(row.value)}
      </span>
    );
  };

  const renderActions = (row: ValueTreeRow) => {
    if (!copyable || row.type === 'more') return null;
    const button = (what: 'value' | 'path') => {
      const done = copied?.id === row.id && copied.what === what;
      const Icon = done ? Check : what === 'value' ? Copy : Route;
      const label = what === 'value' ? t('copyValue') : t('copyPath');
      return (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          title={label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            setActiveId(row.id);
            void copy(row, what);
          }}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-sm"
        >
          <Icon className={cn('size-3.5', done && 'text-success')} />
        </button>
      );
    };
    return (
      <span className="flex shrink-0 items-center gap-0.5 self-start opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
        {row.type === 'node' ? button('value') : null}
        {button('path')}
      </span>
    );
  };

  const renderRow = (row: ValueTreeRow, index: number) => {
    const mark = row.type === 'node' ? row.mark : undefined;
    const markStyle = markStyleOf(mark);
    const MarkIcon = markStyle?.icon;
    const selected =
      onSelectPointer !== undefined &&
      row.type !== 'more' &&
      row.pointer === selectedPointer;
    return (
      <div
        role="treeitem"
        data-row-id={row.id}
        data-pointer={row.type === 'more' ? undefined : row.pointer}
        data-index={index}
        ref={virtual.virtualized ? virtual.measureElement : undefined}
        onFocusCapture={
          virtual.virtualized ? virtual.onFocusCapture : undefined
        }
        onBlurCapture={virtual.virtualized ? virtual.onBlurCapture : undefined}
        aria-level={row.level}
        aria-setsize={row.setsize}
        aria-posinset={row.posinset}
        aria-expanded={
          row.type === 'node' && row.container ? row.expanded : undefined
        }
        aria-selected={
          onSelectPointer !== undefined && row.type !== 'more'
            ? selected
            : undefined
        }
        aria-label={rowName(row)}
        tabIndex={row.id === activeRowId ? 0 : -1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setActiveId(row.id);
        }}
        onKeyDown={(event) => onRowKeyDown(event, index)}
        onClick={(event) => onRowClick(event, index)}
        className={cn(
          'group/row relative flex w-full cursor-default items-start gap-1 rounded-sm px-1 font-mono text-xs leading-4',
          density === 'compact' ? 'min-h-6 py-1' : 'min-h-7 py-1.5',
          'focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
          markStyle?.row,
          mark?.kind === 'focus' && 'ring-ring ring-1 ring-inset',
          selected && 'bg-muted',
          !selected && markStyle === undefined && 'hover:bg-muted/60',
        )}
      >
        {hasGutter ? (
          <span
            aria-hidden="true"
            className="flex h-4 w-4 shrink-0 items-center justify-center"
          >
            {MarkIcon !== undefined ? (
              <MarkIcon className={cn('size-3.5', markStyle?.iconClass)} />
            ) : null}
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="shrink-0"
          style={{ width: `${row.level - 1}rem` }}
        />
        {row.type === 'more' ? (
          <span className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-1 font-sans underline underline-offset-2">
            {t('showMore', { count: row.next })}
          </span>
        ) : row.type === 'missing' ? (
          <>
            <span aria-hidden="true" className="size-4 shrink-0" />
            <span className="text-muted-foreground min-w-0 flex-1 break-all [text-decoration-line:underline] decoration-dashed underline-offset-2">
              {t('missing', { key: String(row.key) })}
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              data-chevron={row.container ? '' : undefined}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center',
                row.container && 'text-muted-foreground cursor-pointer',
              )}
            >
              {row.container ? (
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:transition-none',
                    row.expanded && 'rotate-90',
                  )}
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {row.key === null ? null : (
                <span
                  className={cn(
                    'text-foreground break-all',
                    row.mark?.kind === 'removed' &&
                      'decoration-destructive line-through',
                  )}
                >
                  {String(row.key)}
                  <span className={quietOn(row)}>:</span>
                </span>
              )}
              {renderValue(row)}
              {row.elided
                .filter(
                  (each) => each.kind === 'string' || each.kind === 'items',
                )
                .map((each) => (
                  <Chip key={each.kind} icon={Scissors}>
                    {elisionWords(each)}
                  </Chip>
                ))}
              {row.redacted && row.container ? (
                <WithheldChip
                  redacted
                  hint={t('redactedHint')}
                  label={t('redacted')}
                />
              ) : null}
            </span>
          </>
        )}
        {renderActions(row)}
      </div>
    );
  };

  return (
    <div
      data-slot="value-tree"
      className={cn('flex min-h-0 flex-col', className)}
    >
      {rootChips.length > 0 ? (
        <div className="flex flex-wrap gap-1 pb-1">
          {rootChips.map((chip) =>
            chip === 'redacted' ? (
              <WithheldChip
                key="redacted"
                redacted
                hint={t('redactedHint')}
                label={t('redacted')}
              />
            ) : (
              <Chip key={chip.kind} icon={Scissors}>
                {elisionWords(chip)}
              </Chip>
            ),
          )}
        </div>
      ) : null}
      <div
        ref={treeRef}
        role="tree"
        aria-label={ariaLabel}
        aria-describedby={helpId}
        className={cn(
          'relative min-h-0 overflow-auto',
          virtual.virtualized && 'max-h-[32rem]',
        )}
      >
        {virtual.items.map((item) => {
          const row = rows[item.index];
          if (row === undefined) return null;
          return (
            <Fragment key={row.id}>
              {item.paddingBefore > 0 ? (
                <div
                  aria-hidden="true"
                  style={{ height: item.paddingBefore }}
                />
              ) : null}
              {renderRow(row, item.index)}
            </Fragment>
          );
        })}
        {virtual.paddingAfter > 0 ? (
          <div aria-hidden="true" style={{ height: virtual.paddingAfter }} />
        ) : null}
      </div>
      <p id={helpId} className="sr-only">
        {t('keyboardHelp')}
      </p>
      <p role="status" className="sr-only">
        <span key={announcement.count}>{announcement.text}</span>
      </p>
    </div>
  );
}

/** The rendered row with `id`, matched by its data attribute (no
 *  selector escaping: ids are pointers and may hold any character). */
function rowElement(
  tree: HTMLElement | null,
  id: string,
): HTMLElement | undefined {
  if (tree === null) return undefined;
  for (const row of tree.querySelectorAll<HTMLElement>('[data-row-id]')) {
    if (row.dataset.rowId === id) return row;
  }
  return undefined;
}

function isEmptyContainer(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

/** A value that was not kept: a hidden secret (with why, on hover) or a
 *  value too large or too deep to keep. */
function WithheldChip({
  redacted,
  hint,
  label,
}: {
  redacted: boolean;
  hint: string;
  label: string;
}) {
  if (!redacted) return <Chip icon={Scissors}>{label}</Chip>;
  return (
    <Tooltip content={hint}>
      <span className="bg-muted text-muted-foreground inline-flex h-5 shrink-0 items-center gap-1 self-center rounded-full px-1.5 font-sans text-xs">
        <EyeOff aria-hidden="true" className="size-3 shrink-0" />
        {label}
      </span>
    </Tooltip>
  );
}
