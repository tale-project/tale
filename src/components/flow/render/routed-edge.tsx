'use client';

import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { Check, Minus } from 'lucide-react';
import { memo } from 'react';

import { cn } from '../../../lib/cn';
import {
  FLOW_EDGE_ARROW,
  FLOW_EDGE_COLORS,
  FLOW_EDGE_CORNER_RADIUS,
  FLOW_EDGE_STROKE,
  flowEdgeDash,
  flowEdgeTone,
  type FlowEdgeTone,
} from '../edge-palette';
import {
  pointAlongRoute,
  roundedOrthogonalPath,
  trimEnd,
} from '../layout/geometry';
import { FLOW_MOTION_CLASS } from '../motion/flow-motion';
import type { FlowEdge, FlowPoint, FlowRect } from '../types';
import { flowArrowId } from './edge-markers';
import {
  useFlowRender,
  type FlowEdgeLook,
  type FlowPhase,
} from './flow-render-context';

export interface FlowRoutedEdgeData extends Record<string, unknown> {
  edge: FlowEdge;
  points: readonly FlowPoint[];
  label?: { text: string; rect: FlowRect };
  /** Prefix of the canvas's arrowhead ids. */
  baseId: string;
  /** Joining or leaving with a live relayout. */
  phase?: FlowPhase;
}

/**
 * The SVG paths of a route: `full` along all of it (the pointer's), and
 * `stroke` stopping where the arrowhead's base sits — never cut back past
 * the last bend, so the arrow keeps pointing along the last segment (a
 * shorter last segment lets the tip end under the target box instead).
 */
export function flowEdgePaths(points: readonly FlowPoint[]): {
  full: string;
  stroke: string;
} {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  const last =
    end && before ? Math.hypot(end.x - before.x, end.y - before.y) : 0;
  const cut = Math.min(FLOW_EDGE_ARROW.length, Math.max(0, last - 1));
  return {
    full: roundedOrthogonalPath(points, FLOW_EDGE_CORNER_RADIUS),
    stroke: roundedOrthogonalPath(
      trimEnd(points, cut),
      FLOW_EDGE_CORNER_RADIUS,
    ),
  };
}

/** Pointer room round a line, wider than the line itself. */
const HIT_WIDTH = 12;

const PLAIN: FlowEdgeLook = { look: 'base' };

/** A line's own colour: its kind's, or, two versions compared, its
 *  change's — every line the change leaves alone in the plain line colour,
 *  a Yes or No too, so no hue reads as a change it is not. */
function toneOf(edge: FlowEdge, diff: FlowEdgeLook['diff']): FlowEdgeTone {
  if (diff === 'added' || diff === 'removed') return diff;
  if (diff === 'unchanged') return 'flow';
  return flowEdgeTone(edge.kind);
}

/** The colour and width of a line in a look. A line whose colour means
 *  something (a Yes or No, a change) keeps it when it stands out, so the
 *  meaning stays readable. */
function strokeOf(
  edge: FlowEdge,
  look: FlowEdgeLook['look'],
  diff: FlowEdgeLook['diff'],
): { tone: FlowEdgeTone; width: number } {
  const own = toneOf(edge, diff);
  const meaningful = own !== 'flow';
  switch (look) {
    case 'quiet':
      return { tone: own, width: FLOW_EDGE_STROKE.quiet };
    case 'emphasis':
      return {
        tone: meaningful ? own : 'emphasis',
        width: FLOW_EDGE_STROKE.emphasis,
      };
    case 'travelled':
      return {
        tone: meaningful ? own : 'emphasis',
        width: FLOW_EDGE_STROKE.base,
      };
    case 'error':
      return { tone: 'error', width: FLOW_EDGE_STROKE.base };
    default:
      return { tone: own, width: FLOW_EDGE_STROKE.base };
  }
}

const FADE =
  'transition-opacity duration-[var(--duration-short)] ease-[var(--ease-out-quint)]';

/** The sign on a line two versions compared added or removed: a 14 px
 *  pill at the middle of the route, a plus or a minus in the change's
 *  colour. A Yes or No line carries the sign in its own pill instead. */
function FlowEdgeSign({
  edge,
  diff,
  points,
}: {
  edge: FlowEdge;
  diff: 'added' | 'removed';
  points: readonly FlowPoint[];
}) {
  const middle = pointAlongRoute(points, 0.5);
  if (middle === null) return null;
  const color = FLOW_EDGE_COLORS[diff];
  return (
    <g
      aria-hidden="true"
      data-flow-edge-sign={edge.id}
      data-diff={diff}
      transform={`translate(${middle.x} ${middle.y})`}
    >
      {/* 14 px across, its 1.5 px ring included. */}
      <circle
        r={6.25}
        strokeWidth={1.5}
        style={{ fill: 'var(--color-background)', stroke: color }}
      />
      <path
        d={diff === 'added' ? 'M-3 0 H3 M0 -3 V3' : 'M-3 0 H3'}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        style={{ stroke: color }}
      />
    </g>
  );
}

/**
 * An edge drawn along the route the layout gave it — orthogonal, corners
 * rounded at 8 px — never along React Flow's own handle-to-handle curve,
 * which ignored the boxes in its way. The kind sets the line: a `data`
 * edge solid, `order` dashed, `completion` dotted, `branch-yes` green and
 * `branch-no` amber with a "Yes" / "No" pill at the layout's label box.
 *
 * A highlight or a run changes how it looks — thinner when it steps back,
 * thicker when it stands out, the emphasis colour once a run travelled it,
 * red into the node a run failed at — and the change crossfades two
 * stacked lines (colour and width never animate). Two runs compared stand
 * out on a line both took, step back from one neither took, and a line only
 * one took says "Only in A" — on its Yes or No pill, else when a pointer
 * rests on it. Two versions compared draw a line only one of them has in
 * its change's colour with a plus or a minus, every other line plain, and
 * a pointer resting on a changed line reads what became of it. Hidden from
 * assistive technology: the nodes say what the lines mean.
 */
export const FlowRoutedEdgeView = memo(function FlowRoutedEdgeView({
  data,
}: EdgeProps & { data: FlowRoutedEdgeData }) {
  const { edge, points, label, baseId, phase } = data;
  const context = useFlowRender();
  const leaving = phase === 'exit';
  const { look, taken, diff } = leaving
    ? PLAIN
    : (context.edgeLooks.get(edge.id) ?? PLAIN);
  const rest = strokeOf(edge, 'base', diff);
  const now = strokeOf(edge, look === 'base' ? 'quiet' : look, diff);
  const changed = diff === 'added' || diff === 'removed' ? diff : undefined;
  const dash = flowEdgeDash(edge.kind);
  const cap = edge.kind === 'completion' ? 'round' : 'butt';
  const { full, stroke } = flowEdgePaths(points);
  const branchGate =
    edge.kind === 'branch-yes' || edge.kind === 'branch-no'
      ? edge.source
      : null;
  // What a pointer resting on the line reads: the host's words, and in a
  // comparison which run alone took it.
  const note = leaving ? undefined : context.edgeNotes.get(edge.id);
  const hover = [edge.detail, note].filter(Boolean).join(' · ');
  const hoverable = branchGate !== null && context.branchHover && !leaving;
  return (
    <g
      data-flow-edge-group={leaving ? undefined : edge.id}
      data-flow-edge-leaving={leaving ? edge.id : undefined}
      className={cn(
        phase === 'enter' && FLOW_MOTION_CLASS.fadeIn,
        leaving && FLOW_MOTION_CLASS.fadeOut,
      )}
    >
      <path
        d={stroke}
        fill="none"
        data-flow-edge={leaving ? undefined : edge.id}
        data-kind={edge.kind}
        data-look={look}
        data-diff={diff}
        className={cn('react-flow__edge-path', FADE)}
        strokeWidth={rest.width}
        strokeDasharray={dash}
        strokeLinecap={cap}
        markerEnd={`url(#${flowArrowId(baseId, rest.tone)})`}
        style={{
          stroke: FLOW_EDGE_COLORS[rest.tone],
          opacity: look === 'base' ? 1 : 0,
        }}
      />
      <path
        d={stroke}
        fill="none"
        aria-hidden="true"
        data-flow-edge-state={leaving ? undefined : edge.id}
        className={FADE}
        strokeWidth={now.width}
        strokeDasharray={dash}
        strokeLinecap={cap}
        markerEnd={`url(#${flowArrowId(baseId, now.tone)})`}
        style={{
          stroke: FLOW_EDGE_COLORS[now.tone],
          opacity: look === 'base' ? 0 : 1,
        }}
      />
      {hover !== '' && !leaving && (
        <path
          d={full}
          fill="none"
          stroke="transparent"
          strokeWidth={HIT_WIDTH}
          data-flow-edge-note={note}
          style={{ pointerEvents: 'stroke' }}
        >
          <title>{hover}</title>
        </path>
      )}
      {changed !== undefined && label === undefined && (
        <FlowEdgeSign edge={edge} diff={changed} points={points} />
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            aria-hidden="true"
            data-flow-edge-label={leaving ? undefined : edge.id}
            data-taken={taken === undefined ? undefined : String(taken)}
            onPointerEnter={
              hoverable && branchGate !== null
                ? () =>
                    context.onHoverBranch({
                      gateId: branchGate,
                      decision: edge.kind === 'branch-yes',
                    })
                : undefined
            }
            onPointerLeave={
              hoverable ? () => context.onHoverBranch(null) : undefined
            }
            className={cn(
              'bg-background absolute flex items-center justify-center gap-0.5 rounded-full text-xs leading-4',
              hoverable ? 'nopan pointer-events-auto' : 'pointer-events-none',
              taken === false ? 'font-normal' : 'font-medium',
              phase === 'enter' && FLOW_MOTION_CLASS.fadeIn,
              leaving && FLOW_MOTION_CLASS.fadeOut,
            )}
            style={{
              width: label.rect.width,
              height: label.rect.height,
              transform: `translate(${label.rect.x}px, ${label.rect.y}px)`,
              color: FLOW_EDGE_COLORS[rest.tone],
            }}
          >
            {taken === true && <Check className="size-3 shrink-0" />}
            {taken === false && <Minus className="size-3 shrink-0" />}
            {label.text}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
});
