import type {
  FlowEntryNode,
  FlowExitNode,
  FlowGateNode,
  FlowNode,
  FlowRow,
  FlowStepNode,
} from '../types';

/**
 * Every box's size, as a pure function of the graph's data.
 *
 * The layout reserves exactly these boxes and the renderer draws exactly
 * these boxes (a browser test measures each one), so a box never grows into
 * an edge. Nothing a canvas shows on top of a layout — a run's state, a
 * problem count, a highlight — changes a size, so none of it can move a box.
 * Every number sits on the 4-px grid.
 */

export const FLOW_NODE_WIDTH = 288;

/** Pieces every box is built from. */
export const FLOW_BOX = {
  padding: 12,
  titleRow: 20,
  typeRow: 16,
  returnsRow: 20,
  chipsRow: 28,
  strip: 28,
  sectionGap: 8,
  heading: 16,
  headingGap: 4,
  row: 20,
  note: 16,
  shape: 20,
  notice: 28,
} as const;

export const FLOW_GATE = {
  height: 40,
  minWidth: 160,
  maxWidth: FLOW_NODE_WIDTH,
  /** Padding, icon and gap around the condition, plus 8 px of slack. */
  chrome: 56,
} as const;

/** How many rows a Start or End section shows before "+n more". */
export const FLOW_SECTION_ROWS = {
  triggers: 3,
  inputs: 4,
  outputs: 4,
  outcomes: 4,
} as const;

/** Text the layout measures: the font of the gate's condition, a branch
 *  label and a frame header. */
export const FLOW_FONTS = {
  condition: '400 12px Inter',
  conditionCode:
    '400 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  label: '500 12px Inter',
} as const;

export type FlowFont = (typeof FLOW_FONTS)[keyof typeof FLOW_FONTS];

/** Measures a line of text in a font; returns its width in px. */
export type FlowTextMeasure = (text: string, font: FlowFont) => number;

const ceil4 = (value: number) => Math.ceil(value / 4) * 4;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * A width estimate for where nothing can measure text (a server, a test
 * without a canvas): Inter at 12 px averages under 7 px a character, a
 * monospace face 7.25 px. It errs wide, so a box is never too narrow.
 */
export const estimateFlowText: FlowTextMeasure = (text, font) =>
  text.length * (font === FLOW_FONTS.conditionCode ? 7.25 : 7);

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined;
const measured = new Map<string, number>();

/**
 * Measures with an offscreen canvas where there is one (every current
 * browser, and a worker), else estimates. Call {@link loadFlowFonts} first:
 * measured before Inter has loaded, the fallback face's widths would size
 * the boxes.
 */
export const measureFlowText: FlowTextMeasure = (text, font) => {
  if (measureContext === undefined) {
    measureContext =
      typeof OffscreenCanvas === 'undefined'
        ? null
        : new OffscreenCanvas(1, 1).getContext('2d');
  }
  if (measureContext === null) return estimateFlowText(text, font);
  const key = `${font}\u0000${text}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  measureContext.font = font;
  const width = measureContext.measureText(text).width;
  measured.set(key, width);
  return width;
};

/**
 * Waits (at most `timeout` ms) for the faces the layout measures, so a
 * label is measured in Inter rather than in the face standing in for it.
 * A font that never arrives only costs the wait: the layout then measures
 * what the page actually shows.
 */
export async function loadFlowFonts(timeout = 1_500): Promise<void> {
  if (typeof document === 'undefined' || document.fonts === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(FLOW_FONTS.condition),
        document.fonts.load(FLOW_FONTS.label),
      ]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeout);
      }),
    ]);
  } catch (error) {
    console.warn(
      'Flow layout could not load its fonts; measuring as shown',
      error,
    );
  } finally {
    clearTimeout(timer);
  }
}

function rowsHeight(rows: readonly FlowRow[], max: number): number {
  const shown = rows.length > max ? rows.slice(0, max - 1) : rows;
  const more = rows.length > max ? FLOW_BOX.row : 0;
  return (
    shown.reduce(
      (sum, row) => sum + FLOW_BOX.row + (row.note ? FLOW_BOX.note : 0),
      0,
    ) + more
  );
}

/** The rows a section shows and how many it folds into "+n more". */
export function visibleRows<T>(
  rows: readonly T[],
  max: number,
): { shown: readonly T[]; more: number } {
  if (rows.length <= max) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, max - 1), more: rows.length - (max - 1) };
}

/** One section of Start or End: a heading, then its rows (an empty
 *  section shows one line of words). */
function sectionHeight(rows: readonly FlowRow[], max: number): number {
  return (
    FLOW_BOX.sectionGap +
    FLOW_BOX.heading +
    FLOW_BOX.headingGap +
    (rows.length === 0 ? FLOW_BOX.row : rowsHeight(rows, max))
  );
}

const frame = (inner: number) =>
  FLOW_BOX.padding +
  FLOW_BOX.titleRow +
  inner +
  FLOW_BOX.padding +
  FLOW_BOX.strip;

function stepHeight(node: FlowStepNode): number {
  return frame(
    FLOW_BOX.typeRow +
      (node.returns !== undefined ? FLOW_BOX.returnsRow : 0) +
      ((node.chips?.length ?? 0) > 0 || node.unreachable === true
        ? FLOW_BOX.chipsRow
        : 0),
  );
}

function entryHeight(node: FlowEntryNode): number {
  return frame(
    (node.triggers.length > 0
      ? sectionHeight(node.triggers, FLOW_SECTION_ROWS.triggers)
      : 0) +
      sectionHeight(node.inputs, FLOW_SECTION_ROWS.inputs) +
      (node.notice ? FLOW_BOX.sectionGap + FLOW_BOX.notice : 0),
  );
}

function exitHeight(node: FlowExitNode): number {
  return frame(
    sectionHeight(node.outputs, FLOW_SECTION_ROWS.outputs) +
      (node.shape ? FLOW_BOX.shape : 0) +
      ((node.outcomes?.length ?? 0) > 0
        ? sectionHeight(node.outcomes ?? [], FLOW_SECTION_ROWS.outcomes)
        : 0) +
      (node.notice ? FLOW_BOX.sectionGap + FLOW_BOX.notice : 0),
  );
}

/** The gate pill's width: the condition plus its chrome, 160 to 288 px. */
export function flowGateWidth(
  node: FlowGateNode,
  measure: FlowTextMeasure = estimateFlowText,
): number {
  const font = node.conditionIsCode
    ? FLOW_FONTS.conditionCode
    : FLOW_FONTS.condition;
  return clamp(
    ceil4(measure(node.condition, font) + FLOW_GATE.chrome),
    FLOW_GATE.minWidth,
    FLOW_GATE.maxWidth,
  );
}

/** The size the layout reserves and the renderer draws for `node`. */
export function flowNodeSize(
  node: FlowNode,
  measure: FlowTextMeasure = estimateFlowText,
): { width: number; height: number } {
  if (node.kind === 'gate')
    return { width: flowGateWidth(node, measure), height: FLOW_GATE.height };
  const height =
    node.kind === 'step'
      ? stepHeight(node)
      : node.kind === 'entry'
        ? entryHeight(node)
        : exitHeight(node);
  return { width: FLOW_NODE_WIDTH, height };
}

/** A "Yes" / "No" pill: the word plus 8 px each side, 20 px high. */
export function flowEdgeLabelSize(
  text: string,
  measure: FlowTextMeasure = estimateFlowText,
): { width: number; height: number } {
  return { width: ceil4(measure(text, FLOW_FONTS.label) + 16), height: 20 };
}

/** A frame header: its icon, gap and words, 96 to 288 px wide. */
export function flowFrameHeaderSize(
  text: string,
  measure: FlowTextMeasure = estimateFlowText,
): { width: number; height: number } {
  return {
    width: clamp(
      ceil4(measure(text, FLOW_FONTS.label) + 28),
      96,
      FLOW_NODE_WIDTH,
    ),
    height: 24,
  };
}
