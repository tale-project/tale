'use client';

import { Handle, Position } from '@xyflow/react';
import {
  createContext,
  useContext,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../../lib/cn';
import type { IssueCounts } from '../../feedback/issue-summary';
import { Tooltip } from '../../overlays/tooltip';
import { flowNodeIssueFrameClass } from '../node-issue-marker';

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
  onActivate: (id: string) => void;
  onKeyDown: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocusNode: (id: string, event: FocusEvent<HTMLButtonElement>) => void;
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

/**
 * A box on the chart: one real `<button>` (no control inside it), named and
 * described for a screen reader, holding the chart's roving Tab stop when it
 * is its turn. The handles are invisible stubs React Flow needs to attach
 * edges; every line is drawn from the layout's own routes.
 */
export function FlowNodeButton({
  id,
  className,
  children,
  dashed = false,
  tooltip,
}: {
  id: string;
  className?: string;
  children: ReactNode;
  dashed?: boolean;
  /** Pointer-hover words (the full condition of a gate). */
  tooltip?: ReactNode;
}) {
  const context = useFlowRender();
  const selected = context.selectedId === id;
  const counts = context.issues.get(id) ?? NO_ISSUES;
  const descriptionId = flowDescriptionId(context.baseId, id);
  const disclosure = context.controlsId !== undefined;
  const button = (
    <button
      type="button"
      data-flow-node={id}
      tabIndex={context.tabStopId === id ? 0 : -1}
      aria-label={context.names.get(id)}
      aria-describedby={descriptionId}
      aria-pressed={disclosure ? undefined : selected}
      aria-expanded={disclosure ? selected : undefined}
      aria-controls={disclosure && selected ? context.controlsId : undefined}
      onClick={() => context.onActivate(id)}
      onKeyDown={(event) => context.onKeyDown(id, event)}
      onFocus={(event) => context.onFocusNode(id, event)}
      className={cn(
        'relative block size-full cursor-pointer text-left',
        FLOW_NODE_LIFT,
        FLOW_NODE_RING,
        dashed && 'border-dashed',
        // The frame takes the worst problem's colour; the selection ring
        // stays its own, so a picked node with a problem shows both.
        flowNodeIssueFrameClass(counts),
        selected && 'ring-ring ring-2 ring-offset-1',
        className,
      )}
    >
      {children}
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
      {tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button}
      <span id={descriptionId} hidden>
        {context.descriptions.get(id)}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="pointer-events-none! invisible!"
      />
    </>
  );
}

/** The line along a box's foot: what it reads, or (in a run) how it went. */
export function FlowNodeStrip({ id }: { id: string }) {
  const { strips } = useFlowRender();
  const text = strips.get(id) ?? '';
  return (
    <span
      data-slot="flow-node-strip"
      className="border-border text-muted-foreground flex h-7 shrink-0 items-center border-t px-3 text-xs"
    >
      <span className="truncate">{text}</span>
    </span>
  );
}
