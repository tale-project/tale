'use client';

/**
 * The code diff itself, loaded on demand by `code-diff.tsx`: jsdiff (through
 * `./compute`) and the highlighter's tokens live here, so a page shows its
 * placeholder rows until they are needed.
 */

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FoldVertical,
  UnfoldVertical,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { useCopy } from '../../../hooks/use-copy';
import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion';
import { useResizeObserver } from '../../../hooks/use-resize-observer';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import {
  peekCodeTokens,
  shikiLanguageFor,
  tokenizeCode,
  type CodeTokenLines,
} from '../../../markdown/shiki';
import { SegmentedControl } from '../../forms/segmented-control';
import { Button } from '../../primitives/button';
import { IconButton } from '../../primitives/icon-button';
import {
  computeLineDiff,
  DIFF_CONTEXT,
  toUnifiedPatch,
  type DiffHunk,
  type DiffLine,
} from './compute';
import {
  codeDiffRows,
  lineSegments,
  splitRows,
  type CodeDiffSegment,
} from './rows';
import type { CodeDiffHandle, CodeDiffLayout, CodeDiffProps } from './types';

/** Side by side needs room for two columns of code: 64rem. */
const SPLIT_MIN_WIDTH = 1024;

const SIGN: Readonly<Record<DiffLine['kind'], string>> = {
  added: '+',
  removed: '−',
  unchanged: '',
};

/** A changed line's tint sits under its sign and its text; the line
 *  numbers keep the surface, where their muted colour holds 4.5:1. */
const TINT: Readonly<Record<DiffLine['kind'], string>> = {
  added: 'bg-diff-added-bg',
  removed: 'bg-diff-removed-bg',
  unchanged: '',
};

/** In forced colours the tints drop: a 2 px edge in the text colour marks
 *  a changed line beside its sign. */
const FORCED_EDGE = 'forced-colors:[border-inline-start:2px_solid_CanvasText]';

const GUTTER =
  'text-muted-foreground w-12 px-2 text-right align-top tabular-nums select-none';

/** Rows an opened fold reveals fade in; reduced motion shows them at once. */
const REVEAL =
  'animate-in fade-in duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:animate-none';

const ROW_BUTTON =
  'text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring flex min-h-7 w-full cursor-pointer items-center gap-2 px-2 text-left font-sans text-xs focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset';

const HUNK_HEADER =
  'bg-muted/50 text-muted-foreground focus:ring-ring px-2 py-0.5 font-sans text-xs focus:ring-2 focus:outline-none focus:ring-inset';

/** The cells across from a line the other side does not have. */
const FILLER =
  'bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_4px,transparent_4px_8px)]';

/** Shiki's font style bits as CSS: 1 italic, 2 bold, 4 underline. */
function segmentStyle(segment: CodeDiffSegment): CSSProperties | undefined {
  const bits = segment.fontStyle ?? 0;
  if (segment.color === undefined && bits === 0) return undefined;
  return {
    ...(segment.color === undefined ? {} : { color: segment.color }),
    ...(bits & 1 ? { fontStyle: 'italic' } : {}),
    ...(bits & 2 ? { fontWeight: 600 } : {}),
    ...(bits & 4 ? { textDecorationLine: 'underline' } : {}),
  };
}

/** A line's text in its highlight, its changed words as `<ins>` or
 *  `<del>` in the word tint — never underlined or struck through: the sign
 *  says what the line is. */
function LineText({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: CodeTokenLines | null;
}) {
  const number = line.kind === 'removed' ? line.before : line.after;
  const lineTokens =
    number === undefined ? undefined : (tokens?.[number - 1] ?? undefined);
  return lineSegments(line.text, lineTokens, line.words).map(
    (segment, index) => {
      const style = segmentStyle(segment);
      if (segment.changed && line.kind === 'added')
        return (
          <ins
            key={index}
            style={style}
            className="bg-diff-added-emphasis rounded-xs no-underline"
          >
            {segment.text}
          </ins>
        );
      if (segment.changed && line.kind === 'removed')
        return (
          <del
            key={index}
            style={style}
            className="bg-diff-removed-emphasis rounded-xs no-underline"
          >
            {segment.text}
          </del>
        );
      return (
        <span key={index} style={style}>
          {segment.text}
        </span>
      );
    },
  );
}

/** The 1-based lines a hunk spans in the text that has them: the newer
 *  one, else the older one (a hunk that only removes lines). */
function hunkRange(
  hunk: DiffHunk,
  labels: { before: string; after: string },
): { from: number; to: number; count: number; label: string } {
  const side =
    hunk.after.count > 0
      ? { range: hunk.after, label: labels.after }
      : { range: hunk.before, label: labels.before };
  return {
    from: side.range.start,
    to: side.range.start + side.range.count - 1,
    count: side.range.count,
    label: side.label,
  };
}

const CodeDiffView = forwardRef<CodeDiffHandle, CodeDiffProps>(
  function CodeDiffView(
    {
      before,
      after,
      language,
      templates = false,
      beforeLabel,
      afterLabel,
      layout: layoutProp = 'unified',
      onLayoutChange,
      context = DIFF_CONTEXT,
      wordDiff = true,
      lineNumbers = true,
      toolbar = true,
      maxHeight,
      emptyMessage,
      'aria-label': ariaLabel,
      className,
    },
    ref,
  ) {
    const { t } = useT('codeDiff');
    const reduced = usePrefersReducedMotion();
    const diff = useMemo(
      () => computeLineDiff(before, after, { context, words: wordDiff }),
      [before, after, context, wordDiff],
    );

    // Each whole text is highlighted once (a YAML block scalar only reads
    // as a string in its whole document), then its lines are looked up.
    const lang = shikiLanguageFor(language, templates);
    const [highlight, setHighlight] = useState<{
      before: string;
      after: string;
      lang: string;
      lines: { before: CodeTokenLines | null; after: CodeTokenLines | null };
    } | null>(null);
    useEffect(() => {
      if (before === after) return undefined;
      let live = true;
      Promise.all([tokenizeCode(before, lang), tokenizeCode(after, lang)])
        .then(([beforeLines, afterLines]) => {
          if (live)
            setHighlight({
              before,
              after,
              lang,
              lines: { before: beforeLines, after: afterLines },
            });
        })
        .catch((error: unknown) => {
          console.warn('[code-diff] the highlight did not load', error);
        });
      return () => {
        live = false;
      };
    }, [before, after, lang]);
    const highlighted =
      highlight !== null &&
      highlight.before === before &&
      highlight.after === after &&
      highlight.lang === lang
        ? highlight.lines
        : {
            before: peekCodeTokens(before, lang),
            after: peekCodeTokens(after, lang),
          };

    const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
    const [showAll, setShowAll] = useState(false);
    const [current, setCurrent] = useState<number | null>(null);
    // Another pair of texts starts with every fold closed, at no change.
    const [shownDiff, setShownDiff] = useState(diff);
    if (shownDiff !== diff) {
      setShownDiff(diff);
      setOpen(new Set());
      setShowAll(false);
      setCurrent(null);
    }
    const rows = useMemo(
      () => codeDiffRows(diff, { open, showAll }),
      [diff, open, showAll],
    );

    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    const [wide, setWide] = useState(false);
    useResizeObserver(root, (entry) => {
      setWide(entry.contentRect.width >= SPLIT_MIN_WIDTH);
    });
    const [ownLayout, setOwnLayout] = useState<CodeDiffLayout>(layoutProp);
    const requested = onLayoutChange === undefined ? ownLayout : layoutProp;
    const split = requested === 'split' && wide;
    const changeLayout = (next: CodeDiffLayout) => {
      setOwnLayout(next);
      onLayoutChange?.(next);
    };

    const [spoken, setSpoken] = useState({ text: '', serial: 0 });
    const say = useCallback((text: string) => {
      setSpoken((previous) => ({ text, serial: previous.serial + 1 }));
    }, []);

    const count = diff.hunks.length;
    const drawnHunks = useMemo(
      () =>
        new Set(rows.flatMap((row) => (row.type === 'hunk' ? [row.hunk] : []))),
      [rows],
    );
    const pendingFocus = useRef<number | null>(null);
    const focusChange = useCallback(
      (index: number) => {
        if (count === 0) return;
        const target = Math.min(Math.max(0, Math.floor(index)), count - 1);
        if (!drawnHunks.has(target)) setShowAll(true);
        setCurrent(target);
        pendingFocus.current = target;
        say(t('position', { index: target + 1, count }));
      },
      [count, drawnHunks, say, t],
    );
    // Once the hunk is on the page: focus its header, then bring it to the
    // middle of the view.
    useEffect(() => {
      const target = pendingFocus.current;
      if (target === null || root === null) return;
      const header = root.querySelector<HTMLElement>(
        `[data-diff-hunk="${target}"]`,
      );
      if (header === null) return;
      pendingFocus.current = null;
      header.focus({ preventScroll: true });
      header.scrollIntoView({
        block: 'center',
        behavior: reduced ? 'auto' : 'smooth',
      });
    });
    const nextChange = useCallback(() => {
      focusChange(current === null ? 0 : current + 1);
    }, [current, focusChange]);
    const previousChange = useCallback(() => {
      focusChange(current === null ? count - 1 : current - 1);
    }, [count, current, focusChange]);
    useImperativeHandle(
      ref,
      () => ({ nextChange, previousChange, focusChange }),
      [nextChange, previousChange, focusChange],
    );

    const { copied, copy } = useCopy();
    const copyPatch = () => {
      const { patch } = toUnifiedPatch(before, after, {
        from: beforeLabel,
        to: afterLabel,
        context,
        maxBytes: Number.POSITIVE_INFINITY,
      });
      void copy(patch).then((done) => {
        if (done) say(t('copied'));
      });
    };

    const toggleFold = (key: string) => {
      setOpen((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    // `[` and `]` step through the changes while the focus is anywhere in
    // the diff — a hunk's header, a fold, the toolbar. The keys reach the
    // diff from the control that has the focus; the diff itself is no
    // control, so it listens rather than taking a handler of its own.
    const keys = useRef({ nextChange, previousChange });
    keys.current = { nextChange, previousChange };
    useEffect(() => {
      if (root === null) return undefined;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === ']') {
          event.preventDefault();
          keys.current.nextChange();
        } else if (event.key === '[') {
          event.preventDefault();
          keys.current.previousChange();
        }
      };
      root.addEventListener('keydown', onKeyDown);
      return () => root.removeEventListener('keydown', onKeyDown);
    }, [root]);

    const announcer = (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-slot="code-diff-announcer"
      >
        {spoken.text === '' ? null : (
          <span key={spoken.serial}>{spoken.text}</span>
        )}
      </div>
    );

    if (diff.identical) {
      return (
        <div
          ref={setRoot}
          data-slot="code-diff"
          className={cn('min-w-0', className)}
        >
          <p className="text-muted-foreground text-sm">
            {emptyMessage ?? t('identical')}
          </p>
        </div>
      );
    }

    const labels = { before: beforeLabel, after: afterLabel };
    const columns = (lineNumbers ? 2 : 0) + (split ? 4 : 2);

    const sign = (line: DiffLine) => (
      <td
        className={cn(
          'w-6 text-center align-top select-none',
          TINT[line.kind],
          line.kind === 'added' && 'text-diff-added',
          line.kind === 'removed' && 'text-diff-removed',
          line.kind !== 'unchanged' && FORCED_EDGE,
        )}
      >
        <span aria-hidden="true">{SIGN[line.kind]}</span>
        <span className="sr-only">
          {line.kind === 'added'
            ? t('added')
            : line.kind === 'removed'
              ? t('removed')
              : t('unchanged')}
        </span>
      </td>
    );
    const text = (line: DiffLine) => (
      <td
        className={cn(
          'h-5 px-2 align-top [overflow-wrap:anywhere] whitespace-pre-wrap',
          TINT[line.kind],
        )}
      >
        <LineText
          line={line}
          tokens={
            line.kind === 'removed' ? highlighted.before : highlighted.after
          }
        />
      </td>
    );
    const filler = (key: string) => (
      <>
        {lineNumbers ? (
          <td key={`${key}-n`} aria-hidden="true" className={FILLER} />
        ) : null}
        <td key={`${key}-s`} aria-hidden="true" className={FILLER} />
        <td key={`${key}-t`} aria-hidden="true" className={FILLER} />
      </>
    );

    const fullRow = (key: string, cell: ReactNode) => (
      <tr key={key}>
        <td colSpan={columns} className="p-0">
          {cell}
        </td>
      </tr>
    );

    const body = (split ? splitRows(rows) : rows).map((row) => {
      switch (row.type) {
        case 'hunk': {
          const hunk = diff.hunks[row.hunk];
          if (hunk === undefined) return null;
          const range = hunkRange(hunk, labels);
          return (
            <tr key={row.key}>
              <td
                colSpan={columns}
                tabIndex={-1}
                data-diff-hunk={row.hunk}
                aria-current={current === row.hunk ? 'true' : undefined}
                className={HUNK_HEADER}
              >
                {t('hunk', range)}
              </td>
            </tr>
          );
        }
        case 'gap': {
          const lines = row.end - row.start;
          const Icon = row.open ? FoldVertical : UnfoldVertical;
          return fullRow(
            row.key,
            <button
              type="button"
              aria-expanded={row.open}
              onClick={() => toggleFold(row.key)}
              className={ROW_BUTTON}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              {t(row.open ? 'hideUnchanged' : 'showUnchanged', {
                count: lines,
              })}
            </button>,
          );
        }
        case 'rest':
          return fullRow(
            row.key,
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={ROW_BUTTON}
            >
              <UnfoldVertical
                aria-hidden="true"
                className="size-3.5 shrink-0"
              />
              {t('showRemaining', { count: row.remaining })}
            </button>,
          );
        case 'line':
          return (
            <tr
              key={row.key}
              data-diff-line={row.line.kind}
              className={cn(row.revealed && REVEAL)}
            >
              {lineNumbers ? (
                <>
                  <td className={GUTTER}>{row.line.before}</td>
                  <td className={GUTTER}>{row.line.after}</td>
                </>
              ) : null}
              {sign(row.line)}
              {text(row.line)}
            </tr>
          );
        case 'pair':
          return (
            <tr
              key={row.key}
              data-diff-pair=""
              className={cn(row.revealed && REVEAL)}
            >
              {row.left === undefined ? (
                filler(`${row.key}-left`)
              ) : (
                <>
                  {lineNumbers ? (
                    <td className={GUTTER}>{row.left.before}</td>
                  ) : null}
                  {sign(row.left)}
                  {text(row.left)}
                </>
              )}
              {row.right === undefined ? (
                filler(`${row.key}-right`)
              ) : (
                <>
                  {lineNumbers ? (
                    <td className={GUTTER}>{row.right.after}</td>
                  ) : null}
                  {sign(row.right)}
                  {text(row.right)}
                </>
              )}
            </tr>
          );
        default:
          return null;
      }
    });

    const headers = split
      ? [
          ...(lineNumbers ? [t('lineIn', { label: beforeLabel })] : []),
          t('change'),
          t('text'),
          ...(lineNumbers ? [t('lineIn', { label: afterLabel })] : []),
          t('change'),
          t('text'),
        ]
      : [
          ...(lineNumbers
            ? [
                t('lineIn', { label: beforeLabel }),
                t('lineIn', { label: afterLabel }),
              ]
            : []),
          t('change'),
          t('text'),
        ];

    const table = (
      <table
        data-layout={split ? 'split' : 'unified'}
        className="w-full table-fixed border-collapse font-mono text-sm leading-5 md:text-xs"
      >
        <caption className="sr-only">{ariaLabel}</caption>
        <colgroup>
          {split ? (
            <>
              {lineNumbers ? <col className="w-12" /> : null}
              <col className="w-6" />
              <col />
              {lineNumbers ? <col className="w-12" /> : null}
              <col className="w-6" />
              <col />
            </>
          ) : (
            <>
              {lineNumbers ? (
                <>
                  <col className="w-12" />
                  <col className="w-12" />
                </>
              ) : null}
              <col className="w-6" />
              <col />
            </>
          )}
        </colgroup>
        <thead className="sr-only">
          <tr>
            {headers.map((header, index) => (
              <th key={index} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    );

    return (
      <div
        ref={setRoot}
        role="group"
        aria-label={ariaLabel}
        data-slot="code-diff"
        className={cn('flex min-w-0 flex-col gap-2', className)}
      >
        {announcer}
        {toolbar ? (
          <div
            data-slot="code-diff-toolbar"
            className="flex flex-wrap items-center gap-1"
          >
            <span
              data-slot="code-diff-position"
              className="text-muted-foreground min-w-24 pr-1 text-xs tabular-nums"
            >
              {current === null
                ? t('changes', { count })
                : t('position', { index: current + 1, count })}
            </span>
            <IconButton
              icon={ChevronUp}
              size="sm"
              aria-label={t('previous')}
              onClick={previousChange}
            />
            <IconButton
              icon={ChevronDown}
              size="sm"
              aria-label={t('next')}
              onClick={nextChange}
            />
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {wide ? (
                <SegmentedControl
                  aria-label={t('layout.label')}
                  // A toolbar sizes the switch to its content: its segments
                  // keep their words on one line.
                  className="whitespace-nowrap"
                  value={requested}
                  onValueChange={(next) =>
                    changeLayout(next === 'split' ? 'split' : 'unified')
                  }
                  options={[
                    { value: 'unified', label: t('layout.unified') },
                    { value: 'split', label: t('layout.split') },
                  ]}
                />
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                icon={copied ? Check : Copy}
                collapseLabel
                onClick={copyPatch}
              >
                {t('copyPatch')}
              </Button>
            </span>
          </div>
        ) : null}
        {maxHeight === undefined ? (
          table
        ) : (
          // A bounded diff scrolls on its own: the region takes focus so a
          // keyboard can scroll it too.
          <div
            role="region"
            aria-label={ariaLabel}
            tabIndex={0}
            style={{ maxHeight }}
            className="focus-visible:ring-ring overflow-auto rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {table}
          </div>
        )}
      </div>
    );
  },
);

export default CodeDiffView;
