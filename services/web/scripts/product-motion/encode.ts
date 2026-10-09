import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  ffmpegBin,
  probeAudioStream,
  probeDurationMs,
  probeVideoStream,
  runFfmpeg,
} from '../../../platform/tests/docs-videos/lib/ffmpeg';

export const MOTION_FPS = 24;
export const MOTION_DURATION_MS = 8000;
export const MOTION_BUDGETS = {
  desktop: 750 * 1024,
  mobile: 350 * 1024,
} as const;

export function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export async function encodeMotion(
  playlist: string,
  output: string,
  dimensions: { width: number; height: number },
  variant: keyof typeof MOTION_BUDGETS,
): Promise<{ bytes: number; sha256: string; durationMs: number }> {
  const webm = output.endsWith('.webm');
  const budget = MOTION_BUDGETS[variant];
  for (const crf of webm ? [24, 28, 32, 36] : [20, 24, 28, 32]) {
    await runFfmpeg(
      ffmpegBin(),
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        playlist,
        '-vf',
        `fps=${MOTION_FPS},scale=${dimensions.width}:${dimensions.height}:flags=lanczos:out_range=tv,format=yuv420p,tpad=stop_mode=clone:stop_duration=1`,
        '-t',
        String(MOTION_DURATION_MS / 1000),
        '-frames:v',
        String((MOTION_FPS * MOTION_DURATION_MS) / 1000),
        '-fps_mode',
        'cfr',
        '-r',
        String(MOTION_FPS),
        '-an',
        '-c:v',
        webm ? 'libvpx-vp9' : 'libx264',
        '-crf',
        String(crf),
        ...(webm
          ? ['-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3']
          : ['-preset', 'medium', '-movflags', '+faststart']),
        '-color_range',
        'tv',
        '-threads',
        '2',
        output,
      ],
      120_000,
    );
    const bytes = statSync(output).size;
    if (bytes > budget) continue;
    const durationMs = await probeDurationMs(output);
    if (Math.abs(durationMs - MOTION_DURATION_MS) > 100) {
      throw new Error(
        `${path.basename(output)} has unexpected duration ${durationMs}ms`,
      );
    }
    if (await probeAudioStream(output))
      throw new Error(`${output} must be silent`);
    const video = await probeVideoStream(output);
    if (
      video.codec !== (webm ? 'vp9' : 'h264') ||
      video.width !== dimensions.width ||
      video.height !== dimensions.height ||
      video.fps !== MOTION_FPS ||
      video.frameCount !== (MOTION_FPS * MOTION_DURATION_MS) / 1000 ||
      video.pixelFormat !== 'yuv420p'
    ) {
      throw new Error(
        `${path.basename(output)} has incompatible video stream ${JSON.stringify(video)}`,
      );
    }
    return { bytes, sha256: sha256(output), durationMs };
  }
  throw new Error(
    `${path.basename(output)} cannot fit the ${budget}-byte motion budget`,
  );
}
