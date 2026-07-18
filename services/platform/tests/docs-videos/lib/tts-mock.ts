/**
 * Mock narration for REHEARSAL takes (`--mock-tts`): estimated-length
 * silence instead of ElevenLabs — so choreography, timeline fit, and the
 * whole record→compose machinery can be exercised with zero billing, no API
 * key, and no network. The resulting audio plan is marked `estimated`; the
 * compose stage refuses to ship it anywhere but `.state/` (drafts and
 * diagnostics), because estimated durations place every cue slightly off.
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { estimateSpeechMs } from './estimate';
import { ffmpegBin, runFfmpeg } from './ffmpeg';

interface MockNarrationResult {
  readonly mp3Path: string;
  readonly durationMs: number;
  readonly cached: boolean;
}

/**
 * One silent mp3 of the text's estimated speaking length, cache-first.
 * Silence is content-free, so the cache keys on duration alone.
 */
export async function synthesizeMockNarration(
  text: string,
  stateDir: string,
): Promise<MockNarrationResult> {
  const durationMs = estimateSpeechMs(text);
  if (durationMs <= 0) return { mp3Path: '', durationMs: 0, cached: true };
  const dir = path.join(stateDir, 'tts-mock');
  const mp3Path = path.join(dir, `silence-${durationMs}ms.mp3`);
  if (existsSync(mp3Path)) return { mp3Path, durationMs, cached: true };
  mkdirSync(dir, { recursive: true });
  await runFfmpeg(
    ffmpegBin(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      (durationMs / 1000).toFixed(3),
      '-c:a',
      'libmp3lame',
      '-q:a',
      '9',
      mp3Path,
    ],
    60_000,
  );
  return { mp3Path, durationMs, cached: false };
}
