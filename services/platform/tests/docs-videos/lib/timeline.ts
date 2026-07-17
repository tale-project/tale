/**
 * Planned-timeline math for the docs video pipeline. The whole A/V sync
 * strategy hangs on one invariant: narration audio offsets are PLANNED before
 * recording (TTS durations are known), and the recorder paces scenes to that
 * plan on a monotonic clock — so audio placement never depends on measuring
 * the captured video. The compose stage then asserts the recorder actually
 * held the plan (drift per scene under `MAX_DRIFT_MS`) and fails loudly
 * instead of shipping a desynced cut.
 *
 * Pure module — no Playwright, no fs — so the vitest server project covers it
 * without a running stack.
 */

/** Silence before the narration starts inside a scene. */
export const DEFAULT_LEAD_IN_MS = 500;
/** Silence after the narration ends before the next scene begins. */
export const DEFAULT_TAIL_MS = 700;
/** Shortest a scene may run, narration or not (breathing room on screen). */
export const DEFAULT_MIN_SCENE_MS = 2500;
/** A scene starting further than this from its plan fails the compose gate. */
export const MAX_DRIFT_MS = 100;

/** Timing inputs of one scene: measured narration length + overrides. */
interface SceneTiming {
  readonly id: string;
  /** Measured narration duration (0 for a silent scene). */
  readonly audioDurationMs: number;
  readonly leadInMs?: number;
  readonly tailMs?: number;
  readonly minMs?: number;
}

/** One scene placed on the video timeline. */
export interface PlannedScene {
  readonly id: string;
  /** Scene start relative to video t0. */
  readonly startMs: number;
  /** Where the narration audio is muxed in (startMs + lead-in). */
  readonly narrationStartMs: number;
  /** Total scene duration: max(leadIn + audio + tail, min). */
  readonly budgetMs: number;
}

export interface PlannedTimeline {
  readonly scenes: readonly PlannedScene[];
  readonly totalMs: number;
}

function planScene(timing: SceneTiming, startMs: number): PlannedScene {
  const leadInMs = timing.leadInMs ?? DEFAULT_LEAD_IN_MS;
  const tailMs = timing.tailMs ?? DEFAULT_TAIL_MS;
  const minMs = timing.minMs ?? DEFAULT_MIN_SCENE_MS;
  if (timing.audioDurationMs < 0) {
    throw new Error(`Scene "${timing.id}" has negative audio duration`);
  }
  const budgetMs = Math.max(
    leadInMs + Math.ceil(timing.audioDurationMs) + tailMs,
    minMs,
  );
  return {
    id: timing.id,
    startMs,
    narrationStartMs: startMs + leadInMs,
    budgetMs,
  };
}

/** Lay the scenes back to back; offsets are cumulative sums of budgets. */
export function planTimeline(timings: readonly SceneTiming[]): PlannedTimeline {
  const scenes: PlannedScene[] = [];
  let cursor = 0;
  for (const timing of timings) {
    const scene = planScene(timing, cursor);
    scenes.push(scene);
    cursor += scene.budgetMs;
  }
  return { scenes, totalMs: cursor };
}

/** How far each scene's actual start landed from its plan. */
interface SceneDrift {
  readonly id: string;
  readonly plannedMs: number;
  readonly actualMs: number;
  readonly driftMs: number;
}

/**
 * Compare planned scene starts against the starts the recorder measured
 * (both relative to video t0). Scenes missing from `actualStartsMs` are an
 * error — a recording that skipped a scene must never compose.
 */
export function driftReport(
  planned: PlannedTimeline,
  actualStartsMs: ReadonlyMap<string, number>,
): readonly SceneDrift[] {
  return planned.scenes.map((scene) => {
    const actualMs = actualStartsMs.get(scene.id);
    if (actualMs === undefined) {
      throw new Error(`No recorded start for scene "${scene.id}"`);
    }
    return {
      id: scene.id,
      plannedMs: scene.startMs,
      actualMs,
      driftMs: actualMs - scene.startMs,
    };
  });
}

/** The scenes whose |drift| breaks the budget (compose refuses to ship). */
export function driftViolations(
  report: readonly SceneDrift[],
  maxDriftMs: number = MAX_DRIFT_MS,
): readonly SceneDrift[] {
  return report.filter((entry) => Math.abs(entry.driftMs) > maxDriftMs);
}
