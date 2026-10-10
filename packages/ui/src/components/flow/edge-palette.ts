import type { FlowEdgeKind } from './types';

/**
 * The ONE edge visual language for React Flow canvases built on `FlowCanvas`
 * (the automations editor and run page). Every edge encodes exactly one of
 * these documented meanings (#2370):
 *
 *  - `flow`     — nominal progression: the spine between steps. Calm and
 *                 neutral so the eye follows the happy path; only decisions
 *                 draw colour.
 *  - `positive` — a decision's yes/true outcome (green = "the check passed").
 *  - `negative` — a decision's no/false outcome. Amber, **never red**: "No" is
 *                 a branch the author designed, not an error state. Its own
 *                 variable (`--flow-edge-negative`): the warning amber is
 *                 2.2:1 on white, too faint for a line, so light mode takes
 *                 amber-700.
 *  - `error`    — the way into a step that failed. The only red line.
 *  - `emphasis` — a highlighted or travelled edge.
 *  - `activity` — something moving or running right now.
 *  - `added` / `removed` — comparing two versions: a line only the newer
 *                 or only the older one draws (`--diff-added`,
 *                 `--diff-removed`). Every other line is `flow` then, the
 *                 branches too, so no hue reads as a change it is not.
 *
 * Shape carries the rest: an `order` edge is dashed, a `completion` edge
 * dotted, so colour keeps its one meaning and never speaks alone. All values
 * are semantic theme tokens (light + dark), never hex, and each keeps 3:1
 * on the canvas in both themes.
 */
export const FLOW_EDGE_COLORS = {
  flow: 'hsl(var(--muted-foreground))',
  positive: 'hsl(var(--success))',
  negative: 'var(--flow-edge-negative)',
  error: 'hsl(var(--destructive))',
  emphasis: 'hsl(var(--foreground))',
  activity: 'hsl(var(--info-foreground))',
  added: 'var(--diff-added)',
  removed: 'var(--diff-removed)',
} as const;

export type FlowEdgeTone = keyof typeof FLOW_EDGE_COLORS;

/** Every edge colour, for what draws one of each (arrowheads, a legend). */
export const FLOW_EDGE_TONES: readonly FlowEdgeTone[] = [
  'flow',
  'positive',
  'negative',
  'error',
  'emphasis',
  'activity',
  'added',
  'removed',
];

/** One stroke width for every edge at rest. */
export const FLOW_EDGE_STROKE_WIDTH = 2;

/** Stroke widths per state: quiet (outside a highlight), base, emphasis. */
export const FLOW_EDGE_STROKE = { quiet: 1, base: 2, emphasis: 2.5 } as const;

/** Dash patterns per edge kind; a kind not listed is solid. */
export const FLOW_EDGE_DASH = { order: '6 4', completion: '1 4' } as const;

/** One arrowhead size for React Flow's built-in markers. */
export const FLOW_EDGE_MARKER_SIZE = 18;

/** The arrowhead `WorkflowCanvas` draws: its length along the edge and its
 *  width across it, in flow pixels. */
export const FLOW_EDGE_ARROW = { length: 8, width: 10 } as const;

/** The radius of an orthogonal route's rounded corners. */
export const FLOW_EDGE_CORNER_RADIUS = 8;

/** The colour an edge of this kind is drawn in at rest. */
export function flowEdgeTone(kind: FlowEdgeKind): FlowEdgeTone {
  if (kind === 'branch-yes') return 'positive';
  if (kind === 'branch-no') return 'negative';
  return 'flow';
}

/** The dash pattern of an edge of this kind, or `undefined` for solid. */
export function flowEdgeDash(kind: FlowEdgeKind): string | undefined {
  if (kind === 'order') return FLOW_EDGE_DASH.order;
  if (kind === 'completion') return FLOW_EDGE_DASH.completion;
  return undefined;
}
