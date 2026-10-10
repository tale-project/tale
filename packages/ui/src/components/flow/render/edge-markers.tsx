import {
  FLOW_EDGE_ARROW,
  FLOW_EDGE_COLORS,
  FLOW_EDGE_TONES,
  type FlowEdgeTone,
} from '../edge-palette';

/** The id of a canvas's arrowhead in `tone`. */
export const flowArrowId = (baseId: string, tone: FlowEdgeTone) =>
  `${baseId}-arrow-${tone}`;

/**
 * One closed arrowhead per edge colour, defined once per canvas: a tinted
 * edge ends in an arrow of its own tint. The arrow's base sits where the
 * stroke stops and its tip on the route's end point — the target box's
 * border — so the line never pokes through the tip.
 */
export function FlowEdgeMarkers({ baseId }: { baseId: string }) {
  const { length, width } = FLOW_EDGE_ARROW;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      <defs>
        {FLOW_EDGE_TONES.map((tone) => (
          <marker
            key={tone}
            id={flowArrowId(baseId, tone)}
            markerUnits="userSpaceOnUse"
            markerWidth={length}
            markerHeight={width}
            refX={0}
            refY={width / 2}
            orient="auto"
          >
            <path
              d={`M0 0 L${length} ${width / 2} L0 ${width} Z`}
              style={{ fill: FLOW_EDGE_COLORS[tone] }}
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
