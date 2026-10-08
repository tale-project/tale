'use client';

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
import { Tooltip } from '../../overlays/tooltip';
import { FLOW_MOTION_CLASS, FLOW_STRIP_SETTLE } from '../motion/flow-motion';
import { flowNodeIssueFrameClass } from '../node-issue-marker';
import type { FlowNodeState } from '../node-status';

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

/** The run states that mean "it did not run here": a dashed border. */
const PASSED_BY: ReadonlySet<FlowNodeState> = new Set([
  'skipped',
  'stopped',
  'not-run',
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
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-[inherit]"
      >
        <span
          className={cn(
            'block h-full w-full bg-[hsl(var(--info-foreground))] motion-reduce:animate-none',
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

/**
 * A box on the chart: one real `<button>` (no control inside it), named and
 * described for a screen reader, holding the chart's roving Tab stop when it
 * is its turn. The handles are invisible stubs React Flow needs to attach
 * edges; every line is drawn from the layout's own routes.
 *
 * A run frames it by state, a highlight lifts it or steps it back (dashed
 * on a muted surface — its words never fade), and a live relayout grows it
 * in or shrinks it out (`phase`). A box on its way out is inert.
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
        FLOW_NODE_LIFT,
        FLOW_NODE_RING,
        (dashed || look.quiet || PASSED_BY.has(look.state)) && 'border-dashed',
        // The frame takes the worst problem's colour; the selection ring
        // stays its own, so a picked node with a problem shows both. A run
        // state's frame wins over a problem's.
        flowNodeIssueFrameClass(counts),
        RUN_FRAME[look.state],
        look.highlighted === 'default' && 'ring-foreground/20 shadow-md ring-1',
        look.highlighted === 'error' && 'ring-destructive shadow-md ring-2',
        selected && 'ring-ring ring-2 ring-offset-1',
        phase === 'enter' && FLOW_MOTION_CLASS.enter,
        leaving && FLOW_MOTION_CLASS.exit,
        className,
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
      {tooltip && !leaving ? (
        <Tooltip content={tooltip}>{button}</Tooltip>
      ) : (
        button
      )}
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
  const { strips, stripSettle } = useFlowRender();
  const text = strips.get(id) ?? '';
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
