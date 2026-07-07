/**
 * The ONE edge visual language for React Flow canvases built on `FlowCanvas`
 * (the automations step editor today). Every edge encodes exactly one of these
 * documented meanings (#2370):
 *
 *  - `flow`     — nominal progression: the main spine between steps, including
 *                 a loop's exit toward the next step. Calm and neutral so the
 *                 eye follows the happy path; only decisions draw color.
 *  - `positive` — a decision's yes/true outcome (green = "the check passed").
 *  - `negative` — a decision's no/false outcome. Amber, **never red**: "No" is
 *                 a branch the author designed, not an error state.
 *  - `error`    — an explicit error/failure route out of a step. The only red
 *                 line on the canvas, reserved for genuine failure handling.
 *
 * Loop-back edges reuse the `flow` color but render dashed — the *shape*
 * encodes the cycle, so color keeps its one meaning.
 *
 * All values are semantic theme tokens (light + dark), never hex. Strokes and
 * arrowheads share one width/size so every edge carries the same arrow.
 */
export const FLOW_EDGE_COLORS = {
  flow: 'hsl(var(--muted-foreground))',
  positive: 'hsl(var(--success))',
  negative: 'hsl(var(--warning))',
  error: 'hsl(var(--destructive))',
} as const;

export type FlowEdgeSemantic = keyof typeof FLOW_EDGE_COLORS;

/** One stroke width for every edge on the canvas. */
export const FLOW_EDGE_STROKE_WIDTH = 2;

/** One arrowhead size for every edge on the canvas. */
export const FLOW_EDGE_MARKER_SIZE = 18;

/**
 * Which badge treatment an edge label gets. Kept semantic (not raw colors) so
 * the edge renderer can pick AA-contrast token classes per theme.
 */
export type FlowEdgeLabelVariant = 'positive' | 'negative' | 'neutral';
