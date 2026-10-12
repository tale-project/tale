'use client';

import type { TFunction } from 'i18next';
import {
  ArrowDownUp,
  ArrowLeftRight,
  CircleHelp,
  Dot,
  Equal,
  Minus,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import {
  Fragment,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { inferSchema, type SchemaTreeSchema } from '../../../data/infer-schema';
import { pointerOf } from '../../../data/json-pointer';
import { jsonNormalize } from '../../../data/stable-stringify';
import {
  diffShapes,
  diffValues,
  type DiffChange,
  type DiffKind,
  type DiffOptions,
  type DiffResult,
} from '../../../data/value-diff';
import { useResizeObserver } from '../../../hooks/use-resize-observer';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { SegmentedControl } from '../../forms/segmented-control';
import {
  SchemaTree,
  schemaKindLabel,
  type SchemaTreeMark,
} from '../schema-tree';
import { isOpenable } from '../value-tree/model';
import { formatValueInline, pathText } from '../value-tree/summarize';
import { ValueTree, type ValueMark } from '../value-tree/value-tree';
import {
  orderChanges,
  shapeKeysAt,
  sharesStructure,
  unchangedFields,
  valueKeysAt,
} from './rows';
import { DataDiffSummary } from './summary';

export {
  diffShapes,
  diffValues,
  suggestDiffRoot,
  type DiffChange,
  type DiffKind,
  type DiffOptions,
  type DiffResult,
} from '../../../data/value-diff';
export {
  DataDiffSummary,
  diffSummaryText,
  type DataDiffSummaryProps,
} from './summary';

export type DataDiffLayout = 'list' | 'split';

export interface DataDiffProps {
  before: unknown;
  after: unknown;
  /** A diff computed elsewhere (the compare page shares one); in Values
   *  mode it replaces the one this view would compute. */
  result?: DiffResult;
  /** How the Values diff pairs list items and which places it leaves
   *  unjudged (`unknownAt`: pointers withheld on either side). */
  options?: DiffOptions;
  /** `values` compares the values, `shape` their inferred shapes. */
  mode?: 'values' | 'shape';
  /** `list`: one sentence per change. `split`: the two values side by side
   *  with their changes marked, from a 48rem wide container (narrower, the
   *  list shows). */
  layout?: DataDiffLayout;
  /** Shows a List / Side by side switch when there is room for both. */
  onLayoutChange?: (layout: DataDiffLayout) => void;
  /** The two sides' names: "Before"/"After", "A"/"B", "Pass 2"/"Pass 3". */
  labels?: { before: string; after: string };
  /** Controlled disclosure of the unchanged fields. */
  showUnchanged?: boolean;
  onShowUnchangedChange?: (show: boolean) => void;
  'aria-label': string;
  /** Instead of "No changes". */
  emptyMessage?: ReactNode;
  /** Instead of the sentence that says the two share no structure. */
  unrelatedMessage?: ReactNode;
  className?: string;
}

const SPLIT_MIN_WIDTH = 768;

const KIND_STYLE: Readonly<
  Record<DiffKind, { icon: LucideIcon; className: string }>
> = {
  added: { icon: Plus, className: 'text-success' },
  removed: { icon: Minus, className: 'text-destructive' },
  changed: {
    icon: Dot,
    className: 'text-info-foreground fill-current [stroke-width:5]',
  },
  'type-changed': {
    icon: ArrowLeftRight,
    className: 'text-amber-700 dark:text-amber-500',
  },
  reordered: { icon: ArrowDownUp, className: 'text-muted-foreground' },
  unknown: { icon: CircleHelp, className: 'text-muted-foreground' },
};

/** A slot the sentence keeps for a rich part: the path, set in mono. */
const SLOT = '\u0002path\u0003';

function normalize(value: unknown): unknown {
  try {
    return jsonNormalize(value);
  } catch (error) {
    console.warn('A diff was given a value JSON cannot write', error);
    return value;
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A shape path in words, list items as `[]`: `issues[].title`. */
function shapePathText(path: readonly (string | number)[]): string {
  let text = '';
  for (const segment of path) {
    if (typeof segment === 'number') text += '[]';
    else if (IDENTIFIER.test(segment)) {
      text += text === '' ? segment : `.${segment}`;
    } else text += `[${JSON.stringify(segment)}]`;
  }
  return text;
}

/** A shape's type text (`integer|null`) in words ("a whole number or
 *  empty"). */
function typeWords(tSchema: TFunction, type: unknown, locale: string): string {
  const types = typeof type === 'string' && type !== '' ? type.split('|') : [];
  // One type reads the same as a list of one.
  const schema: SchemaTreeSchema = types.length === 0 ? {} : { type: types };
  return schemaKindLabel(tSchema, schema, locale);
}

/** Marks for the two trees of the split layout. `forward` names places in
 *  `after`; `reverse` (after → before) names them in `before`, where a list
 *  paired by key may hold an item at another position. */
function splitMarks(forward: DiffResult, reverse: DiffResult) {
  const after = new Map<string, ValueMark>();
  for (const change of forward.changes) {
    if (change.kind === 'added') after.set(change.pointer, { kind: 'added' });
    else if (change.kind === 'changed' || change.kind === 'type-changed') {
      after.set(change.pointer, { kind: change.kind, before: change.before });
    } else if (change.kind === 'reordered') {
      after.set(change.pointer, { kind: 'focus' });
    }
  }
  const before = new Map<string, ValueMark>();
  for (const change of reverse.changes) {
    if (change.kind === 'added')
      before.set(change.pointer, { kind: 'removed' });
    else if (change.kind === 'changed' || change.kind === 'type-changed') {
      before.set(change.pointer, { kind: change.kind });
    } else if (change.kind === 'reordered') {
      before.set(change.pointer, { kind: 'focus' });
    }
  }
  return { before, after };
}

/** Shape marks keyed the way `SchemaTree` names a field: property names
 *  from the top, list items transparent. */
function shapeMarks(result: DiffResult) {
  const key = (path: readonly (string | number)[]) =>
    JSON.stringify(path.filter((segment) => typeof segment === 'string'));
  const before = new Map<string, SchemaTreeMark>();
  const after = new Map<string, SchemaTreeMark>();
  for (const change of result.changes) {
    const at = key(change.path);
    if (change.kind === 'added') after.set(at, 'added');
    else if (change.kind === 'removed') before.set(at, 'removed');
    else if (change.kind === 'type-changed') {
      before.set(at, 'type-changed');
      after.set(at, 'type-changed');
    } else if (change.kind === 'changed' && change.after === 'optional') {
      after.set(at, 'optional');
    }
  }
  return {
    before: (path: readonly string[]) => before.get(JSON.stringify(path)),
    after: (path: readonly string[]) => after.get(JSON.stringify(path)),
  };
}

/** `text` with its path slot set as code, the first letter raised when the
 *  sentence opens with the whole value's name. */
function withPath(text: string, path: string, wholeValue: string): ReactNode[] {
  const at = text.indexOf(SLOT);
  if (at < 0) return [text];
  const label =
    path === ''
      ? at === 0
        ? wholeValue.charAt(0).toLocaleUpperCase() + wholeValue.slice(1)
        : wholeValue
      : null;
  return [
    text.slice(0, at),
    label === null ? (
      <code key="path" className="font-mono text-xs break-all">
        {path}
      </code>
    ) : (
      <Fragment key="path">{label}</Fragment>
    ),
    text.slice(at + SLOT.length),
  ];
}

/**
 * What changed between two values, in words a person reads: one sentence
 * per change in the order the value is written ("title changed from
 * “Fix login” to “Fix login bug”"), the counts on top, the fields that did
 * not change folded into one row. Side by side (`layout="split"`), the two
 * values show as trees with every change marked, scrolling together.
 * `mode="shape"` compares the values' shapes instead: fields that
 * appeared, disappeared, changed kind or are no longer always there.
 */
export function DataDiff({
  before: rawBefore,
  after: rawAfter,
  result: given,
  options,
  mode = 'values',
  layout = 'list',
  onLayoutChange,
  labels,
  showUnchanged: controlledShowUnchanged,
  onShowUnchangedChange,
  'aria-label': ariaLabel,
  emptyMessage,
  unrelatedMessage,
  className,
}: DataDiffProps) {
  const { t } = useT('dataDiff');
  const { t: tValues } = useT('valueTree');
  const { t: tSchema } = useT('schemaTree');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const listId = useId();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useResizeObserver(root, (entry) => {
    setWide(entry.contentRect.width >= SPLIT_MIN_WIDTH);
  });
  const [ownShowUnchanged, setOwnShowUnchanged] = useState(false);
  const showUnchanged = controlledShowUnchanged ?? ownShowUnchanged;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const before = useMemo(() => normalize(rawBefore), [rawBefore]);
  const after = useMemo(() => normalize(rawAfter), [rawAfter]);
  const related = useMemo(
    () => sharesStructure(before, after),
    [before, after],
  );
  const shapes = useMemo(
    () =>
      mode === 'shape'
        ? { before: inferSchema(before), after: inferSchema(after) }
        : null,
    [mode, before, after],
  );
  const result = useMemo(() => {
    if (shapes !== null) return diffShapes(shapes.before, shapes.after);
    return given ?? diffValues(before, after, options);
  }, [shapes, given, before, after, options]);
  const ordered = useMemo(
    () =>
      orderChanges(
        result.changes,
        shapes === null
          ? valueKeysAt(before, after)
          : shapeKeysAt(shapes.before, shapes.after),
      ),
    [result, shapes, before, after],
  );
  const unchanged = useMemo(
    () =>
      mode === 'values' && !result.identical
        ? unchangedFields(after, result.changes)
        : { fields: [], total: 0 },
    [mode, result, after],
  );
  const split = layout === 'split' && wide;
  const marks = useMemo(() => {
    if (!split) return null;
    if (shapes !== null) return { shape: shapeMarks(result), values: null };
    return {
      shape: null,
      values: splitMarks(result, diffValues(after, before, options)),
    };
  }, [split, shapes, result, before, after, options]);

  const sync = useRef<{ from: 'before' | 'after' | null }>({ from: null });
  const panes = useRef<Record<'before' | 'after', HTMLDivElement | null>>({
    before: null,
    after: null,
  });

  const inline = (value: unknown) =>
    formatValueInline(tValues, value, { locale, maxChars: 60 });
  const kindWords = (value: unknown) =>
    schemaKindLabel(
      tSchema,
      inferSchema(value, { maxDepth: 2, sampleItems: 20 }),
      locale,
    );

  const sentence = (change: DiffChange): string => {
    if (mode === 'shape') {
      switch (change.kind) {
        case 'added':
          return t('shape.added', {
            path: SLOT,
            kind: typeWords(tSchema, change.after, locale),
          });
        case 'removed':
          return t('shape.removed', { path: SLOT });
        case 'type-changed':
          return t('shape.typeChanged', {
            path: SLOT,
            beforeKind: typeWords(tSchema, change.before, locale),
            afterKind: typeWords(tSchema, change.after, locale),
          });
        default:
          return change.after === 'optional'
            ? t('shape.optional', { path: SLOT })
            : t('shape.required', { path: SLOT });
      }
    }
    switch (change.kind) {
      case 'added':
        return t('row.added', { path: SLOT, after: inline(change.after) });
      case 'removed':
        return t('row.removed', { path: SLOT, before: inline(change.before) });
      case 'changed':
        return t('row.changed', {
          path: SLOT,
          before: inline(change.before),
          after: inline(change.after),
        });
      case 'type-changed':
        return t('row.typeChanged', {
          path: SLOT,
          beforeKind: kindWords(change.before),
          afterKind: kindWords(change.after),
          after: inline(change.after),
        });
      case 'reordered':
        return t('row.reordered', { path: SLOT });
      default:
        return t('row.unknown', { path: SLOT });
    }
  };

  const toggleOpen = (key: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setShowUnchanged = (show: boolean) => {
    setOwnShowUnchanged(show);
    onShowUnchangedChange?.(show);
  };

  const onPaneScroll =
    (side: 'before' | 'after') => (event: UIEvent<HTMLDivElement>) => {
      const source = event.target;
      if (
        !(source instanceof HTMLElement) ||
        source.getAttribute('role') !== 'tree'
      ) {
        return;
      }
      if (sync.current.from !== null && sync.current.from !== side) {
        // The echo of a scroll this view set: let it pass once.
        sync.current.from = null;
        return;
      }
      const other = side === 'before' ? 'after' : 'before';
      const target =
        panes.current[other]?.querySelector<HTMLElement>('[role="tree"]');
      if (!target) return;
      // The first row in view, and the same place in the other tree (or
      // its nearest shown ancestor) at the same offset.
      let anchor: HTMLElement | null = null;
      for (const row of source.querySelectorAll<HTMLElement>(
        '[data-pointer]',
      )) {
        if (row.offsetTop + row.offsetHeight > source.scrollTop) {
          anchor = row;
          break;
        }
      }
      const pointer = anchor?.dataset.pointer;
      if (anchor === null || pointer === undefined) return;
      const rows = new Map<string, HTMLElement>();
      for (const row of target.querySelectorAll<HTMLElement>(
        '[data-pointer]',
      )) {
        const at = row.dataset.pointer;
        if (at !== undefined && !rows.has(at)) rows.set(at, row);
      }
      let match: HTMLElement | undefined;
      for (
        let at: string | null = pointer;
        at !== null && match === undefined;
        at = at === '' ? null : at.slice(0, Math.max(0, at.lastIndexOf('/')))
      ) {
        match = rows.get(at);
      }
      if (match === undefined) return;
      sync.current.from = side;
      target.scrollTop =
        match.offsetTop + (source.scrollTop - anchor.offsetTop);
    };

  const header =
    onLayoutChange !== undefined && wide && mode === 'values' ? (
      <SegmentedControl
        aria-label={t('layout.label')}
        value={layout}
        onValueChange={(next) =>
          onLayoutChange(next === 'split' ? 'split' : 'list')
        }
        options={[
          { value: 'list', label: t('layout.list') },
          { value: 'split', label: t('layout.split') },
        ]}
      />
    ) : null;

  const beforeLabel = labels?.before ?? t('before');
  const afterLabel = labels?.after ?? t('after');
  const listed = ordered.length;
  const counted = Object.entries(result.counts).reduce(
    (sum, [kind, count]) => (kind === 'unchanged' ? sum : sum + count),
    0,
  );

  let body: ReactNode;
  if (!related && mode === 'values') {
    body = (
      <p className="text-muted-foreground text-sm">
        {unrelatedMessage ?? t('unrelated')}
      </p>
    );
  } else if (result.identical) {
    body = (
      <p className="text-muted-foreground text-sm">
        {emptyMessage ?? t('none')}
      </p>
    );
  } else if (split && marks?.values) {
    body = (
      <div className="grid grid-cols-2 gap-3">
        {(['before', 'after'] as const).map((side) => (
          <div
            key={side}
            ref={(element) => {
              panes.current[side] = element;
            }}
            onScrollCapture={onPaneScroll(side)}
            className="flex min-w-0 flex-col gap-1"
          >
            <p className="text-xs font-medium">
              {side === 'before' ? beforeLabel : afterLabel}
            </p>
            <ValueTree
              value={side === 'before' ? before : after}
              marks={marks.values?.[side]}
              aria-label={`${ariaLabel}: ${side === 'before' ? beforeLabel : afterLabel}`}
              density="compact"
              className="max-h-[32rem]"
            />
          </div>
        ))}
      </div>
    );
  } else if (split && marks?.shape && shapes !== null) {
    body = (
      <div className="grid grid-cols-2 gap-3">
        {(['before', 'after'] as const).map((side) => (
          <div key={side} className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-medium">
              {side === 'before' ? beforeLabel : afterLabel}
            </p>
            <SchemaTree
              schema={shapes[side]}
              marks={marks.shape?.[side]}
              counts
              aria-label={`${ariaLabel}: ${side === 'before' ? beforeLabel : afterLabel}`}
            />
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <>
        <ul id={listId} aria-label={ariaLabel} className="flex flex-col">
          {ordered.map((change, index) => {
            const style = KIND_STYLE[change.kind];
            const Icon = style.icon;
            const key = `${index}:${change.kind}:${change.pointer}`;
            const subtree =
              mode === 'values' &&
              (change.kind === 'added' || change.kind === 'removed')
                ? change.kind === 'added'
                  ? change.after
                  : change.before
                : undefined;
            const openable = subtree !== undefined && isOpenable(subtree);
            const isOpen = open.has(key);
            const path =
              mode === 'shape'
                ? shapePathText(change.path)
                : pathText(change.path);
            const sentenceId = `${listId}-${index}`;
            return (
              <li
                key={key}
                className="grid min-h-7 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 py-1 text-sm"
              >
                <Icon
                  aria-hidden="true"
                  className={cn('mt-0.5 size-4', style.className)}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <p id={sentenceId} className="break-words">
                    {withPath(sentence(change), path, t('wholeValue'))}
                  </p>
                  {openable ? (
                    <>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-describedby={sentenceId}
                        onClick={() => toggleOpen(key)}
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit cursor-pointer rounded-sm text-xs underline underline-offset-2 focus-visible:ring-1 focus-visible:outline-none"
                      >
                        {isOpen ? t('hideValue') : t('showValue')}
                      </button>
                      {isOpen ? (
                        <ValueTree
                          value={subtree}
                          aria-label={path === '' ? t('wholeValue') : path}
                          density="compact"
                        />
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
          {unchanged.total > 0 ? (
            <li className="grid min-h-7 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 py-1 text-sm">
              <Equal
                aria-hidden="true"
                className="text-muted-foreground mt-0.5 size-4"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <button
                  type="button"
                  aria-expanded={showUnchanged}
                  onClick={() => setShowUnchanged(!showUnchanged)}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit cursor-pointer rounded-sm text-left text-sm underline underline-offset-2 focus-visible:ring-1 focus-visible:outline-none"
                >
                  {t('unchanged', { count: unchanged.total })}
                </button>
                {showUnchanged ? (
                  <ul className="flex flex-col gap-0.5">
                    {unchanged.fields.map((field) => (
                      <li
                        key={pointerOf(field.path)}
                        className="text-muted-foreground text-xs break-words"
                      >
                        <code className="font-mono">
                          {pathText(field.path)}
                        </code>
                        {': '}
                        {inline(field.value)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ) : null}
        </ul>
        {result.truncated && counted > listed ? (
          <p className="text-muted-foreground text-xs">
            {t('more', { count: counted - listed })}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div
      ref={setRoot}
      role="group"
      aria-label={ariaLabel}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      {related || mode === 'shape' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {result.identical ? null : <DataDiffSummary counts={result.counts} />}
          {header}
        </div>
      ) : null}
      {body}
    </div>
  );
}
