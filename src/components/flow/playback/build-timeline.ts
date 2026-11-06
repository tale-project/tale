import type {
  FlowEdgeTravel,
  FlowNodeSpan,
  FlowPlaybackTimeline,
  FlowTimelineMark,
} from './types';

/** A span as a run recorded it: epoch milliseconds. */
export interface FlowRealSpan extends Omit<FlowNodeSpan, 'start' | 'end'> {
  startedAt: number;
  /** Left out: still running. */
  endedAt?: number;
}

/** A value leaving its source, as a run recorded it. */
export interface FlowRealTravel {
  edgeId: string;
  /** Epoch milliseconds the value left the source. */
  at: number;
  /** The node the value goes to. With it, the target's next span plays
   *  only once the value has arrived. */
  target?: string;
  item?: number;
  summary?: string;
}

/** A stretch the run waited (an approval, a question, an agent). */
export interface FlowRealWait {
  startedAt: number;
  endedAt?: number;
  /** "Waited 3 h for approval". */
  label: string;
  /** The node that waited. */
  nodeId?: string;
}

/** A moment the run went through something other than its own work: a
 *  server restarted and another took over, a person decided how it goes
 *  on. */
export interface FlowRealMark {
  /** Epoch milliseconds. */
  at: number;
  kind: 'restart' | 'resume';
  /** "The server restarted; another took over". */
  label: string;
  /** The node it happened at, when it belongs to one. */
  nodeId?: string;
}

export interface FlowRealRun {
  startedAt: number;
  /** Left out: the run is still going (a live timeline). */
  endedAt?: number;
  spans: readonly FlowRealSpan[];
  travels: readonly FlowRealTravel[];
  waits?: readonly FlowRealWait[];
  /** Restarts and resumes: marks on the scrubber, rows in the Steps
   *  view, and events the replay steps to. */
  marks?: readonly FlowRealMark[];
}

export interface BuildPlaybackTimelineOptions {
  /** Playback time a value takes along a line. @default 320 */
  travelMs?: number;
  /** The shortest a stretch between two moments plays for. @default 240 */
  minStepMs?: number;
  /** The longest a stretch between two moments plays for. @default 1200 */
  maxGapMs?: number;
}

export interface FlowBuiltTimeline extends FlowPlaybackTimeline {
  /** The real time (epoch ms) at playback moment `t`. */
  toReal(t: number): number;
  /** The playback moment of real time `ms` (epoch ms). */
  fromReal(ms: number): number;
}

/**
 * Turns a run as it was recorded (real start and end times, the moments
 * values left their nodes, the waits) into a timeline a reader can follow.
 *
 * Real time is compressed piece by piece: the stretch between two
 * consecutive moments plays for its real length, but never less than
 * `minStepMs` (a 3 ms step stays visible) nor more than `maxGapMs` (a
 * three-hour wait for approval does not stall the replay — it gets a
 * `wait` mark that says how long it really was). Each value gets
 * `travelMs` to reach its target before the target starts. The mapping is
 * monotonic and piecewise linear, so `toReal` and `fromReal` invert each
 * other and a clock can show real elapsed time.
 */
export function buildPlaybackTimeline(
  run: FlowRealRun,
  {
    travelMs = 320,
    minStepMs = 240,
    maxGapMs = 1200,
  }: BuildPlaybackTimelineOptions = {},
): FlowBuiltTimeline {
  const moments = new Set<number>([run.startedAt]);
  for (const span of run.spans) {
    moments.add(span.startedAt);
    if (span.endedAt !== undefined) moments.add(span.endedAt);
  }
  for (const travel of run.travels) moments.add(travel.at);
  for (const wait of run.waits ?? []) {
    moments.add(wait.startedAt);
    if (wait.endedAt !== undefined) moments.add(wait.endedAt);
  }
  for (const mark of run.marks ?? []) moments.add(mark.at);
  if (run.endedAt !== undefined) moments.add(run.endedAt);
  const real = [...moments]
    .filter((moment) => moment >= run.startedAt)
    .sort((a, b) => a - b);
  const indexOf = new Map(real.map((moment, index) => [moment, index]));

  // A value must reach its target before the target starts: the moment
  // the target's next span starts plays at least `travelMs` after the
  // value left.
  const arrivals = new Map<number, number[]>();
  for (const travel of run.travels) {
    if (travel.target === undefined) continue;
    const target = run.spans
      .filter(
        (span) => span.nodeId === travel.target && span.startedAt >= travel.at,
      )
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (target === undefined) continue;
    const to = indexOf.get(target.startedAt);
    const from = indexOf.get(travel.at);
    if (to === undefined || from === undefined || to <= from) continue;
    arrivals.set(to, [...(arrivals.get(to) ?? []), from]);
  }

  const played: number[] = [0];
  for (let index = 1; index < real.length; index += 1) {
    const step = (real[index] ?? 0) - (real[index - 1] ?? 0);
    let at =
      (played[index - 1] ?? 0) + Math.min(maxGapMs, Math.max(minStepMs, step));
    for (const from of arrivals.get(index) ?? [])
      at = Math.max(at, (played[from] ?? 0) + travelMs);
    played.push(at);
  }

  const fromReal = (ms: number): number => {
    if (real.length === 0 || ms <= (real[0] ?? 0)) return 0;
    for (let index = 1; index < real.length; index += 1) {
      const r1 = real[index] ?? 0;
      if (ms <= r1) {
        const r0 = real[index - 1] ?? 0;
        const p0 = played[index - 1] ?? 0;
        const p1 = played[index] ?? 0;
        return p0 + ((ms - r0) / (r1 - r0)) * (p1 - p0);
      }
    }
    // Past the last moment (a live run): real time plays one to one.
    return (played.at(-1) ?? 0) + (ms - (real.at(-1) ?? 0));
  };
  const toReal = (t: number): number => {
    if (real.length === 0) return run.startedAt + t;
    if (t <= 0) return real[0] ?? run.startedAt;
    for (let index = 1; index < played.length; index += 1) {
      const p1 = played[index] ?? 0;
      if (t <= p1) {
        const p0 = played[index - 1] ?? 0;
        const r0 = real[index - 1] ?? 0;
        const r1 = real[index] ?? 0;
        return r0 + ((t - p0) / (p1 - p0)) * (r1 - r0);
      }
    }
    return (real.at(-1) ?? 0) + (t - (played.at(-1) ?? 0));
  };

  const spans: FlowNodeSpan[] = run.spans.map(
    ({ startedAt, endedAt, ...rest }) => ({
      ...rest,
      start: fromReal(startedAt),
      ...(endedAt === undefined ? {} : { end: fromReal(endedAt) }),
    }),
  );
  const travels: FlowEdgeTravel[] = run.travels.map(
    ({ at, target: _target, ...rest }) => {
      const start = fromReal(at);
      return { ...rest, start, end: start + travelMs };
    },
  );

  const marks: FlowTimelineMark[] = [];
  for (const wait of run.waits ?? [])
    marks.push({
      at: fromReal(wait.startedAt),
      ...(wait.endedAt === undefined ? {} : { end: fromReal(wait.endedAt) }),
      kind: 'wait',
      label: wait.label,
      ...(wait.nodeId === undefined ? {} : { nodeId: wait.nodeId }),
    });
  for (const span of spans)
    if (span.outcome === 'failed')
      marks.push({
        at: span.end ?? span.start,
        kind: 'failure',
        label: span.reason ?? span.detail ?? span.nodeId,
        nodeId: span.nodeId,
      });
  const moved: FlowTimelineMark[] = [];
  for (const mark of run.marks ?? []) {
    const moment: FlowTimelineMark = {
      at: fromReal(mark.at),
      kind: mark.kind,
      label: mark.label,
    };
    if (mark.nodeId !== undefined) moment.nodeId = mark.nodeId;
    moved.push(moment);
  }
  marks.push(...moved);
  marks.sort((a, b) => a.at - b.at);

  const events = [
    ...new Set([
      ...spans.flatMap((span) =>
        span.end === undefined ? [span.start] : [span.start, span.end],
      ),
      ...travels.map((travel) => travel.start),
      ...moved.map((mark) => mark.at),
    ]),
  ].sort((a, b) => a - b);

  const lastPlayed = played.at(-1) ?? 0;
  const duration = Math.max(
    run.endedAt === undefined ? lastPlayed : fromReal(run.endedAt),
    ...travels.map((travel) => travel.end),
    ...spans.map((span) => span.end ?? span.start),
  );

  return {
    duration,
    spans,
    travels,
    marks,
    events,
    ...(run.endedAt === undefined ? { live: true } : {}),
    toReal,
    fromReal,
  };
}
