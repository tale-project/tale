/**
 * ffmpeg/ffprobe wrappers for the docs video pipeline — same spawn shape as
 * `convex/file_metadata/audio_preprocess.ts` (array args, no shell, wall-clock
 * timeout + SIGKILL, stderr tail in errors) and the same binary-resolution
 * doctrine as the video-ingest toolchain: an explicit
 * `VIDEO_INGEST_FFMPEG_LOCATION` wins, otherwise the system PATH.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

export function ffmpegBin(): string {
  return process.env.VIDEO_INGEST_FFMPEG_LOCATION ?? 'ffmpeg';
}

function ffprobeBin(): string {
  const ffmpeg = process.env.VIDEO_INGEST_FFMPEG_LOCATION;
  // ffprobe ships next to an explicitly located ffmpeg.
  return ffmpeg ? path.join(path.dirname(ffmpeg), 'ffprobe') : 'ffprobe';
}

interface FfmpegResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runFfmpeg(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const killer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(
        new Error(
          `${bin} timed out after ${timeoutMs}ms; stderr tail: ${stderr.slice(-400)}`,
        ),
      );
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(killer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0) {
        reject(
          new Error(
            `${bin} exited ${code}; stderr tail: ${stderr.slice(-400)}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

interface AudioStreamInfo {
  readonly codec: string;
  readonly sampleRate: number;
  readonly channels: number;
}

/** First audio stream of a container, or null when it has none. */
export async function probeAudioStream(
  filePath: string,
): Promise<AudioStreamInfo | null> {
  const { stdout } = await runFfmpeg(
    ffprobeBin(),
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_rate,channels',
      '-of',
      'csv=p=0',
      filePath,
    ],
    30_000,
  );
  const [codec, sampleRate, channels] = stdout.trim().split(',');
  if (!codec) return null;
  return {
    codec,
    sampleRate: Number(sampleRate) || 0,
    channels: Number(channels) || 0,
  };
}

/** Media duration in milliseconds (0 when ffprobe cannot tell). */
export async function probeDurationMs(filePath: string): Promise<number> {
  const { stdout } = await runFfmpeg(
    ffprobeBin(),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    30_000,
  );
  const seconds = parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

/**
 * Preflight both binaries; the pipeline fails here, with install hints,
 * rather than mid-compose.
 */
export async function ensureFfmpegAvailable(): Promise<void> {
  for (const bin of [ffmpegBin(), ffprobeBin()]) {
    try {
      await runFfmpeg(bin, ['-version'], 10_000);
    } catch (error) {
      throw new Error(
        `${bin} is not runnable (${String(error)}). Install ffmpeg (macOS: \`brew install ffmpeg\`) ` +
          `or point VIDEO_INGEST_FFMPEG_LOCATION at the binary.`,
        { cause: error },
      );
    }
  }
}
