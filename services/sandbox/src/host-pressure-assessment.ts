// How pressed the host is, judged from its pressure readings. Pure: no I/O,
// no clock, no state of its own — session admission, the admission answer the
// platform asks for and the heavy-phase leases all decide with it, from the
// same readings, the same way.
//
// A verdict rests on two readings at least ten seconds apart, the newer one
// fresh: one reading is a moment, and the ten-second averages the kernel
// keeps move with every burst. The score is the worst ratio of a reading to
// its threshold across both readings and every signal switched on (load per
// CPU, and the CPU, memory and I/O pressure stall shares), so either reading
// over a threshold presses the host. Once pressed, the host stays pressed
// until the score falls below the recover share of the thresholds: a host
// that just dropped under a threshold is not admitted straight back over it.
//
// The CPU stall counts only as far as the host's CPUs were busy between the
// two readings. A task its session's CPU quota holds back stays runnable, so
// the kernel counts it as stalled while it waits for its next quota period —
// beside an idle CPU as much as behind a busy one. One session building at
// its quota reads as a stall of most of the host's time while most of its
// CPUs sit idle. A task that could run would take an idle CPU, so a stall
// beside idle CPUs is the sessions' quotas, not contention for the host's
// CPUs; the busy share (/proc/stat) cannot be raised by a throttled task,
// which does not run.

import { busyCpuShare } from './proc-stats.ts';
import { msSince } from './wall-clock.ts';

/** One reading of the host, as the pressure sampler takes it every few
 * seconds. Every value is null when it could not be read, never 0. */
export interface HostPressureReading {
  /** When it was taken (ms since the epoch). */
  atMs: number;
  /** The one-minute load average (/proc/loadavg). */
  load1: number | null;
  /** The CPUs online (/sys/devices/system/cpu/online). */
  cpus: number | null;
  /** `some avg10` of /proc/pressure/cpu, memory and io, in percent. */
  cpuPsi: number | null;
  memoryPsi: number | null;
  ioPsi: number | null;
  /** The CPU time the host has spent since boot and the idle part of it, in
   * clock ticks (the `cpu` line of /proc/stat; I/O wait counts as idle). */
  cpuTicks: number | null;
  idleTicks: number | null;
}

export type AdmissionPresetName = 'default' | 'conservative';

export const ADMISSION_PRESETS: readonly AdmissionPresetName[] = [
  'default',
  'conservative',
];

/** Where each signal presses the host; null switches the signal off. */
export interface PressureThresholds {
  /** Load average per online CPU. */
  loadPerCpu: number | null;
  /** Pressure stall shares, in percent. */
  cpuPsi: number | null;
  memoryPsi: number | null;
  ioPsi: number | null;
  /** The share of its thresholds a pressed host must fall below before it
   * admits again, between 0 and 1 exclusive. */
  recover: number;
}

export type PressureSignal = 'load' | 'cpu' | 'memory' | 'io';

/** CPU first: on a tie, the CPU is named as what presses the host, as it
 * was before the other signals existed. */
const SIGNALS: readonly PressureSignal[] = ['cpu', 'memory', 'io', 'load'];

const DEFAULT_RECOVER = 0.5;

/** The thresholds an operations team ran its fleet with: a load of one per
 * CPU, a fifth of the time waiting for a CPU, any measurable memory stall,
 * a tenth of the time waiting for I/O. */
export const CONSERVATIVE_THRESHOLDS: PressureThresholds = {
  loadPerCpu: 1,
  cpuPsi: 20,
  memoryPsi: 1,
  ioPsi: 10,
  recover: DEFAULT_RECOVER,
};

/** The CPU stall counts in full where the host's CPUs were busy at least
 * this share of their time between the two readings (percent)… */
const CPU_CONTENDED_PERCENT = 90;
/** …not at all at this share or less, where a fifth of their time sat idle,
 * and in proportion between, so the score moves smoothly with the busy
 * share. */
const CPU_IDLE_ROOM_PERCENT = 80;

/** The two readings of a verdict lie at least this far apart… */
const MIN_SPAN_MS = 10_000;
/** …and at most this far, and the newer is at most this old. */
const MAX_SPAN_MS = 60_000;
const FRESH_MS = 30_000;

/** When to ask again after each kind of hold: a pressed host eases over
 * tens of seconds, a missing pair of readings fills within a sample or two,
 * and a host whose readings cannot be had rarely gains them. */
export const PRESSURE_RETRY_MS = 15_000;
const STALE_RETRY_MS = 5_000;
export const UNAVAILABLE_RETRY_MS = 60_000;
const MIN_RETRY_MS = 1_000;

/** The `default` preset is the spawner's own: CPU pressure alone, at
 * SANDBOX_CPU_PRESSURE_PERCENT (0 switches it off). */
export function defaultPresetThresholds(
  cpuPressurePercent: number,
): PressureThresholds {
  return {
    loadPerCpu: null,
    cpuPsi: cpuPressurePercent > 0 ? cpuPressurePercent : null,
    memoryPsi: null,
    ioPsi: null,
    recover: DEFAULT_RECOVER,
  };
}

export function presetThresholds(
  preset: AdmissionPresetName,
  cpuPressurePercent: number,
): PressureThresholds {
  return preset === 'conservative'
    ? { ...CONSERVATIVE_THRESHOLDS }
    : defaultPresetThresholds(cpuPressurePercent);
}

function stricter(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** Thresholds never looser than either set: per signal the lower threshold
 * (an off signal counts as no limit), and the lower recover share. */
export function tightenThresholds(
  a: PressureThresholds,
  b: PressureThresholds,
): PressureThresholds {
  return {
    loadPerCpu: stricter(a.loadPerCpu, b.loadPerCpu),
    cpuPsi: stricter(a.cpuPsi, b.cpuPsi),
    memoryPsi: stricter(a.memoryPsi, b.memoryPsi),
    ioPsi: stricter(a.ioPsi, b.ioPsi),
    recover: Math.min(a.recover, b.recover),
  };
}

/** One key per distinct set of thresholds, for the hysteresis each keeps. */
export function thresholdsKey(thresholds: PressureThresholds): string {
  return JSON.stringify([
    thresholds.loadPerCpu,
    thresholds.cpuPsi,
    thresholds.memoryPsi,
    thresholds.ioPsi,
    thresholds.recover,
  ]);
}

/** Where each signal's threshold lives. */
const THRESHOLD_FIELD = {
  load: 'loadPerCpu',
  cpu: 'cpuPsi',
  memory: 'memoryPsi',
  io: 'ioPsi',
} as const satisfies Record<PressureSignal, keyof PressureThresholds>;

/** Where each pressure stall share lives in a reading. */
const PSI_FIELD = {
  cpu: 'cpuPsi',
  memory: 'memoryPsi',
  io: 'ioPsi',
} as const satisfies Record<
  Exclude<PressureSignal, 'load'>,
  keyof HostPressureReading
>;

function signalThreshold(
  thresholds: PressureThresholds,
  signal: PressureSignal,
): number | null {
  return thresholds[THRESHOLD_FIELD[signal]];
}

/** The share of the host's CPU time that was busy between two readings, in
 * percent; null where either lacks the counters or they went backwards. */
function cpuBusyPercent(
  first: HostPressureReading,
  last: HostPressureReading,
): number | null {
  const { cpuTicks: totalBefore, idleTicks: idleBefore } = first;
  const { cpuTicks: totalAfter, idleTicks: idleAfter } = last;
  if (
    totalBefore === null ||
    idleBefore === null ||
    totalAfter === null ||
    idleAfter === null
  ) {
    return null;
  }
  const share = busyCpuShare(
    { total: totalBefore, idle: idleBefore },
    { total: totalAfter, idle: idleAfter },
  );
  return share === null ? null : share * 100;
}

/** How much of the CPU stall counts at a busy share: none while the host had
 * idle CPUs to spare, all of it once they were nearly all busy. An unknown
 * busy share counts the stall as it reads. */
function contendedShare(busyPercent: number | null): number {
  if (busyPercent === null) return 1;
  const share =
    (busyPercent - CPU_IDLE_ROOM_PERCENT) /
    (CPU_CONTENDED_PERCENT - CPU_IDLE_ROOM_PERCENT);
  return Math.min(1, Math.max(0, share));
}

/** A reading's value of one signal: the load counts per online CPU, and the
 * CPU stall by the share of it that `cpuShare` says the busy CPUs account
 * for. */
function signalValue(
  reading: HostPressureReading,
  signal: PressureSignal,
  cpuShare: number,
): number | null {
  if (signal === 'cpu') {
    return reading.cpuPsi === null ? null : reading.cpuPsi * cpuShare;
  }
  if (signal !== 'load') return reading[PSI_FIELD[signal]];
  const { load1, cpus } = reading;
  return load1 === null || cpus === null || cpus <= 0 ? null : load1 / cpus;
}

export interface SignalEvidence {
  /** Its threshold, null while the signal is off. */
  threshold: number | null;
  /** The higher of its two readings over its threshold; null while off or
   * not judged. */
  ratio: number | null;
}

export type PressureReason = 'pressure' | 'stale' | 'unavailable' | 'pacing';

export interface PressureAssessment {
  verdict: 'admit' | 'hold';
  /** Why it holds; on an admit, null — or, where the caller admits without
   * a verdict of pressure, why there was none. */
  reason: PressureReason | null;
  /** The hysteresis state after this assessment: unchanged when no score
   * could be taken. */
  pressured: boolean;
  /** The worst ratio of a reading to its threshold; null when not judged. */
  score: number | null;
  retryAfterMs: number | null;
  evidence: {
    first: HostPressureReading | null;
    last: HostPressureReading | null;
    /** The share of the host's CPU time that was busy between the two
     * readings, in percent, which decides how much of the CPU stall counts;
     * null when it is not known. */
    cpuBusy: number | null;
    signals: Record<PressureSignal, SignalEvidence>;
  };
}

export interface AssessHostPressureInput {
  /** The sampler's readings, in any order. */
  readings: readonly HostPressureReading[];
  thresholds: PressureThresholds;
  /** Whether the host was pressed under these thresholds before. */
  pressured: boolean;
  now: number;
  /** When the last session start was let in. A start must be followed by a
   * fresh pair of readings before the next: they are what shows its load.
   * Never ahead of `now`: the caller moves a start the clock stepped back
   * past to now, and keeps it there (host-admission.ts). */
  lastStartAtMs?: number | null;
  minSpanMs?: number;
  maxSpanMs?: number;
  freshMs?: number;
}

/** The newest reading, and the newest one at least `minSpanMs` before it
 * provided it lies within `maxSpanMs`. */
function readingPair(
  readings: readonly HostPressureReading[],
  minSpanMs: number,
  maxSpanMs: number,
): {
  first: HostPressureReading | null;
  last: HostPressureReading | null;
} {
  const ordered = [...readings].sort((a, b) => a.atMs - b.atMs);
  const last = ordered.at(-1) ?? null;
  if (last === null) return { first: null, last: null };
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const candidate = ordered[index];
    if (candidate === undefined) continue;
    const span = last.atMs - candidate.atMs;
    if (span < minSpanMs) continue;
    return { first: span <= maxSpanMs ? candidate : null, last };
  }
  return { first: null, last };
}

/** Decide whether the host takes more work under `thresholds`. With no
 * signal switched on there is nothing to judge, and it admits. */
export function assessHostPressure(
  input: AssessHostPressureInput,
): PressureAssessment {
  const { thresholds, now } = input;
  const minSpanMs = input.minSpanMs ?? MIN_SPAN_MS;
  const maxSpanMs = input.maxSpanMs ?? MAX_SPAN_MS;
  const freshMs = input.freshMs ?? FRESH_MS;
  const signals: Record<PressureSignal, SignalEvidence> = {
    cpu: { threshold: thresholds.cpuPsi, ratio: null },
    memory: { threshold: thresholds.memoryPsi, ratio: null },
    io: { threshold: thresholds.ioPsi, ratio: null },
    load: { threshold: thresholds.loadPerCpu, ratio: null },
  };
  const enabled = SIGNALS.flatMap((signal) => {
    const threshold = signalThreshold(thresholds, signal);
    return threshold !== null && threshold > 0 ? [{ signal, threshold }] : [];
  });
  const unjudged = (
    reason: PressureReason | null,
    retryAfterMs: number | null,
    first: HostPressureReading | null,
    last: HostPressureReading | null,
  ): PressureAssessment => ({
    verdict: reason === null ? 'admit' : 'hold',
    reason,
    pressured: reason === null ? false : input.pressured,
    score: null,
    retryAfterMs,
    evidence: {
      first,
      last,
      cpuBusy:
        first === null || last === null ? null : cpuBusyPercent(first, last),
      signals,
    },
  });
  if (enabled.length === 0) return unjudged(null, null, null, null);

  const { first, last } = readingPair(input.readings, minSpanMs, maxSpanMs);
  if (last === null) {
    return unjudged('unavailable', UNAVAILABLE_RETRY_MS, null, null);
  }
  // A newest reading stamped ahead of `now` (the clock stepped back since)
  // is stale too: it says nothing of the host now.
  if (msSince(last.atMs, now) > freshMs || first === null) {
    return unjudged('stale', STALE_RETRY_MS, first, last);
  }

  // A signal switched on that either reading lacks leaves the host unjudged:
  // judging it on the others would read an unknown as no pressure.
  const cpuBusy = cpuBusyPercent(first, last);
  const cpuShare = contendedShare(cpuBusy);
  const values = enabled.map(({ signal, threshold }) => ({
    signal,
    threshold,
    before: signalValue(first, signal, cpuShare),
    after: signalValue(last, signal, cpuShare),
  }));
  if (values.some(({ before, after }) => before === null || after === null)) {
    return unjudged('unavailable', UNAVAILABLE_RETRY_MS, first, last);
  }
  let score = 0;
  for (const { signal, threshold, before, after } of values) {
    const ratio = Math.max(before ?? 0, after ?? 0) / threshold;
    signals[signal].ratio = ratio;
    score = Math.max(score, ratio);
  }
  const pressured =
    score >= 1 || (input.pressured && score >= thresholds.recover);
  const evidence = { first, last, cpuBusy, signals };
  if (pressured) {
    return {
      verdict: 'hold',
      reason: 'pressure',
      pressured,
      score,
      retryAfterMs: PRESSURE_RETRY_MS,
      evidence,
    };
  }
  const lastStartAtMs = input.lastStartAtMs ?? null;
  if (lastStartAtMs !== null && first.atMs <= lastStartAtMs) {
    return {
      verdict: 'hold',
      reason: 'pacing',
      pressured,
      score,
      retryAfterMs: Math.max(MIN_RETRY_MS, lastStartAtMs + minSpanMs - now),
      evidence,
    };
  }
  return {
    verdict: 'admit',
    reason: null,
    pressured,
    score,
    retryAfterMs: null,
    evidence,
  };
}

/** The signal that weighs most in an assessment's score (the CPU on a
 * tie); null when none was judged. */
export function dominantSignal(
  assessment: PressureAssessment,
): PressureSignal | null {
  let dominant: PressureSignal | null = null;
  let highest = Number.NEGATIVE_INFINITY;
  for (const signal of SIGNALS) {
    const ratio = assessment.evidence.signals[signal].ratio;
    if (ratio !== null && ratio > highest) {
      dominant = signal;
      highest = ratio;
    }
  }
  return dominant;
}
