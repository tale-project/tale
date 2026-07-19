/**
 * Post-compose A/V verification — the automatable half of the "watch it
 * end-to-end" QA gate. What the spike-sync probe proves by hand, this proves
 * on every compose:
 *
 *  1. the container's duration matches the planned timeline,
 *  2. audible speech actually covers each narrated window (silencedetect →
 *     speech intervals → per-scene coverage), so a silent track, a missing
 *     scene, or a global audio offset can never ship unheard,
 *  3. no speech plays before the first narration is due (offset bugs).
 *
 * The interval math is pure and unit-tested; only `verifyComposedEpisode`
 * touches ffmpeg. Coverage thresholds are deliberately generous — loudnorm
 * dynamics and intra-narration pauses eat real coverage; the gate hunts
 * broken tracks, not prosody.
 */

import type { AudioPlan } from './audio-plan';
import { ffmpegBin, probeDurationMs, runFfmpeg } from './ffmpeg';
import type { RecordedTimeline } from './recorder';

/** silencedetect noise floor / minimum silence length. */
const SILENCE_ARGS = 'silencedetect=n=-35dB:d=0.35';
/** A narrated window must be at least this fraction audible. */
const MIN_SPEECH_COVERAGE = 0.55;
/** Slack before the first narration where speech may already exist. */
const EARLY_SPEECH_SLACK_MS = 700;
/** Composed duration may differ from the plan by at most this much. */
const MAX_DURATION_DELTA_MS = 800;

interface SpeechInterval {
  readonly startMs: number;
  readonly endMs: number;
}

interface VerifyIssue {
  readonly where: string;
  readonly detail: string;
}

/**
 * Parse ffmpeg `silencedetect` stderr into SPEECH intervals over
 * `[0, totalMs]` (the inverse of the reported silences).
 */
export function parseSpeechIntervals(
  ffmpegStderr: string,
  totalMs: number,
): SpeechInterval[] {
  const silences: { startMs: number; endMs: number }[] = [];
  let openStartMs: number | null = null;
  for (const match of ffmpegStderr.matchAll(
    /silence_(start|end):\s*(-?[\d.]+)/g,
  )) {
    const kind = match[1];
    const atMs = Math.max(0, Math.round(Number(match[2]) * 1000));
    if (kind === 'start') {
      openStartMs = atMs;
    } else if (openStartMs !== null) {
      silences.push({ startMs: openStartMs, endMs: atMs });
      openStartMs = null;
    }
  }
  // A silence still open at EOF runs to the end of the track.
  if (openStartMs !== null) {
    silences.push({ startMs: openStartMs, endMs: totalMs });
  }

  const speech: SpeechInterval[] = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.startMs > cursor) {
      speech.push({ startMs: cursor, endMs: silence.startMs });
    }
    cursor = Math.max(cursor, silence.endMs);
  }
  if (cursor < totalMs) speech.push({ startMs: cursor, endMs: totalMs });
  return speech;
}

function overlapMs(
  interval: SpeechInterval,
  startMs: number,
  endMs: number,
): number {
  return Math.max(
    0,
    Math.min(interval.endMs, endMs) - Math.max(interval.startMs, startMs),
  );
}

interface NarratedWindow {
  readonly id: string;
  readonly startMs: number;
  readonly durationMs: number;
}

/** Pure coverage check: every narrated window ≥ threshold audible. */
export function verifySpeechCoverage(
  windows: readonly NarratedWindow[],
  speech: readonly SpeechInterval[],
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  for (const window of windows) {
    const audible = speech.reduce(
      (sum, interval) =>
        sum +
        overlapMs(interval, window.startMs, window.startMs + window.durationMs),
      0,
    );
    const coverage = window.durationMs > 0 ? audible / window.durationMs : 1;
    if (coverage < MIN_SPEECH_COVERAGE) {
      issues.push({
        where: window.id,
        detail:
          `narration window ${window.startMs}–${window.startMs + window.durationMs}ms is only ` +
          `${Math.round(coverage * 100)}% audible (need ≥${Math.round(MIN_SPEECH_COVERAGE * 100)}%) — ` +
          `silent/missing narration or A/V offset`,
      });
    }
  }
  const firstNarrationMs = windows[0]?.startMs;
  if (firstNarrationMs !== undefined) {
    const early = speech.find(
      (interval) => interval.startMs < firstNarrationMs - EARLY_SPEECH_SLACK_MS,
    );
    if (early) {
      issues.push({
        where: 'lead-in',
        detail: `speech at ${early.startMs}ms but the first narration is planned at ${firstNarrationMs}ms — global audio offset`,
      });
    }
  }
  return issues;
}

interface VerifyOptions {
  /** `--mock-tts` plans carry silence — coverage would always fail. */
  readonly audioIsSilent: boolean;
}

/**
 * Run the full verification against a composed mp4. Returns issues instead
 * of throwing so the compose stage can aggregate and report them all.
 */
export async function verifyComposedEpisode(
  mp4Path: string,
  recorded: RecordedTimeline,
  audioPlan: AudioPlan,
  options: VerifyOptions,
): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = [];
  const plannedMs = recorded.planned.totalMs;
  const actualMs = await probeDurationMs(mp4Path);
  if (Math.abs(actualMs - plannedMs) > MAX_DURATION_DELTA_MS) {
    issues.push({
      where: 'duration',
      detail: `composed ${actualMs}ms vs planned ${plannedMs}ms (|Δ| > ${MAX_DURATION_DELTA_MS}ms)`,
    });
  }
  if (options.audioIsSilent) return issues;

  const windows: NarratedWindow[] = recorded.planned.scenes.flatMap((scene) => {
    const audio = audioPlan.scenes.find((s) => s.id === scene.id);
    if (!audio || audio.durationMs <= 0) return [];
    return [
      {
        id: scene.id,
        startMs: scene.narrationStartMs,
        durationMs: audio.durationMs,
      },
    ];
  });
  if (windows.length === 0) return issues;

  const { stderr } = await runFfmpeg(
    ffmpegBin(),
    ['-i', mp4Path, '-map', '0:a:0', '-af', SILENCE_ARGS, '-f', 'null', '-'],
    120_000,
  );
  const speech = parseSpeechIntervals(stderr, actualMs || plannedMs);
  issues.push(...verifySpeechCoverage(windows, speech));
  return issues;
}
