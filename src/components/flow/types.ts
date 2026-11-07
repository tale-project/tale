import type { ComponentType } from 'react';

/**
 * The graph a workflow canvas draws, and the layout it draws it at.
 *
 * A host turns its own document into a `FlowGraph` — plain data: nodes in
 * reading order, the edges between them, the frames around iterating nodes —
 * and the package lays it out, renders every node from that data and lets a
 * keyboard walk it. The graph never carries a position: where a node sits is
 * a pure function of the graph, so the same document always draws the same
 * picture and no one ever places a box by hand.
 */

/** An icon a node, row or chip shows: any component that takes a class. */
export type FlowIcon = ComponentType<{ className?: string }>;

export type FlowNodeKind = 'entry' | 'exit' | 'step' | 'gate';

interface FlowNodeBase {
  /** Unique in the graph. */
  id: string;
  kind: FlowNodeKind;
  /**
   * Extra sentences for the node's accessible description — what it returns,
   * what its chips and markers mean — in the host's words. The package adds
   * the node's position, its neighbours and what it reads.
   */
  description?: string;
}

/** A line in a node or in the List view: a trigger, an input field, an
 *  output row, an outcome. */
export interface FlowRow {
  id: string;
  icon?: FlowIcon;
  label: string;
  /** Muted text after a middle dot ("text · required"). */
  detail?: string;
  /** A muted second line ("Next Thu 9 Oct, 07:00"). Adds 16 px to the row. */
  note?: string;
  /** A short state word on the row's right ("Off"). */
  badge?: { label: string; tone: 'neutral' | 'warning' };
  /** Shows the label in the monospace face. */
  code?: boolean;
}

/** A short word on a step's face ("Continues on error"). */
export interface FlowChip {
  id: string;
  label: string;
  icon?: FlowIcon;
  tone?: 'neutral' | 'info' | 'warning' | 'error';
}

/** A glyph in a step's title row; `label` is its tooltip and its words for a
 *  screen reader. */
export interface FlowMarker {
  id: string;
  icon: FlowIcon;
  label: string;
  tone?: 'neutral' | 'warning';
}

/** One line of warning or information at the foot of Start or End. */
export interface FlowNotice {
  tone: 'warning' | 'info';
  text: string;
}

/** One unit of work. */
export interface FlowStepNode extends FlowNodeBase {
  kind: 'step';
  /** Visible name; also the start of the accessible name. */
  label: string;
  icon?: FlowIcon;
  /** What kind of step it is: "GitHub · List issues". */
  typeLabel?: string;
  /** What the step reads, for its strip, its description and the List view. */
  reads?: readonly FlowRow[];
  /** The strip's words when `reads` is empty ("Reads no other node"). */
  readsEmpty?: string;
  /**
   * What the step returns: a shape (`code`, shown in mono) or a sentence.
   * `null` reserves the row while the host still works it out; leave it
   * out for a step that has no row.
   */
  returns?: { text: string; code: boolean } | null;
  /** Two are shown, the rest as "+n"; put every chip's words in the
   *  description too. */
  chips?: readonly FlowChip[];
  /** Glyphs in the title row. */
  markers?: readonly FlowMarker[];
  /** It may be skipped: drawn with a dashed border. */
  conditional?: boolean;
  /** No run ever reaches it: dashed, with a "Never runs" chip. */
  unreachable?: boolean;
}

/** Start: how a run begins and what it receives. At most one per graph. */
export interface FlowEntryNode extends FlowNodeBase {
  kind: 'entry';
  /** The title; "Start" in the session's language when left out. */
  label?: string;
  /** What starts a run; at least one row. */
  triggers: readonly FlowRow[];
  /** The fields every run receives. */
  inputs: readonly FlowRow[];
  /** The words when `inputs` is empty; "No input" when left out. */
  inputsEmpty?: string;
  /** Shown at Start's foot in place of its strip's words, so it never
   *  changes the box's size. */
  notice?: FlowNotice;
}

/** End: what a run returns and how it can end. At most one per graph. */
export interface FlowExitNode extends FlowNodeBase {
  kind: 'exit';
  /** The title; "End" in the session's language when left out. */
  label?: string;
  outputs: readonly FlowRow[];
  /** The words when `outputs` is empty; "Returns nothing" when left out. */
  outputsEmpty?: string;
  /**
   * What a run returns in one line: a shape (a string, or `code`, shown in
   * mono) or a sentence. `null` reserves the row while the host still
   * works it out; leave it out for an End that has no row.
   */
  shape?: string | { text: string; code: boolean } | null;
  /** How a run ends: Succeeded, Failed, Stopped. */
  outcomes?: readonly FlowRow[];
  /** Shown at End's foot in place of its strip's words, so it never
   *  changes the box's size. */
  notice?: FlowNotice;
}

/** The condition in front of a step. `only-if` has one plain edge out;
 *  `if-else` has a Yes and a No edge. */
export interface FlowGateNode extends FlowNodeBase {
  kind: 'gate';
  /** The name of the step it guards, for its accessible name. */
  label: string;
  mode: 'only-if' | 'if-else';
  /** The condition in words, or the expression itself. */
  condition: string;
  /** `condition` is code: shown in mono. */
  conditionIsCode?: boolean;
  /** The key a path's decisions use for this gate. */
  decisionKey?: string;
}

export type FlowNode =
  | FlowStepNode
  | FlowEntryNode
  | FlowExitNode
  | FlowGateNode;

export type FlowEdgeKind =
  /** The target reads the source's output. */
  | 'data'
  /** The target only mentions the source in a condition or a repeat. */
  | 'order'
  /** An only-if gate to the step it guards. */
  | 'gate'
  /** An if/else gate to the step that runs when the condition holds. */
  | 'branch-yes'
  /** An if/else gate to the step that runs when it does not. */
  | 'branch-no'
  /** Start to a node that reads no other. */
  | 'entry'
  /** A node the result reads, to End. */
  | 'exit'
  /** A node nothing reads, to End. */
  | 'completion';

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  kind: FlowEdgeKind;
  /** Pointer-hover words ("Carries .issues"); say the same in a node's
   *  description for the keyboard. */
  detail?: string;
  /** Shapes the layout but is never drawn, followed or highlighted. */
  layoutOnly?: boolean;
}

/** A frame around the step(s) that run once per item (`each`) or repeat
 *  (`repeat`). Decoration: every member's description says it too. */
export interface FlowGroup {
  id: string;
  kind: 'each' | 'repeat';
  /** The header: "For each item of issues of Open issues". */
  label: string;
  /** Step ids, consecutive in a path (no path between two members leaves
   *  the frame). */
  members: readonly string[];
}

export interface FlowGraph {
  /** Reading order: the layout's model order and the List view's order. */
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  groups?: readonly FlowGroup[];
}

export interface FlowPoint {
  x: number;
  y: number;
}

export interface FlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the layout put everything, in flow coordinates (absolute). */
export interface FlowLayout {
  /** The graph shape, sizes and options this layout was computed for. */
  signature: string;
  nodes: Readonly<Record<string, FlowRect>>;
  groups: Readonly<Record<string, FlowRect & { header: FlowRect }>>;
  /** Every drawn edge's route, axis-aligned, and its label's box. */
  edges: Readonly<
    Record<string, { points: readonly FlowPoint[]; label?: FlowRect }>
  >;
  bounds: FlowRect;
  /** Rows top to bottom, each left to right: arrow keys walk them. */
  rows: readonly (readonly string[])[];
  /** Who laid it out: the worker, the main thread, or the one-column
   *  fallback when the layout engine failed. */
  engine: 'worker' | 'main' | 'fallback-column';
  /** How long the layout took. */
  ms: number;
}

export { validateFlowGraph } from './validate-graph';
