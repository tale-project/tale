'use client';

import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import {
  FLOW_EDGE_ARROW,
  FLOW_EDGE_COLORS,
  FLOW_EDGE_CORNER_RADIUS,
  FLOW_EDGE_STROKE,
  flowEdgeDash,
  flowEdgeTone,
} from '../edge-palette';
import { roundedOrthogonalPath, trimEnd } from '../layout/geometry';
import type { FlowEdge, FlowPoint, FlowRect } from '../types';
import { flowArrowId } from './edge-markers';

export interface FlowRoutedEdgeData extends Record<string, unknown> {
  edge: FlowEdge;
  points: readonly FlowPoint[];
  label?: { text: string; rect: FlowRect };
  /** Prefix of the canvas's arrowhead ids. */
  baseId: string;
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

/**
 * An edge drawn along the route the layout gave it — orthogonal, corners
 * rounded at 8 px — never along React Flow's own handle-to-handle curve,
 * which ignored the boxes in its way. The kind sets the line: a `data`
 * edge solid, `order` dashed, `completion` dotted, `branch-yes` green and
 * `branch-no` amber with a "Yes" / "No" pill at the layout's label box.
 * Hidden from assistive technology: the nodes say what the lines mean.
 */
export const FlowRoutedEdgeView = memo(function FlowRoutedEdgeView({
  data,
}: EdgeProps & { data: FlowRoutedEdgeData }) {
  const { edge, points, label, baseId } = data;
  const tone = flowEdgeTone(edge.kind);
  const color = FLOW_EDGE_COLORS[tone];
  const { full, stroke } = flowEdgePaths(points);
  return (
    <>
      <path
        d={stroke}
        fill="none"
        data-flow-edge={edge.id}
        data-kind={edge.kind}
        className="react-flow__edge-path"
        strokeWidth={FLOW_EDGE_STROKE.base}
        strokeDasharray={flowEdgeDash(edge.kind)}
        strokeLinecap={edge.kind === 'completion' ? 'round' : 'butt'}
        markerEnd={`url(#${flowArrowId(baseId, tone)})`}
        style={{ stroke: color }}
      />
      {edge.detail && (
        <path
          d={full}
          fill="none"
          stroke="transparent"
          strokeWidth={HIT_WIDTH}
          style={{ pointerEvents: 'stroke' }}
        >
          <title>{edge.detail}</title>
        </path>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            aria-hidden="true"
            data-flow-edge-label={edge.id}
            className="bg-background pointer-events-none absolute flex items-center justify-center rounded-full text-xs leading-4 font-medium"
            style={{
              width: label.rect.width,
              height: label.rect.height,
              transform: `translate(${label.rect.x}px, ${label.rect.y}px)`,
              color,
            }}
          >
            {label.text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
