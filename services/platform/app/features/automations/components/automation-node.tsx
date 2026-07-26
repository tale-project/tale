'use client';

import { Badge } from '@tale/ui/badge';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { createContext, useContext, useMemo } from 'react';

import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { controlFlowBadges, type DerivedEdge } from '../lib/graph';
import type { NodeRunStatus } from '../lib/run-view';
import { RunStatusBadge } from './run-status-badge';

/**
 * What the canvas hands every node box. Kept in context rather than in React
 * Flow's `data` so that selecting a node, or a run's overlay ticking forward,
 * does not rewrite the node array and re-run the layout.
 */
export interface CanvasNodeContextValue {
  selectedNodeId: string | null;
  /** Id of the region the node's button expands — the inspector. */
  inspectorId: string;
  onSelect: (nodeId: string) => void;
  /** Called when a node box takes focus, so the viewport can bring it into
   * view for a keyboard user who cannot pan with a pointer. */
  onFocusNode: (nodeId: string) => void;
  /** Overlay status per node, when a run is shown on the canvas. */
  runStatusByNode: ReadonlyMap<string, NodeRunStatus>;
  /** How many review notes each node carries. */
  reviewCountByNode: ReadonlyMap<string, number>;
  /** The derived incoming edges, by target node. */
  incomingByNode: ReadonlyMap<string, DerivedEdge[]>;
}

const CanvasNodeContext = createContext<CanvasNodeContextValue | null>(null);

export const CanvasNodeProvider = CanvasNodeContext.Provider;

function useCanvasNode(): CanvasNodeContextValue {
  const value = useContext(CanvasNodeContext);
  if (!value) {
    throw new Error('A canvas node must render inside <CanvasNodeProvider>.');
  }
  return value;
}

/** The node payload React Flow carries for one document node. */
export interface AutomationNodeData extends Record<string, unknown> {
  node: NodeDef;
}

/** Node ids are `^[a-z][a-z0-9_]{0,49}$` — readable, but underscored. */
function humanizeNodeId(id: string): string {
  return id.replaceAll('_', ' ');
}

export interface AutomationNodeBoxProps {
  node: NodeDef;
  selected: boolean;
  /** Id of the region this box expands — the inspector. */
  inspectorId: string;
  /** Node ids this node reads from, derived from its references. */
  sources: readonly string[];
  runStatus?: NodeRunStatus | undefined;
  reviewCount?: number;
  onSelect: () => void;
  onFocus?: () => void;
}

/**
 * One node box on the canvas.
 *
 * The box IS a button: React Flow's own focus handling is switched off on this
 * canvas, so every node is reachable with Tab in the order the document
 * executes, activates with Enter or Space, and expands the inspector — a canvas
 * that needs a pointer is not usable at all for a keyboard user.
 *
 * What the box shows is what the engine will do: the node's id and type, its
 * declarative control flow as badges, the nodes it reads from (spelled out in
 * words, so the graph is readable without seeing the lines at all), its status
 * under the run being overlaid, and whether a conversion flagged it for review.
 */
export function AutomationNodeBox({
  node,
  selected,
  inspectorId,
  sources,
  runStatus,
  reviewCount = 0,
  onSelect,
  onFocus,
}: AutomationNodeBoxProps) {
  const { t } = useT('automations');
  const badges = useMemo(() => controlFlowBadges(node), [node]);

  const badgeLabel = (kind: string, value: string, maxRepeats?: number) =>
    maxRepeats === undefined
      ? t(`canvas.controlFlow.${kind}`, { value })
      : t('canvas.controlFlow.repeatUntilCapped', { value, maxRepeats });

  return (
    <button
      type="button"
      aria-expanded={selected}
      aria-controls={inspectorId}
      onClick={onSelect}
      onFocus={(event) => {
        // A mouse press focuses the button too, and panning then would drag
        // the box out from under the pointer mid-click — follow keyboard
        // focus only.
        if (event.currentTarget.matches(':focus-visible')) onFocus?.();
      }}
      className={cn(
        'bg-card text-card-foreground border-border w-[18.75rem] rounded-lg border p-3 text-left shadow-sm transition-shadow',
        'focus-visible:ring-ring cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
        selected && 'ring-ring ring-2',
        reviewCount > 0 && 'border-warning border-l-4',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {humanizeNodeId(node.id)}
        </span>
        <Badge variant="slate">{node.type}</Badge>
      </span>

      {sources.length > 0 && (
        <span className="text-muted-foreground mt-1 block truncate text-xs">
          {t('canvas.readsFrom', {
            nodes: sources.map(humanizeNodeId).join(', '),
            count: sources.length,
          })}
        </span>
      )}

      {(badges.length > 0 || runStatus !== undefined || reviewCount > 0) && (
        <span className="mt-2 flex flex-wrap items-center gap-1">
          {runStatus !== undefined && <RunStatusBadge status={runStatus} />}
          {reviewCount > 0 && (
            <Badge variant="yellow" icon={AlertTriangle}>
              {t('review.nodeBadge', { count: reviewCount })}
            </Badge>
          )}
          {badges.map((badge) => (
            <Badge key={badge.kind} variant="blue">
              {badgeLabel(badge.kind, badge.value, badge.maxRepeats)}
            </Badge>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * The React Flow adapter: it supplies the handles the derived edges attach to
 * and nothing else. The handles are never interactive — an edge exists because
 * one node references another, not because someone dragged a wire.
 */
export function AutomationNode({ data }: NodeProps) {
  const {
    selectedNodeId,
    inspectorId,
    onSelect,
    onFocusNode,
    runStatusByNode,
    reviewCountByNode,
    incomingByNode,
  } = useCanvasNode();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the canvas builds every node's data itself
  const { node } = data as AutomationNodeData;
  const sources = (incomingByNode.get(node.id) ?? []).map(
    (edge) => edge.source,
  );

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!size-1 !border-0 !bg-transparent"
        aria-hidden
      />
      <AutomationNodeBox
        node={node}
        selected={selectedNodeId === node.id}
        inspectorId={inspectorId}
        sources={sources}
        runStatus={runStatusByNode.get(node.id)}
        reviewCount={reviewCountByNode.get(node.id) ?? 0}
        onSelect={() => {
          onSelect(node.id);
        }}
        onFocus={() => {
          onFocusNode(node.id);
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!size-1 !border-0 !bg-transparent"
        aria-hidden
      />
    </div>
  );
}
