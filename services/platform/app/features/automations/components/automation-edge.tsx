'use client';

import type { EdgeProps } from '@xyflow/react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  getStraightPath,
} from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';

import type { FlowEdgeLabelVariant } from '@/app/components/flow/edge-palette';
import type { ElkPoint } from '@/app/components/flow/layout/elk-layout';
import { cn } from '@/lib/utils/cn';

const EMPTY_STYLE: CSSProperties = {};

/** AA-contrast badge treatments per branch semantic (edge-palette.ts): colored
 *  text + border on a solid background, so the badge masks the line behind it
 *  and stays legible in both themes. */
const LABEL_VARIANT_CLASSES: Record<FlowEdgeLabelVariant, string> = {
  positive: 'border-success text-success',
  negative: 'border-warning text-amber-700 dark:text-amber-300',
  neutral: 'border-muted-foreground/50 text-muted-foreground',
};

interface AutomationEdgeProps extends EdgeProps {
  type?: 'smoothstep' | 'bezier' | 'straight' | 'default';
  data?: {
    label?: string;
    /** Semantic treatment for the label badge (Yes / No / custom branch). */
    labelVariant?: FlowEdgeLabelVariant;
    // Smart label positioning options
    labelPosition?: 'center' | 'source' | 'target'; // Position along edge
    labelOffset?: { x: number; y: number }; // Manual offset from calculated position
    isBackwardConnection?: boolean; // For special handling of backward edges
    /** Absolute polyline computed by ELK's orthogonal router. When present the
     *  edge is drawn along it (clean right-angles) instead of a handle-derived
     *  path, so arrows trace each route without cutting through boxes. */
    elkPoints?: ElkPoint[];
  };
}

/** Drop points that lie on a straight run between their neighbours (and exact
 *  duplicates), so the only vertices left are real turns. Fewer, cleaner
 *  corners read as a smoother line. */
function simplifyCollinear(points: ElkPoint[], epsilon = 1): ElkPoint[] {
  if (points.length < 3) return points;
  const out: ElkPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    // Cross product of (b-a) × (c-a): ~0 means a, b, c are collinear.
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const duplicate = Math.hypot(b.x - a.x, b.y - a.y) < epsilon;
    if (Math.abs(cross) > epsilon && !duplicate) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Total length of a polyline (used to skip labels on very short edges). */
function polylineLength(points: ElkPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return total;
}

/** Connect two points. If they are (approximately) axis-aligned — a pure
 *  vertical or horizontal run — draw a plain straight line. Only when the
 *  endpoints are genuinely offset do we draw a smooth S, with vertical or
 *  horizontal tangents at the ends so it eases out of and into the boxes the
 *  way workflow engines do. The curve comes from the real offset, not an
 *  artificial bow. */
function gentleSCurve(a: ElkPoint, b: ElkPoint): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ALIGN_EPS = 6;
  // Truly (or almost) straight horizontally or vertically → a flat line.
  if (Math.abs(dx) <= ALIGN_EPS || Math.abs(dy) <= ALIGN_EPS) {
    return `M ${a.x},${a.y} L ${b.x},${b.y}`;
  }
  // Offset endpoints: ease perpendicular to the box edge the connection leaves.
  const verticalDominant = Math.abs(dy) >= Math.abs(dx);
  const cp1x = verticalDominant ? a.x : a.x + dx * 0.5;
  const cp1y = verticalDominant ? a.y + dy * 0.5 : a.y;
  const cp2x = verticalDominant ? b.x : b.x - dx * 0.5;
  const cp2y = verticalDominant ? b.y - dy * 0.5 : b.y;
  return `M ${a.x},${a.y} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${b.x},${b.y}`;
}

/** Build a path that keeps the straight runs straight but rounds every turn
 *  with a generous fillet — so the line is straight through the middle and
 *  curves where it leaves a box and bends toward the next. The radius is
 *  clamped to half the shorter adjacent segment so it never overshoots. A plain
 *  two-point connection becomes a gentle S so it still reads as a curve. */
function roundedOrthogonalPath(rawPoints: ElkPoint[], radius = 30): string {
  const points = simplifyCollinear(rawPoints);
  if (points.length < 2) return '';
  if (points.length === 2) {
    return gentleSCurve(points[0], points[1]);
  }
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    if (r < 0.5) {
      d += ` L ${curr.x},${curr.y}`;
      continue;
    }
    const inX = curr.x - ((curr.x - prev.x) / lenIn) * r;
    const inY = curr.y - ((curr.y - prev.y) / lenIn) * r;
    const outX = curr.x + ((next.x - curr.x) / lenOut) * r;
    const outY = curr.y + ((next.y - curr.y) / lenOut) * r;
    // Straight up to the fillet, a smooth quadratic through the corner, then
    // straight again — a curved transition, not a sharp angle.
    d += ` L ${inX},${inY} Q ${curr.x},${curr.y} ${outX},${outY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/** Point at the middle of a polyline by arc length — where the label sits. */
function midpointAlong(points: ElkPoint[]): ElkPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  let half = total / 2;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
    if (half <= seg) {
      const t = seg === 0 ? 0 : half / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    half -= seg;
  }
  return points[points.length - 1];
}

export function AutomationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = EMPTY_STYLE,
  markerEnd,
  data,
  type = 'smoothstep',
}: AutomationEdgeProps) {
  // Prefer ELK's orthogonal route when available: stitch the actual React Flow
  // handle endpoints to ELK's interior bend points so the line touches the box
  // exactly and follows the routed right-angle path between.
  const elkPoints = data?.elkPoints;
  const routedPoints = useMemo<ElkPoint[] | null>(() => {
    if (!elkPoints || elkPoints.length < 2) return null;
    const interior = elkPoints.slice(1, -1);
    return [
      { x: sourceX, y: sourceY },
      ...interior,
      { x: targetX, y: targetY },
    ];
  }, [elkPoints, sourceX, sourceY, targetX, targetY]);

  // Skip the Yes/No badge on very short connections, where it would overlap the
  // boxes it sits between. Non-routed (fallback) edges always keep their label.
  const showLabel = useMemo(() => {
    if (!routedPoints) return true;
    return polylineLength(routedPoints) >= 90;
  }, [routedPoints]);

  const [edgePath, defaultLabelX, defaultLabelY] = useMemo<
    [string, number, number]
  >(() => {
    if (routedPoints) {
      // Anchor a branch label (Yes/No) at the first turn — right where the path
      // leaves the decision — so the reader sees the outcome at the fork. Plain
      // connections keep their mid-route label.
      const anchor =
        data?.label && routedPoints.length > 2
          ? routedPoints[1]
          : midpointAlong(routedPoints);
      return [roundedOrthogonalPath(routedPoints), anchor.x, anchor.y];
    }
    const [path, lx, ly] =
      type === 'smoothstep' || type === 'default'
        ? getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
          })
        : type === 'straight'
          ? getStraightPath({ sourceX, sourceY, targetX, targetY })
          : getBezierPath({
              sourceX,
              sourceY,
              sourcePosition,
              targetX,
              targetY,
              targetPosition,
            });
    return [path, lx, ly];
  }, [
    routedPoints,
    data?.label,
    type,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  ]);

  const { labelX, labelY } = useMemo(() => {
    const labelPosition = data?.labelPosition || 'center';
    let lx = defaultLabelX;
    let ly = defaultLabelY;

    if (labelPosition === 'source') {
      lx = sourceX + (targetX - sourceX) * 0.25;
      ly = sourceY + (targetY - sourceY) * 0.25;
    } else if (labelPosition === 'target') {
      lx = sourceX + (targetX - sourceX) * 0.75;
      ly = sourceY + (targetY - sourceY) * 0.75;
    }

    if (data?.isBackwardConnection) {
      lx += 30;
    }

    if (data?.labelOffset?.x) {
      lx += data.labelOffset.x;
    }
    if (data?.labelOffset?.y) {
      ly += data.labelOffset.y;
    }

    return { labelX: lx, labelY: ly };
  }, [
    defaultLabelX,
    defaultLabelY,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data?.labelPosition,
    data?.isBackwardConnection,
    data?.labelOffset?.x,
    data?.labelOffset?.y,
  ]);

  return (
    <>
      <g>
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            strokeWidth: Number(style.strokeWidth) || 2,
            stroke: String(style.stroke ?? ''),
          }}
        />
      </g>
      <EdgeLabelRenderer>
        {/* Outline badge: background-filled with a colored border + text, so it
            masks the line behind it. Hidden on short edges to avoid overlap. */}
        {data?.label && showLabel && (
          <div
            className={cn(
              'pointer-events-none absolute rounded-md border bg-background px-1.5 text-[11px] leading-normal font-semibold whitespace-nowrap',
              LABEL_VARIANT_CLASSES[data.labelVariant ?? 'neutral'],
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: -1, // Below nodes (nodes are at z-index 0 or higher)
            }}
          >
            {data.label}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
