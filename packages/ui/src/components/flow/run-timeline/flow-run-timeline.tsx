'use client';

import {
  ChevronRight,
  Filter,
  Hourglass,
  Play,
  RefreshCw,
  Split,
  StepForward,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion';
import { useVirtualList } from '../../../hooks/use-virtual-list';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import type { FlowTranslate } from '../describe';
import { FLOW_EDGE_COLORS } from '../edge-palette';
import { FLOW_NODE_STATE, type FlowShownState } from '../node-status';
import { flowSpanStateAt, flowStateAt } from '../playback/derive-state';
import type {
  FlowFrameState,
  FlowNodeRunInfo,
  FlowNodeSpan,
  FlowPlaybackTimeline,
} from '../playback/types';
import type { FlowGraph, FlowIcon } from '../types';
import {
  FLOW_TIMELINE_CHILD_LIMIT,
  flowRowSpans,
  flowSpansByNode,
  flowTimelineLineId,
  flowTimelineLines,
  flowTimelineParentOf,
  flowTimelineRows,
  type FlowTimelineLine,
  type FlowTimelineRow,
} from './rows';

export interface FlowRunTimelineProps {
  /** The chart the run ran on: its names, kinds and conditions. */
  graph: FlowGraph;
  /** The timeline the canvas plays — the same one, so both say the same. */
  timeline: FlowPlaybackTimeline;
  /** The rows to list; `flowTimelineRows(graph, timeline)` when left out.
   *  Map that result to add an item's title or a row's trailing line. */
  rows?: readonly FlowTimelineRow[];
  /** The moment shown, in playback milliseconds. */
  t: number;
  /** Choosing a row moves the shared clock to where the row starts. */
  onSeek: (t: number) => void;
  /** The chosen row: a node's id, or an item's `flowTimelineItemId`. */
  selectedId?: string | null;
  onSelect?: (row: FlowTimelineRow) => void;
  /** A moment in words, for the axis: the run's real elapsed time. */
  formatTime: (t: number) => string;
  /** A row's duration in words, from real time; no durations when left
   *  out. */
  formatDuration?: (row: FlowTimelineRow) => string | undefined;
  /** The list's name; "Steps" in the session's language when left out. */
  'aria-label'?: string;
  /** The time bars: always, never, or — `auto` — when the view is at least
   *  32rem wide. Durations always show. @default 'auto' */
  showBars?: boolean | 'auto';
  /** A run still going: new rows join at the end, and the view follows
   *  them while it is scrolled to its bottom. @default timeline.live */
  live?: boolean;
  /** Give the view a bounded height: it scrolls itself, its axis stays
   *  on top, and a long list is windowed. */
  className?: string;
}

/** More lines than this are windowed: only those in view are mounted. */
const WINDOW_ABOVE = 200;
/** A line's height before it is measured (`min-h-9`). */
const LINE_HEIGHT = 36;
/** The axis row on top (`h-8`), above the first line. */
const AXIS_HEIGHT = 32;
/** How long a row that joins a live run keeps its entrance. */
const ENTER_MS = 400;

type BarsMode = 'auto' | 'on' | 'off';

/** The columns every line shares, so the bars and the cursor line up:
 *  disclosure · state and title · duration · bar. */
const GRID: Record<BarsMode, string> = {
  auto: 'grid-cols-[1rem_minmax(0,1fr)_4.5rem] @min-[32rem]:grid-cols-[1rem_minmax(0,1fr)_4.5rem_minmax(0,40%)]',
  on: 'grid-cols-[1rem_minmax(0,1fr)_4.5rem_minmax(0,40%)]',
  off: 'grid-cols-[1rem_minmax(0,1fr)_4.5rem]',
};
const BAR_CELL: Record<Exclude<BarsMode, 'off'>, string> = {
  auto: 'hidden @min-[32rem]:block',
  on: 'block',
};

type SegmentTone =
  | 'succeeded'
  | 'failed'
  | 'running'
  | 'waiting'
  | 'muted'
  | 'yes'
  | 'no';

/** A stretch on a row's bar, in percent of the timeline. A stretch with
 *  no length is a dot; `tick` draws a short upright line instead. */
interface Segment {
  from: number;
  to: number;
  tone: SegmentTone;
  tick?: boolean;
}

const SEGMENT_CLASS: Record<SegmentTone, string> = {
  succeeded: 'bg-[hsl(var(--success))]',
  failed: 'bg-destructive',
  running: 'bg-[hsl(var(--info-foreground))]',
  waiting:
    'text-amber-700 dark:text-amber-500 bg-[repeating-linear-gradient(135deg,currentColor_0_2px,transparent_2px_4px)] ring-1 ring-inset ring-current',
  muted: 'bg-muted-foreground',
  yes: '',
  no: '',
};

const OUTCOME_TONE: Record<FlowNodeSpan['outcome'], SegmentTone> = {
  succeeded: 'succeeded',
  failed: 'failed',
  waiting: 'waiting',
  skipped: 'muted',
  stopped: 'muted',
  'not-run': 'muted',
  reused: 'muted',
};

/** The stretches of a row's bar. */
function segmentsOf(
  line: FlowTimelineLine,
  byNode: ReadonlyMap<string, readonly FlowNodeSpan[]>,
  duration: number,
  live: boolean,
): Segment[] {
  if (line.kind === 'more') return [];
  const { row } = line;
  const share = (at: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (at / duration) * 100)) : 0;
  if (row.kind === 'decision')
    return [
      {
        from: share(row.start),
        to: share(row.start),
        tone: row.decision ? 'yes' : 'no',
      },
    ];
  if (row.kind === 'wait')
    return [
      {
        from: share(row.start),
        to: share(row.end ?? duration),
        tone: 'waiting',
      },
    ];
  if (row.kind === 'mark')
    return [
      {
        from: share(row.start),
        to: share(row.start),
        tone: 'muted',
        tick: true,
      },
    ];
  const spans = flowRowSpans(row, byNode);
  if (spans.length === 0)
    return [
      {
        from: share(row.start),
        to: share(row.start),
        tone: 'muted',
        tick: true,
      },
    ];
  return spans.map((span) => {
    const open = span.end === undefined;
    return {
      from: share(span.start),
      to: share(span.end ?? (live ? duration : span.start)),
      tone:
        open && span.outcome !== 'waiting'
          ? 'running'
          : OUTCOME_TONE[span.outcome],
    };
  });
}

/** A line that is not a node's work shows its kind's glyph once reached. */
type KindGlyph =
  | 'entry'
  | 'gate-only-if'
  | 'gate-if-else'
  | 'wait'
  | 'restart'
  | 'resume';

const KIND_GLYPHS: Record<KindGlyph, FlowIcon> = {
  entry: Play,
  'gate-only-if': Filter,
  'gate-if-else': Split,
  wait: Hourglass,
  restart: RefreshCw,
  resume: StepForward,
};

/** What a line says at `t`: its glyph, its spoken state, and the sentences
 *  that explain it. */
interface LineView {
  /** The state's glyph, unless the line shows its kind's. */
  state: FlowShownState;
  kind: KindGlyph | null;
  started: boolean;
  /** The state's word, for the name ("" when the row's own words say
   *  it). */
  word: string;
  info: FlowNodeRunInfo | null;
}

function viewOf(
  line: FlowTimelineLine,
  frame: FlowFrameState,
  byNode: ReadonlyMap<string, readonly FlowNodeSpan[]>,
  t: number,
  live: boolean,
  tr: FlowTranslate,
): LineView {
  const stateWord = (state: FlowShownState) =>
    tr(FLOW_NODE_STATE[state].labelKey);
  const pending: LineView = {
    state: 'pending',
    kind: null,
    started: false,
    word: stateWord('pending'),
    info: null,
  };
  /** A line that shows its kind's glyph once reached. */
  const reached = (
    kind: KindGlyph,
    word = '',
    info: FlowNodeRunInfo | null = null,
  ): LineView => ({
    state: 'succeeded',
    kind,
    started: true,
    word,
    info,
  });
  /** A line that shows how its work stands. */
  const working = (info: FlowNodeRunInfo | null | undefined): LineView => {
    const state = info?.state ?? 'idle';
    if (
      info === null ||
      info === undefined ||
      state === 'idle' ||
      state === 'pending'
    )
      return pending;
    return { state, kind: null, started: true, word: stateWord(state), info };
  };
  if (line.kind === 'more') return { ...pending, started: true, word: '' };
  const { row } = line;
  if (row.start > t && row.kind !== 'entry') return pending;
  switch (row.kind) {
    case 'entry':
      return reached('entry');
    case 'exit':
    case 'node':
      return working(frame.nodes[row.nodeId]);
    case 'item':
      return working(flowSpanStateAt(flowRowSpans(row, byNode), t, live));
    case 'decision':
      return reached(
        row.mode === 'if-else' ? 'gate-if-else' : 'gate-only-if',
        tr(row.decision ? 'state.decidedYes' : 'state.decidedNo'),
        frame.nodes[row.nodeId] ?? null,
      );
    case 'wait':
      return reached(
        'wait',
        row.end === undefined || t < row.end ? stateWord('waiting') : '',
      );
    default:
      return reached(row.mark);
  }
}

/** The words a line shows as its title. */
function titleOf(line: FlowTimelineLine, tr: FlowTranslate): string {
  if (line.kind === 'more')
    return tr('timeline.showAll', { count: line.count });
  const { row } = line;
  switch (row.kind) {
    case 'entry':
      return row.label ?? tr('node.entry');
    case 'exit':
      return row.label ?? tr('node.exit');
    case 'item':
      return (
        row.label ??
        (row.item !== undefined
          ? tr('timeline.item', { index: row.item + 1 })
          : tr('timeline.pass', { index: row.pass ?? 0 }))
      );
    case 'decision':
      return tr(row.mode === 'if-else' ? 'gate.ifElse' : 'gate.onlyIf');
    default:
      return row.label;
  }
}

/** The muted words after a line's title. */
function subtitleOf(line: FlowTimelineLine): {
  text: string;
  code: boolean;
} | null {
  if (line.kind === 'more') return null;
  const { row } = line;
  if (row.kind === 'node' && row.typeLabel)
    return { text: row.typeLabel, code: false };
  if (row.kind === 'decision')
    return { text: row.condition, code: row.conditionIsCode === true };
  if ((row.kind === 'entry' || row.kind === 'exit') && row.detail)
    return { text: row.detail, code: false };
  return null;
}

/** A line's accessible name: what it is, how it stands at `t`, how long it
 *  took, and which item of how many. */
function nameOf(
  line: FlowTimelineLine,
  view: LineView,
  duration: string | undefined,
  /** How many items or passes an item's node holds. */
  siblingsInAll: number | undefined,
  tr: FlowTranslate,
): string {
  if (line.kind === 'more') return titleOf(line, tr);
  const { row } = line;
  let label = titleOf(line, tr);
  const details: (string | undefined)[] = [];
  if (row.kind === 'decision')
    label = tr('gate.name', { node: row.guards, condition: row.condition });
  if ((row.kind === 'entry' || row.kind === 'exit') && row.detail)
    details.push(row.detail);
  if (row.kind !== 'exit' || !row.detail || !view.started)
    details.push(view.word);
  details.push(duration);
  if (row.kind === 'node' && view.info) {
    const { items, pass } = view.info;
    if (items?.total !== undefined)
      details.push(tr('group.items', { done: items.done, total: items.total }));
    else if (pass?.max !== undefined)
      details.push(tr('group.pass', { pass: pass.current, max: pass.max }));
  }
  if (row.kind === 'item') {
    const total = siblingsInAll;
    if (total !== undefined) {
      const of =
        row.item !== undefined
          ? tr('timeline.itemOf', { index: row.item + 1, total })
          : tr('timeline.passOf', { index: row.pass ?? 0, total });
      if (row.label === undefined) label = of;
      else details.push(of);
    }
  }
  const detail = details.filter((part) => part !== undefined && part !== '');
  return detail.length === 0
    ? label
    : tr('node.rowWithDetail', { label, detail: detail.join(', ') });
}

/** The sentences that explain a line at `t`: why it was skipped, how its
 *  condition decided, what failed — each once. */
function descriptionOf(view: LineView): string {
  const info = view.info;
  if (info === null || !view.started) return '';
  const parts = [info.reason, info.explanation].filter(
    (part): part is string => part !== undefined && part !== '',
  );
  return [...new Set(parts)].join(' ');
}

/** The chevron that shows or hides a node's items — for a pointer; the
 *  keyboard uses → and ←. */
function Disclosure({ open, label }: { open: boolean; label: string }) {
  return (
    <span
      aria-hidden="true"
      title={label}
      data-slot="flow-timeline-toggle"
      className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center rounded-sm"
    >
      <ChevronRight
        className={cn(
          'size-4 transition-transform duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:transition-none',
          open && 'rotate-90',
        )}
      />
    </span>
  );
}

function Bar({ segments }: { segments: readonly Segment[] }) {
  return (
    <span aria-hidden="true" className="relative mx-1 block h-3">
      {segments.map((segment, index) => {
        const tone =
          segment.tone === 'yes' || segment.tone === 'no'
            ? {
                backgroundColor:
                  FLOW_EDGE_COLORS[
                    segment.tone === 'yes' ? 'positive' : 'negative'
                  ],
              }
            : undefined;
        if (segment.tick)
          return (
            <span
              key={index}
              data-flow-bar={segment.tone}
              className={cn(
                'absolute top-0 h-3 w-0.5 -translate-x-1/2 rounded-full',
                SEGMENT_CLASS[segment.tone],
              )}
              style={{ left: `${segment.from}%`, ...tone }}
            />
          );
        if (segment.to <= segment.from)
          return (
            <span
              key={index}
              data-flow-bar={segment.tone}
              className={cn(
                'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                SEGMENT_CLASS[segment.tone],
              )}
              style={{ left: `${segment.from}%`, ...tone }}
            />
          );
        return (
          <span
            key={index}
            data-flow-bar={segment.tone}
            className={cn(
              'absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px]',
              SEGMENT_CLASS[segment.tone],
            )}
            style={{
              left: `${segment.from}%`,
              width: `max(2px, ${segment.to - segment.from}%)`,
              ...tone,
            }}
          />
        );
      })}
    </span>
  );
}

interface LineProps {
  lineId: string;
  index: number;
  level: 1 | 2;
  position: number;
  siblings: number;
  state: FlowShownState;
  kind: KindGlyph | null;
  title: string;
  subtitle: string | undefined;
  subtitleCode: boolean;
  name: string;
  description: string;
  descriptionId: string;
  duration: string | undefined;
  decision: boolean | undefined;
  expandable: boolean;
  expanded: boolean;
  toggleLabel: string;
  selected: boolean;
  tabbable: boolean;
  more: boolean;
  bars: BarsMode;
  segments: readonly Segment[];
  trailing: ReactNode;
  entering: boolean;
  measure: (element: HTMLLIElement | null) => void;
  onFocusCapture: FocusEventHandler<HTMLElement>;
  onBlurCapture: FocusEventHandler<HTMLElement>;
  onFocusLine: (id: string) => void;
}

const TimelineLine = memo(function TimelineLine({
  lineId,
  index,
  level,
  position,
  siblings,
  state,
  kind,
  title,
  subtitle,
  subtitleCode,
  name,
  description,
  descriptionId,
  duration,
  decision,
  expandable,
  expanded,
  toggleLabel,
  selected,
  tabbable,
  more,
  bars,
  segments,
  trailing,
  entering,
  measure,
  onFocusCapture,
  onBlurCapture,
  onFocusLine,
}: LineProps) {
  const { t: tr } = useT('flow');
  const trailingId = `${descriptionId}-trailing`;
  const describedBy = [
    description === '' ? null : descriptionId,
    trailing ? trailingId : null,
  ]
    .filter(Boolean)
    .join(' ');
  let icon: ReactNode = null;
  if (kind !== null) {
    const Glyph = KIND_GLYPHS[kind];
    icon = (
      <Glyph
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          kind === 'wait'
            ? 'text-amber-700 dark:text-amber-500'
            : 'text-muted-foreground',
        )}
      />
    );
  } else if (!more) {
    const { icon: Glyph, iconClass } = FLOW_NODE_STATE[state];
    icon = (
      <Glyph aria-hidden="true" className={cn('size-4 shrink-0', iconClass)} />
    );
  }
  return (
    <li
      ref={measure}
      data-index={index}
      role="treeitem"
      data-flow-timeline-line={lineId}
      data-flow-timeline-state={more ? undefined : (kind ?? state)}
      aria-level={level}
      aria-posinset={position}
      aria-setsize={siblings}
      aria-label={name}
      aria-describedby={describedBy === '' ? undefined : describedBy}
      aria-selected={more ? undefined : selected}
      aria-expanded={expandable ? expanded : undefined}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => onFocusLine(lineId)}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      className={cn(
        'grid min-h-9 cursor-pointer items-center gap-x-2 rounded-md px-2 py-1 text-left outline-none',
        GRID[bars],
        'hover:bg-muted/60',
        'ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1',
        selected && 'bg-muted ring-ring ring-2',
        entering && 'animate-row-enter motion-reduce:animate-none',
      )}
    >
      <span className="flex items-center justify-center">
        {expandable && <Disclosure open={expanded} label={toggleLabel} />}
      </span>
      <span
        className={cn(
          'flex min-w-0 flex-col justify-center',
          level === 2 && 'pl-5',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span
            className={cn(
              'min-w-0 shrink truncate text-sm',
              level === 1 && !more ? 'font-medium' : 'font-normal',
              more && 'text-muted-foreground',
            )}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className={cn(
                'text-muted-foreground min-w-0 flex-1 truncate text-xs',
                subtitleCode && 'font-mono',
              )}
            >
              {subtitle}
            </span>
          )}
        </span>
        {trailing ? (
          <span
            id={trailingId}
            className="text-muted-foreground truncate pl-6 text-xs"
          >
            {trailing}
          </span>
        ) : null}
      </span>
      <span className="text-muted-foreground truncate text-right text-xs tabular-nums">
        {decision === undefined ? (
          duration
        ) : (
          <span
            className="font-medium"
            style={{
              color: decision
                ? FLOW_EDGE_COLORS.positive
                : FLOW_EDGE_COLORS.negative,
            }}
          >
            {tr(decision ? 'branch.yes' : 'branch.no')}
          </span>
        )}
      </span>
      {bars !== 'off' && (
        <span data-slot="flow-timeline-bar" className={BAR_CELL[bars]}>
          <Bar segments={segments} />
        </span>
      )}
      {description !== '' && (
        <span id={descriptionId} hidden>
          {description}
        </span>
      )}
    </li>
  );
});

/**
 * A run's steps in time order — the Steps view, the text alternative to the
 * canvas and its scrubber, driven by the same timeline: Start, each node
 * where it started or was skipped, each condition where it decided, waits,
 * restarts and End. A node that ran once per item or repeated opens to its
 * items or passes (the first 20, then "Show all").
 *
 * Each line shows its state at the moment `t` (one not reached yet shows
 * the pending glyph — its words never fade), its duration, and on a view at
 * least 32rem wide a bar where it sits on the timeline, under an axis in
 * real time; a thin line marks `t` across the bars. Choosing a line selects
 * it and moves the clock to where it starts.
 *
 * It is a tree with one Tab stop: ↑ and ↓ move, Home and End jump, → opens
 * a node's items or goes into them, ← closes them or goes back to the node,
 * Enter or Space chooses. Each line's name says what it is, how it stands,
 * how long it took and which item of how many; its description says why.
 * More than 200 lines are windowed. On a live run, new lines join with a
 * short entrance (none under reduced motion) and the view follows them while
 * it is scrolled to its bottom.
 */
export function FlowRunTimeline({
  graph,
  timeline,
  rows: hostRows,
  t,
  onSeek,
  selectedId = null,
  onSelect,
  formatTime,
  formatDuration,
  'aria-label': ariaLabel,
  showBars = 'auto',
  live: liveProp,
  className,
}: FlowRunTimelineProps) {
  const { t: tr } = useT('flow');
  const baseId = useId();
  const helpId = `${baseId}-help`;
  const reduced = usePrefersReducedMotion();
  const live = liveProp ?? timeline.live === true;
  const bars: BarsMode = showBars === 'auto' ? 'auto' : showBars ? 'on' : 'off';
  const duration = Math.max(0, timeline.duration);

  const rows = useMemo(
    () => hostRows ?? flowTimelineRows(graph, timeline),
    [hostRows, graph, timeline],
  );
  const byNode = useMemo(() => flowSpansByNode(timeline), [timeline]);

  // Which nodes show their items, and which show all of them. An item
  // chosen elsewhere (the canvas, a failure's "Show step") opens its node,
  // past the first items if need be; the reader may close it again.
  const [open, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [all, setShowingAll] = useState<ReadonlySet<string>>(() => new Set());
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (selectedId !== openedFor) {
    setOpenedFor(selectedId);
    const owner =
      selectedId === null ? null : flowTimelineParentOf(rows, selectedId);
    if (owner !== null && !open.has(owner.parent.id))
      setExpanded(new Set([...open, owner.parent.id]));
    if (
      owner !== null &&
      owner.index >= FLOW_TIMELINE_CHILD_LIMIT &&
      !all.has(owner.parent.id)
    )
      setShowingAll(new Set([...all, owner.parent.id]));
  }
  const lines = useMemo(
    () => flowTimelineLines(rows, open, all),
    [rows, open, all],
  );
  const ids = useMemo(() => lines.map(flowTimelineLineId), [lines]);
  // How many items or passes each item's node holds in all.
  const totals = useMemo(() => {
    const byChild = new Map<string, number>();
    for (const row of rows)
      if (row.kind === 'node')
        for (const child of row.children ?? [])
          byChild.set(child.id, row.childrenTotal ?? row.children?.length ?? 0);
    return byChild;
  }, [rows]);

  // What never changes with `t`: each line's bar and its duration.
  const segments = useMemo(
    () => lines.map((line) => segmentsOf(line, byNode, duration, live)),
    [lines, byNode, duration, live],
  );
  const durations = useMemo(
    () =>
      lines.map((line) =>
        line.kind === 'row' ? formatDuration?.(line.row) : undefined,
      ),
    [lines, formatDuration],
  );

  // How each line stands at `t`: the canvas's own frame for nodes.
  const frame = useMemo(
    () => flowStateAt(graph, timeline, t),
    [graph, timeline, t],
  );

  // Rows that join a live run come in once; the first lines never do.
  const seen = useRef<Set<string> | null>(null);
  const entering = useRef(new Map<string, number>());
  const now = typeof performance === 'undefined' ? 0 : performance.now();
  if (seen.current === null) seen.current = new Set(ids);
  else
    for (const id of ids)
      if (!seen.current.has(id)) {
        seen.current.add(id);
        if (live && !reduced) entering.current.set(id, now);
      }

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabStop =
    [selectedId, focusedId].find(
      (id): id is string => id !== null && ids.includes(id),
    ) ??
    ids[0] ??
    null;

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const pins = useMemo(
    () =>
      [selectedId, focusedId]
        .map((id) => (id === null ? -1 : ids.indexOf(id)))
        .filter((index) => index >= 0),
    [ids, selectedId, focusedId],
  );
  const virtual = useVirtualList<HTMLDivElement, HTMLLIElement>({
    count: lines.length,
    getScrollElement: () => rootRef.current,
    getItemKey: (index) => ids[index] ?? index,
    estimateSize: () => LINE_HEIGHT,
    threshold: WINDOW_ABOVE,
    pinnedIndices: pins,
    scrollMargin: AXIS_HEIGHT,
  });
  const { scrollToIndex } = virtual;

  const lineElement = useCallback(
    (id: string) =>
      listRef.current?.querySelector<HTMLLIElement>(
        `[data-flow-timeline-line="${CSS.escape(id)}"]`,
      ) ?? null,
    [],
  );
  // Focus waits for a line a window has not mounted yet.
  const pendingFocus = useRef<string | null>(null);
  const focusLine = useCallback(
    (id: string) => {
      const element = lineElement(id);
      if (element !== null) {
        element.focus();
        return;
      }
      pendingFocus.current = id;
      const index = ids.indexOf(id);
      if (index >= 0) scrollToIndex(index, { align: 'auto' });
    },
    [ids, lineElement, scrollToIndex],
  );
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const element = lineElement(id);
    if (element === null) return;
    pendingFocus.current = null;
    element.focus();
  });

  // A selection made elsewhere (the canvas, a failure's "Show step") is
  // brought into view.
  const lastSelected = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    if (selectedId === null) return;
    const index = ids.indexOf(selectedId);
    if (index < 0) return;
    const element = lineElement(selectedId);
    if (element !== null) element.scrollIntoView({ block: 'nearest' });
    else scrollToIndex(index, { align: 'auto' });
  }, [selectedId, ids, lineElement, scrollToIndex]);

  // A live run grows at the end: the view follows while it is at its
  // bottom, and stays where the reader left it otherwise.
  const atBottom = useRef(true);
  const onScroll = () => {
    const root = rootRef.current;
    if (root === null) return;
    atBottom.current =
      root.scrollHeight - root.scrollTop - root.clientHeight <= LINE_HEIGHT / 2;
  };
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!live || root === null || !atBottom.current) return;
    root.scrollTop = root.scrollHeight;
  }, [live, lines.length]);

  const choose = useCallback(
    (line: FlowTimelineLine) => {
      if (line.kind === 'more') {
        setShowingAll((current) => new Set([...current, line.parentId]));
        // The line takes the place of the next item, which keeps the focus.
        const parent = rows.find((row) => row.id === line.parentId);
        const next =
          parent?.kind === 'node'
            ? parent.children?.[FLOW_TIMELINE_CHILD_LIMIT]?.id
            : undefined;
        if (next !== undefined) pendingFocus.current = next;
        return;
      }
      onSelect?.(line.row);
      onSeek(line.row.start);
    },
    [onSelect, onSeek, rows],
  );
  const toggle = useCallback((id: string, to?: boolean) => {
    setExpanded((current) => {
      const opened = to ?? !current.has(id);
      if (opened === current.has(id)) return current;
      const next = new Set(current);
      if (opened) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const indexOfEvent = (target: EventTarget | null): number => {
    const element =
      target instanceof Element
        ? target.closest<HTMLElement>('[data-flow-timeline-line]')
        : null;
    const id = element?.dataset.flowTimelineLine;
    return id === undefined ? -1 : ids.indexOf(id);
  };

  const onClick = (event: MouseEvent<HTMLOListElement>) => {
    const index = indexOfEvent(event.target);
    const line = lines[index];
    if (line === undefined) return;
    const onToggle =
      event.target instanceof Element &&
      event.target.closest('[data-slot="flow-timeline-toggle"]') !== null;
    if (onToggle && line.kind === 'row') toggle(line.row.id);
    else choose(line);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const index = indexOfEvent(event.target);
    const line = lines[index];
    if (line === undefined) return;
    const go = (to: number) => {
      const id = ids[Math.min(ids.length - 1, Math.max(0, to))];
      if (id !== undefined) focusLine(id);
    };
    const expandable =
      line.kind === 'row' &&
      line.row.kind === 'node' &&
      (line.row.children?.length ?? 0) > 0;
    const parentId =
      line.kind === 'more'
        ? line.parentId
        : line.kind === 'row'
          ? line.parentId
          : undefined;
    switch (event.key) {
      case 'ArrowDown':
        go(index + 1);
        break;
      case 'ArrowUp':
        go(index - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(ids.length - 1);
        break;
      case 'ArrowRight':
        if (!expandable || line.kind !== 'row') return;
        if (open.has(line.row.id)) go(index + 1);
        else toggle(line.row.id, true);
        break;
      case 'ArrowLeft':
        if (expandable && line.kind === 'row' && open.has(line.row.id))
          toggle(line.row.id, false);
        else if (parentId !== undefined) focusLine(parentId);
        else return;
        break;
      case 'Enter':
      case ' ':
        choose(line);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onFocusLine = useCallback((id: string) => setFocusedId(id), []);

  const pct =
    duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (rows.length === 0)
    return (
      <p className={cn('text-muted-foreground p-4 text-sm', className)}>
        {tr('timeline.empty')}
      </p>
    );

  return (
    <div
      ref={rootRef}
      onScroll={onScroll}
      data-slot="flow-run-timeline"
      className={cn(
        'bg-background @container relative flex min-h-0 flex-col overflow-y-auto',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'bg-background text-muted-foreground sticky top-0 z-10 grid h-8 shrink-0 items-center gap-x-2 border-b px-3 text-xs',
          GRID[bars],
        )}
      >
        <span />
        <span className="truncate font-medium">
          {tr('timeline.columns.step')}
        </span>
        <span className="truncate text-right font-medium">
          {tr('timeline.columns.duration')}
        </span>
        {bars !== 'off' && (
          <span className={cn('relative mx-1 h-4', BAR_CELL[bars])}>
            {ticks.map((share) => (
              <span
                key={share}
                data-flow-axis-tick={share}
                className={cn(
                  'absolute top-0 whitespace-nowrap tabular-nums',
                  share === 0
                    ? 'translate-x-0'
                    : share === 1
                      ? '-translate-x-full'
                      : '-translate-x-1/2',
                  (share === 0.25 || share === 0.75) &&
                    'hidden @min-[48rem]:inline',
                )}
                style={{ left: `${share * 100}%` }}
              >
                {formatTime(share * duration)}
              </span>
            ))}
          </span>
        )}
      </div>
      <span id={helpId} hidden>
        {tr('timeline.keyboardHelp')}
      </span>
      <div className="relative px-1 py-1">
        {bars !== 'off' && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 grid gap-x-2 px-3',
              GRID[bars],
            )}
          >
            <span />
            <span />
            <span />
            <span
              className={cn('relative mx-1 overflow-hidden', BAR_CELL[bars])}
            >
              <span
                data-slot="flow-timeline-cursor"
                className="absolute inset-y-0 left-0 w-[calc(100%-1px)]"
                style={{ transform: `translateX(${pct}%)` }}
              >
                <span className="bg-foreground/60 block h-full w-px" />
              </span>
            </span>
          </div>
        )}
        <ol
          ref={listRef}
          role="tree"
          aria-label={ariaLabel ?? tr('timeline.label')}
          aria-describedby={helpId}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className="relative flex flex-col"
        >
          {virtual.items.map((item) => {
            const line = lines[item.index];
            if (line === undefined) return null;
            const id = ids[item.index] ?? '';
            const view = viewOf(line, frame, byNode, t, live, tr);
            const expandable =
              line.kind === 'row' &&
              line.row.kind === 'node' &&
              (line.row.children?.length ?? 0) > 0;
            const enteredAt = entering.current.get(id);
            const subtitle = subtitleOf(line);
            return (
              <TimelineEntry key={id} paddingBefore={item.paddingBefore}>
                <TimelineLine
                  lineId={id}
                  index={item.index}
                  level={line.kind === 'more' ? 2 : line.level}
                  position={line.position}
                  siblings={line.siblings}
                  state={view.state}
                  kind={view.kind}
                  title={titleOf(line, tr)}
                  subtitle={subtitle?.text}
                  subtitleCode={subtitle?.code === true}
                  name={nameOf(
                    line,
                    view,
                    durations[item.index],
                    totals.get(id),
                    tr,
                  )}
                  description={descriptionOf(view)}
                  descriptionId={`${baseId}-description-${id}`}
                  duration={durations[item.index]}
                  decision={
                    line.kind === 'row' &&
                    line.row.kind === 'decision' &&
                    view.started
                      ? line.row.decision
                      : undefined
                  }
                  expandable={expandable}
                  expanded={expandable && open.has(id)}
                  toggleLabel={tr(
                    open.has(id) ? 'timeline.hideItems' : 'timeline.showItems',
                  )}
                  selected={id === selectedId}
                  tabbable={id === tabStop}
                  more={line.kind === 'more'}
                  bars={bars}
                  segments={segments[item.index] ?? []}
                  trailing={
                    line.kind === 'row' &&
                    (line.row.kind === 'node' || line.row.kind === 'item')
                      ? line.row.trailing
                      : undefined
                  }
                  entering={
                    enteredAt !== undefined && now - enteredAt < ENTER_MS
                  }
                  measure={virtual.measureElement}
                  onFocusCapture={virtual.onFocusCapture}
                  onBlurCapture={virtual.onBlurCapture}
                  onFocusLine={onFocusLine}
                />
              </TimelineEntry>
            );
          })}
          {virtual.paddingAfter > 0 && (
            <li aria-hidden="true" style={{ height: virtual.paddingAfter }} />
          )}
        </ol>
      </div>
    </div>
  );
}

/** A line, after the room a window leaves for the lines above it. */
function TimelineEntry({
  paddingBefore,
  children,
}: {
  paddingBefore: number;
  children: ReactNode;
}) {
  return (
    <>
      {paddingBefore > 0 && (
        <li aria-hidden="true" style={{ height: paddingBefore }} />
      )}
      {children}
    </>
  );
}
