'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Handle, Position } from '@xyflow/react';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../../lib/cn';
import { ISSUE_SEVERITY_FRAME_CLASS } from '../../feedback/issue-severity';
import type { IssueCounts } from '../../feedback/issue-summary';
import { TooltipContent } from '../../overlays/tooltip';
import type { FlowCompareFace, FlowCompareSide } from '../compare/compare';
import { FLOW_MOTION_CLASS, FLOW_STRIP_SETTLE } from '../motion/flow-motion';
import { flowNodeIssueFrameClass } from '../node-issue-marker';
import { FLOW_NODE_STATE, type FlowNodeState } from '../node-status';
import { FLOW_NODE_DASHED } from './chrome';

/** How a box looks right now: its run state, and where it stands in a
 *  highlight. */
export interface FlowNodeLook {
  /** `idle` while no run is shown. */
  state: FlowNodeState;
  /** A condition's decision in the run shown. */
  decision?: boolean;
  /** Outside the highlight: dashed, on a muted surface, never faded. */
  quiet: boolean;
  /** Inside the highlight: lifted and ringed (`error`: in the error red). */
  highlighted: 'none' | 'default' | 'error';
  /** Two runs compared differ here: ringed, with a "Differs" glyph. */
  differs?: boolean;
  /** Not in one compared run's version: dashed. */
  absent?: boolean;
}

/** How a line looks right now. */
export interface FlowEdgeLook {
  look: 'base' | 'quiet' | 'emphasis' | 'travelled' | 'error';
  /** A Yes or No line in a run: whether the run took it. */
  taken?: boolean;
}

/** A part of the chart joining or leaving with a live relayout. */
export type FlowPhase = 'enter' | 'exit';

/**
 * What the chart hands every box: kept in context rather than in React
 * Flow's node data, so moving the selection or the focus re-renders the
 * boxes without rebuilding the node array React Flow lays out.
 */
export interface FlowRenderContextValue {
  /** Prefix for the ids of the hidden names and descriptions. */
  baseId: string;
  selectedId: string | null;
  /** The node that holds the chart's one Tab stop. */
  tabStopId: string | null;
  /** The region a node's button opens (an inspector), if the host has one. */
  controlsId?: string;
  issues: ReadonlyMap<string, IssueCounts>;
  names: ReadonlyMap<string, string>;
  descriptions: ReadonlyMap<string, string>;
  strips: ReadonlyMap<string, string>;
  /** Run state and highlight by node id; a node not listed is plain. */
  looks: ReadonlyMap<string, FlowNodeLook>;
  /** By edge id; a line not listed is plain. */
  edgeLooks: ReadonlyMap<string, FlowEdgeLook>;
  /** The counter on a frame's header in a run ("12 of 50 items"). */
  frameCounters: ReadonlyMap<string, string>;
  /** Strips settle softly when their words change (a run playing on). */
  stripSettle: boolean;
  /** Nodes that changed outside this tab, ringed once (by `key`). */
  ring: { ids: ReadonlySet<string>; key: string | number } | null;
  /** Yes and No labels highlight their paths under a pointer. */
  branchHover: boolean;
  /** A box's tooltip lines: how its run went, in full (one line per run
   *  compared). */
  explanations: ReadonlyMap<string, readonly string[]>;
  /** Two runs compared: their short names and what each box shows of
   *  each; `null` otherwise. */
  compare: {
    labels: { a: string; b: string };
    faces: ReadonlyMap<string, FlowCompareFace>;
  } | null;
  /** Pointer-hover words a line adds ("Only in A"), by edge id. */
  edgeNotes: ReadonlyMap<string, string>;
  onActivate: (id: string) => void;
  onKeyDown: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocusNode: (id: string, event: FocusEvent<HTMLButtonElement>) => void;
  onBlurNode: (id: string) => void;
  /** A pointer rests on a node (`id`) or left it (`null`). */
  onHoverNode: (id: string | null) => void;
  /** A pointer rests on a Yes or No label, or left it (`null`). */
  onHoverBranch: (branch: { gateId: string; decision: boolean } | null) => void;
}

const FlowRenderContext = createContext<FlowRenderContextValue | null>(null);

export const FlowRenderProvider = FlowRenderContext.Provider;

export function useFlowRender(): FlowRenderContextValue {
  const value = useContext(FlowRenderContext);
  if (value === null)
    throw new Error('A flow node must render inside <WorkflowCanvas>.');
  return value;
}

const NO_ISSUES: IssueCounts = { errors: 0, warnings: 0 };
const PLAIN: FlowNodeLook = {
  state: 'idle',
  quiet: false,
  highlighted: 'none',
};

/** The run states that mean "it did not run here": a dashed border. A
 *  reused node's result came from an earlier run. */
const PASSED_BY: ReadonlySet<FlowNodeState> = new Set([
  'skipped',
  'stopped',
  'not-run',
  'reused',
]);

/** The id of a node's hidden description. */
const flowDescriptionId = (baseId: string, nodeId: string) =>
  `${baseId}-description-${nodeId}`;

/**
 * Hover lifts a box: a `shadow-md` layer fades in over its resting shadow
 * (a shadow itself never animates).
 */
const FLOW_NODE_LIFT =
  'after:pointer-events-none after:absolute after:inset-[-1px] after:rounded-[inherit] after:opacity-0 after:shadow-md after:transition-opacity after:duration-[var(--duration-short)] after:ease-[var(--ease-out-quint)] hover:after:opacity-100';

/** Selection and keyboard focus draw the same ring; a problem keeps its own
 *  frame colour beside it. */
const FLOW_NODE_RING =
  'ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none';

/** The frame a run state draws round a box; colour is never animated. */
const RUN_FRAME: Partial<Record<FlowNodeState, string>> = {
  running: 'border-[hsl(var(--info-foreground))]',
  waiting: ISSUE_SEVERITY_FRAME_CLASS.warning,
  failed: 'border-destructive',
};

/**
 * The marks a run state adds inside a box: a running node's top bar
 * sweeping across (still under reduced motion), a waiting node's amber top
 * bar, a failed node's red left edge.
 */
function RunChrome({ state }: { state: FlowNodeState }) {
  if (state === 'running')
    return (
      <span
        aria-hidden="true"
        data-slot="flow-node-running"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-[inherit] bg-[hsl(var(--info-foreground)/0.3)]"
      >
        {/* A third of the track, fading out at both ends; under reduced
            motion it stands still and fills the track. */}
        <span
          className={cn(
            'block h-full w-1/3 bg-linear-to-r from-transparent via-[hsl(var(--info-foreground))] to-transparent',
            'motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-[hsl(var(--info-foreground))] motion-reduce:bg-none',
            FLOW_MOTION_CLASS.sweep,
          )}
        />
      </span>
    );
  if (state === 'waiting')
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-t-[inherit] bg-amber-600 dark:bg-amber-500"
      />
    );
  if (state === 'failed')
    return (
      <span
        aria-hidden="true"
        data-slot="flow-node-failed"
        className="bg-destructive pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-[inherit]"
      />
    );
  return null;
}

/** A tooltip's words: the host's lead, then one line per sentence;
 *  nothing when there are none. */
function NodeTooltipLines({
  lead,
  lines,
}: {
  lead: ReactNode;
  lines: readonly string[] | undefined;
}) {
  if (!lead && (lines === undefined || lines.length === 0)) return null;
  return (
    <span className="flex max-w-xs flex-col gap-0.5">
      {lead}
      {lines?.map((line) => (
        <span key={line} data-slot="flow-node-explanation">
          {line}
        </span>
      ))}
    </span>
  );
}

/**
 * The canonical tooltip round a box, always mounted: words that come and
 * go never swap the box's element. With nothing to say it opens to
 * nothing.
 */
function FlowNodeTooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      {content ? (
        <TooltipPrimitive.Portal>
          <TooltipContent collisionPadding={8}>{content}</TooltipContent>
        </TooltipPrimitive.Portal>
      ) : null}
    </TooltipPrimitive.Root>
  );
}

/**
 * A box on the chart: one real `<button>` (no control inside it), named and
 * described for a screen reader, holding the chart's roving Tab stop when it
 * is its turn. The handles are invisible stubs React Flow needs to attach
 * edges; every line is drawn from the layout's own routes.
 *
 * A run frames it by state, a highlight lifts it or steps it back (dashed
 * on a muted surface — its words never fade), and a live relayout grows it
 * in or shrinks it out (`phase`). A box on its way out is inert. Two runs
 * compared ring a box where they differ and dash one a run's version does
 * not have.
 *
 * A pointer resting on it reads its tooltip: the host's words (a gate's
 * full condition) and the run's explanation. The tooltip's frame is always
 * there, so a box whose explanation comes or goes while a run plays keeps
 * its element — and the keyboard focus on it.
 */
export function FlowNodeButton({
  id,
  className,
  children,
  dashed = false,
  tooltip,
  phase,
}: {
  id: string;
  className?: string;
  children: ReactNode;
  dashed?: boolean;
  /** Pointer-hover words (the full condition of a gate). */
  tooltip?: ReactNode;
  phase?: FlowPhase;
}) {
  const context = useFlowRender();
  const look = context.looks.get(id) ?? PLAIN;
  const leaving = phase === 'exit';
  const selected = !leaving && context.selectedId === id;
  const counts = context.issues.get(id) ?? NO_ISSUES;
  const descriptionId = flowDescriptionId(context.baseId, id);
  const disclosure = context.controlsId !== undefined;
  const ringing = !leaving && context.ring?.ids.has(id) === true;
  const button = (
    <button
      type="button"
      data-flow-node={leaving ? undefined : id}
      data-flow-leaving={leaving ? id : undefined}
      data-flow-state={look.state === 'idle' ? undefined : look.state}
      data-flow-quiet={look.quiet || undefined}
      data-flow-highlighted={
        look.highlighted === 'none' ? undefined : look.highlighted
      }
      data-flow-differs={look.differs || undefined}
      data-flow-absent={look.absent || undefined}
      tabIndex={!leaving && context.tabStopId === id ? 0 : -1}
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      aria-label={context.names.get(id)}
      aria-describedby={descriptionId}
      aria-pressed={disclosure ? undefined : selected}
      aria-expanded={disclosure ? selected : undefined}
      aria-controls={disclosure && selected ? context.controlsId : undefined}
      onClick={() => context.onActivate(id)}
      onKeyDown={(event) => context.onKeyDown(id, event)}
      onFocus={(event) => context.onFocusNode(id, event)}
      onBlur={() => context.onBlurNode(id)}
      onPointerEnter={() => context.onHoverNode(id)}
      onPointerLeave={() => context.onHoverNode(null)}
      className={cn(
        'relative block size-full cursor-pointer text-left',
        // The kind's own look (card, border, shape) comes first: every state
        // below overrides its border colour or surface, never the reverse.
        className,
        FLOW_NODE_LIFT,
        FLOW_NODE_RING,
        (dashed ||
          look.quiet ||
          look.absent === true ||
          PASSED_BY.has(look.state)) &&
          FLOW_NODE_DASHED,
        // The frame takes the worst problem's colour; the selection ring
        // stays its own, so a picked node with a problem shows both. A run
        // state's frame wins over a problem's.
        flowNodeIssueFrameClass(counts),
        RUN_FRAME[look.state],
        // Where two runs differ: a thin ring a highlight or the selection
        // draws over.
        look.differs === true && 'ring-1 ring-[hsl(var(--info-foreground))]',
        look.highlighted === 'default' && 'ring-foreground/20 shadow-md ring-1',
        look.highlighted === 'error' && 'ring-destructive shadow-md ring-2',
        selected && 'ring-ring ring-2 ring-offset-1',
        phase === 'enter' && FLOW_MOTION_CLASS.enter,
        leaving && FLOW_MOTION_CLASS.exit,
        look.quiet && 'bg-muted/40',
      )}
    >
      {children}
      <RunChrome state={look.state} />
      {ringing && context.ring && (
        <span
          key={context.ring.key}
          aria-hidden="true"
          data-slot="flow-node-changed"
          className={cn(
            'pointer-events-none absolute -inset-1 rounded-[inherit] opacity-0 ring-2 ring-[hsl(var(--info-foreground))]',
            FLOW_MOTION_CLASS.ring,
          )}
        />
      )}
    </button>
  );
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="pointer-events-none! invisible!"
      />
      <FlowNodeTooltip
        content={
          leaving ? null : (
            <NodeTooltipLines
              lead={tooltip}
              lines={context.explanations.get(id)}
            />
          )
        }
      >
        {button}
      </FlowNodeTooltip>
      {!leaving && (
        <span id={descriptionId} hidden>
          {context.descriptions.get(id)}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="pointer-events-none! invisible!"
      />
    </>
  );
}

/**
 * The line along a box's foot: what it reads, or in a run how it went
 * ("Failed · 1.2 s"), or why it steps back from a highlight. While a run
 * plays on, new words settle in softly; scrubbing back and reduced motion
 * swap them at once.
 */
export function FlowNodeStrip({ id }: { id: string }) {
  const { strips, stripSettle, compare } = useFlowRender();
  const text = strips.get(id) ?? '';
  const face = compare?.faces.get(id);
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(text);
  useLayoutEffect(() => {
    if (shown.current === text) return undefined;
    shown.current = text;
    const element = ref.current;
    if (
      !stripSettle ||
      element === null ||
      typeof element.animate !== 'function'
    )
      return undefined;
    const animation = element.animate(
      FLOW_STRIP_SETTLE.keyframes,
      FLOW_STRIP_SETTLE.options,
    );
    return () => animation.cancel();
  }, [text, stripSettle]);
  if (compare !== null && face !== undefined)
    return <FlowCompareStrip face={face} labels={compare.labels} />;
  return (
    <span
      data-slot="flow-node-strip"
      className="border-border text-muted-foreground flex h-7 shrink-0 items-center border-t px-3 text-xs"
    >
      <span ref={ref} className="truncate">
        {text}
      </span>
    </span>
  );
}

/** One run's side on a box's foot: its letter, its state's glyph and its
 *  words. */
function CompareSide({
  side,
  label,
  run,
}: {
  side: FlowCompareSide;
  label: string;
  run: 'a' | 'b';
}) {
  const { icon: Icon, iconClass } = FLOW_NODE_STATE[side.state];
  return (
    <span
      data-flow-compare-side={run}
      data-state={side.state}
      className="inline-flex min-w-0 shrink items-center gap-1"
    >
      <span className="text-foreground shrink-0 font-medium">{label}</span>
      <Icon aria-hidden="true" className={cn('size-3 shrink-0', iconClass)} />
      <span className="truncate">{side.text}</span>
    </span>
  );
}

/**
 * A box's foot when two runs are compared: "A ✓ 1.2 s · B ✕ Failed", or
 * the run whose version does not have it. The box's name and description
 * say the same in words.
 */
function FlowCompareStrip({
  face,
  labels,
}: {
  face: FlowCompareFace;
  labels: { a: string; b: string };
}) {
  return (
    <span
      data-slot="flow-node-strip"
      className="border-border text-muted-foreground flex h-7 shrink-0 items-center gap-1.5 overflow-hidden border-t px-3 text-xs"
    >
      {face.a && <CompareSide side={face.a} label={labels.a} run="a" />}
      {face.a && (face.b || face.absent) && <span aria-hidden="true">·</span>}
      {face.b && <CompareSide side={face.b} label={labels.b} run="b" />}
      {face.b && face.absent && <span aria-hidden="true">·</span>}
      {face.absent && (
        <span data-flow-compare-absent className="truncate">
          {face.absent}
        </span>
      )}
    </span>
  );
}
