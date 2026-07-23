/**
 * The Canvas visibility matrix — the one place that decides which Canvas
 * modes a thread shows and, for a mode that is shown but has nothing in it
 * yet, why.
 *
 * The Canvas is the persistent right-side panel every chat carries; its tabs
 * are its MODES. Four exist:
 *
 *  - `computer` — the whole sandbox computer, streamed from the headed
 *    browser session attached to the harness.
 *  - `live`     — the activity stream of the running turn, step by step.
 *  - `file`     — the sandbox workspace's file tree and file contents.
 *  - `browser`  — the render frame for artifacts the thread produced
 *    (a page, a document, a diagram).
 *
 * Two rules, and nothing else decides visibility:
 *
 *  1. `computer`, `live` and `file` describe a SANDBOX. They apply only to a
 *     thread whose turns run in a sandbox harness (`threads.kind ===
 *     'sandbox'`); on a direct thread they are not "empty", they are
 *     meaningless, so they are omitted entirely.
 *  2. `browser` renders artifacts. It applies exactly when the thread has at
 *     least one, so it is never shown empty.
 *
 * A mode that APPLIES but has no content yet is still shown — a sandbox
 * thread that has not started tells the user the computer will appear once
 * it does, which is more useful than a tab that blinks into existence. That
 * is the `pending` reason: a shown-but-not-ready mode always carries one, so
 * the panel can state plainly why the mode is empty instead of rendering an
 * empty shell.
 *
 * Pure data in, pure data out — no React, no Convex — so the matrix is read
 * and tested as a table.
 */

/** Every Canvas mode, in the order the tab strip renders them. */
export const CANVAS_MODES = ['computer', 'live', 'file', 'browser'] as const;

export type CanvasMode = (typeof CANVAS_MODES)[number];

/** What a turn ran on. Mirrors `threads.kind`. */
export type ChatThreadKind = 'direct' | 'sandbox';

/** The facts about one thread the matrix reads. */
export interface CanvasThreadFacts {
  /** Where the thread's turns run. */
  readonly kind: ChatThreadKind;
  /** A sandbox session exists for the thread, in any lifecycle state. */
  readonly hasSandboxSession: boolean;
  /** The sandbox computer is attached and streaming frames. */
  readonly isComputerStreaming: boolean;
  /** Activity entries recorded for the thread's turns. */
  readonly activityCount: number;
  /** Files in the sandbox workspace. */
  readonly fileCount: number;
  /** Renderable artifacts the thread produced. */
  readonly artifactCount: number;
}

/**
 * Why a shown mode has nothing to display. Each maps to one sentence in the
 * catalog telling the user what would fill the mode.
 */
export type CanvasModePending =
  | 'sandbox-not-started'
  | 'computer-not-streaming'
  | 'no-activity'
  | 'no-files';

export interface CanvasModeState {
  readonly mode: CanvasMode;
  /** The mode has content to render right now. */
  readonly ready: boolean;
  /** Set exactly when `ready` is false. */
  readonly pending?: CanvasModePending;
}

function sandboxMode(
  mode: CanvasMode,
  facts: CanvasThreadFacts,
  ready: boolean,
  pending: CanvasModePending,
): CanvasModeState {
  // A sandbox that was never started explains itself the same way for every
  // sandbox mode — there is no session behind any of them yet.
  if (!facts.hasSandboxSession) {
    return { mode, ready: false, pending: 'sandbox-not-started' };
  }
  return ready ? { mode, ready: true } : { mode, ready: false, pending };
}

/**
 * Resolve the Canvas modes for one thread, in tab order. Modes that do not
 * apply to the thread are absent from the result; modes that apply are
 * present and carry either content (`ready`) or the reason they are empty.
 */
export function resolveCanvasModes(
  facts: CanvasThreadFacts,
): CanvasModeState[] {
  const states: CanvasModeState[] = [];

  if (facts.kind === 'sandbox') {
    states.push(
      sandboxMode(
        'computer',
        facts,
        facts.isComputerStreaming,
        'computer-not-streaming',
      ),
      sandboxMode('live', facts, facts.activityCount > 0, 'no-activity'),
      sandboxMode('file', facts, facts.fileCount > 0, 'no-files'),
    );
  }

  if (facts.artifactCount > 0) {
    states.push({ mode: 'browser', ready: true });
  }

  return states;
}

/**
 * The mode the panel opens on: the first ready mode, else the first shown
 * mode, else nothing (the panel does not render at all).
 */
export function defaultCanvasMode(
  states: readonly CanvasModeState[],
): CanvasMode | undefined {
  return (states.find((state) => state.ready) ?? states[0])?.mode;
}
