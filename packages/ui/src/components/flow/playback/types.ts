import type { FlowNodeState } from '../node-status';

/**
 * A run on a workflow chart, two ways: an overlay (where each node stands,
 * no time) and a playback timeline (when each node ran and when each value
 * moved, scrubbed by the host's `t`). The canvas derives one frame state
 * from either and draws it the same way.
 *
 * Playback times are milliseconds of playback, not of the run:
 * `buildPlaybackTimeline` compresses a run's real moments into a timeline
 * a reader can follow, and maps back to real time for the clock.
 */

/** Where one node stands in a run. */
export interface FlowNodeRunInfo {
  state: FlowNodeState;
  /** The strip's right side: "1.2 s", "12 of 50 items". */
  detail?: string;
  /** The strip's left side in place of the state's word — why it was
   *  skipped, the error line of a failure ("Skipped: Inbox was empty"). */
  reason?: string;
  /** A condition's decision: `true` took Yes. */
  decision?: boolean;
  /** A node that runs once per item: how many are done. */
  items?: { done: number; total?: number; failed?: number };
  /** A node that repeats: which pass it is on, of at most `max`. */
  pass?: { current: number; max?: number };
  /**
   * The whole story in one sentence, with the values that decided it — why
   * it was skipped, how its condition decided, what failed ("Skipped because
   * amount (250) is not greater than 1000"). A pointer gets it in a tooltip;
   * it is added to the node's accessible description and its List view
   * lines.
   */
  explanation?: string;
}

/** A run shown without time: an old run without timings, an editor's
 *  "last run". */
export interface FlowRunOverlay {
  nodes: Readonly<Record<string, FlowNodeRunInfo>>;
  /**
   * Which lines the run took. Left out, a line counts as travelled when
   * its source succeeded and its target started, and as not taken when
   * its target was skipped or its condition decided the other way.
   */
  edges?: Readonly<Record<string, 'travelled' | 'not-taken'>>;
  /** The run is over: a node it never reached did not run. */
  finished: boolean;
}

/** Where one node stands in each of two runs compared. */
export interface FlowCompareNode {
  a?: FlowNodeRunInfo;
  b?: FlowNodeRunInfo;
  /** The two runs differ here (state, decision, or what it returned):
   *  ringed, with a "Differs" marker. */
  differs: boolean;
  /** The node is not in that run's version: dashed, and its strip says so. */
  absentIn?: 'a' | 'b';
}

/**
 * Two runs on one chart: where each node stood in each, and which lines
 * each took. Exclusive with an overlay and a playback.
 */
export interface FlowCompareOverlay {
  /** The runs' short names, "A" and "B" in the session's language when
   *  left out. */
  labels?: { a: string; b: string };
  nodes: Readonly<Record<string, FlowCompareNode>>;
  /** Which run took each line: `both` stands out, a line only one run took
   *  carries "Only in A", `neither` steps back. A line not listed is
   *  plain. */
  edges: Readonly<Record<string, 'both' | 'a' | 'b' | 'neither'>>;
}

/** One stretch of a node's work on the timeline. */
export interface FlowNodeSpan {
  nodeId: string;
  start: number;
  /** Left out: still running at the end of a live timeline. */
  end?: number;
  outcome:
    | 'succeeded'
    | 'failed'
    | 'skipped'
    | 'stopped'
    | 'waiting'
    | 'not-run'
    /** Taken from an earlier run (a zero-length span where the run began). */
    | 'reused';
  reason?: string;
  detail?: string;
  /** A condition's decision (a zero-length span when it decides). */
  decision?: boolean;
  /** Which item of a list this span worked on, from 0. */
  item?: number;
  /** Which pass of a repeat this span is, from 1. */
  pass?: number;
  /** The full sentence behind the span ({@link FlowNodeRunInfo.explanation}). */
  explanation?: string;
  /**
   * On a node's own span (one with neither `item` nor `pass`): how many
   * items its list holds, or the most passes it may make — so the counter
   * reads "3 of 12 items" while the run is live, and stays right when not
   * every item was recorded.
   */
  total?: number;
}

/** A value moving along a line: it leaves the source at `start` and
 *  arrives at `end`. */
export interface FlowEdgeTravel {
  edgeId: string;
  start: number;
  end: number;
  item?: number;
  /** A short peek at what moved ("12 issues"). */
  summary?: string;
}

/** A moment worth a mark on the scrubber. */
export interface FlowTimelineMark {
  at: number;
  /** Where a wait ended; the scrubber draws it as a band from `at` to
   *  here. Left out on a wait, the run is still waiting: the band runs to
   *  the end of the timeline. */
  end?: number;
  kind: 'wait' | 'resume' | 'failure' | 'restart';
  /** "Waited 3 h for approval". */
  label: string;
  /** The node it happened at, when it belongs to one (the node that
   *  waited, the node a restart interrupted). */
  nodeId?: string;
}

export interface FlowPlaybackTimeline {
  duration: number;
  spans: readonly FlowNodeSpan[];
  travels: readonly FlowEdgeTravel[];
  marks?: readonly FlowTimelineMark[];
  /** Every moment something starts or ends, in order: what previous and
   *  next event step between, and where the scrubber's ticks sit. */
  events: readonly number[];
  /** The run is still going: the timeline grows. */
  live?: boolean;
}

/** A run with time, at moment `t`. */
export interface FlowPlayback {
  timeline: FlowPlaybackTimeline;
  t: number;
}

export type FlowEdgeRunState =
  | 'idle'
  | 'travelled'
  | 'travelling'
  | 'not-taken';

/** Everything the canvas draws for a run at one moment. */
export interface FlowFrameState {
  nodes: Record<string, FlowNodeRunInfo>;
  edges: Record<string, FlowEdgeRunState>;
  /** Values on their way, and how far along (0–1). */
  travelling: Array<{ edgeId: string; progress: number; item?: number }>;
  /** The first node that failed, and the way the run took to it. */
  failure?: {
    nodeId: string;
    pathNodes: ReadonlySet<string>;
    pathEdges: ReadonlySet<string>;
  };
}

/** How fast a playback runs. */
export type FlowPlaybackSpeed = 0.5 | 1 | 2 | 4;

export const FLOW_PLAYBACK_SPEEDS: readonly FlowPlaybackSpeed[] = [
  0.5, 1, 2, 4,
];
