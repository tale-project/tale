'use node';

/**
 * Audio preprocessing for long-form meeting transcription.
 *
 * Two stages, both via native ffmpeg (installed in the platform image):
 *
 * 1. compressAudio — single ffmpeg pass: strip video, remove silences > 2s,
 *    downmix to mono 16 kHz, encode to Opus at 32 kbps. Output is nearly
 *    always < 24 MB for meetings under ~2 hours.
 *
 * 2. chunkCompressedAudio — used only when the compressed output is still
 *    > 24 MB (e.g. 3–4 hour continuous recording with few pauses). Uses
 *    ffmpeg stream-copy segmentation (no re-encode) to split into 90-minute
 *    chunks, each ≤ ~21 MB.
 *
 * Both work on files, from the recording's file to the files they make, and
 * hand back blobs that read those files: a recording is never held in this
 * process, whatever its size. And both run ffmpeg as the heavy slot's
 * process (`lib/heavy-slot`): one conversion at a time, in its turn among
 * the work a queue brought, killed above the slot's memory cap
 * (tale-project/tale#4942). Errors from ffmpeg itself are surfaced with
 * stderr tail for diagnostics.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openAsBlob, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  childEnvironment,
  runCommand,
  withHeavySlot,
} from '../../lib/heavy-slot/slot';

const FFMPEG_BIN = 'ffmpeg';
const FFPROBE_BIN = 'ffprobe';

/** 90 minutes per chunk → ~21 MB at 32 kbps Opus (safely below the 25 MB
 * OpenAI limit, with headroom for container overhead). */
const CHUNK_DURATION_SEC = 90 * 60;

/** Target audio bitrate for the compressed output. 32 kbps Opus at 16 kHz
 * mono is near-transparent for speech; Whisper accuracy is unaffected. */
const TARGET_BITRATE_KBPS = 32;

interface FfmpegResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run ffprobe, which reads a file's header and holds next to nothing: it
 * needs no slot. Like every program that reads a stranger's file, it is
 * handed none of this process's secrets. */
async function runFfmpeg(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env: childEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
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

async function writeBlobToTmp(blob: Blob, suffix: string): Promise<string> {
  const path = join(tmpdir(), `transcribe-${randomUUID()}${suffix}`);
  const buf = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(path, buf);
  return path;
}

async function cleanupTmp(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((p) =>
      fs.rm(p, { force: true, recursive: false }).catch((err) => {
        console.warn(`[audio_preprocess] cleanup failed for ${p}:`, err);
      }),
    ),
  );
}

async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await runFfmpeg(
    FFPROBE_BIN,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    30_000,
  );
  const val = parseFloat(stdout.trim());
  return Number.isFinite(val) ? val : 0;
}

/**
 * How long a recording plays, in seconds: ffprobe over a temporary copy.
 * 0 when the container states no duration (a stream still being written,
 * say) — callers treat that as "unknown", never as free.
 *
 * For a clip that is in memory already: a dictation of a few seconds.
 */
export async function probeAudioDurationSec(
  blob: Blob,
  fileName: string,
): Promise<number> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = await writeBlobToTmp(blob, `.${ext}`);
  try {
    return await probeDurationSec(path);
  } finally {
    await cleanupTmp([path]);
  }
}

export interface AudioWork {
  /** Ends the wait for a slot and the conversion; its reason is rethrown. */
  signal?: AbortSignal;
}

/**
 * Run ffmpeg as the heavy slot's process: when its turn comes, and under
 * the slot's memory cap. Its turn is among the work a queue brought. A long
 * recording takes minutes to convert, and ahead of the documents a chat
 * waits to read it would hold each of them for as long. The line it waits
 * in is short: no more jobs stand in it than a worker runs at once, and it
 * is given every fifth turn at least.
 */
async function convert(
  args: string[],
  timeoutMs: number,
  what: string,
  work: AudioWork,
): Promise<void> {
  const signal = work.signal !== undefined ? { signal: work.signal } : {};
  await withHeavySlot({ priority: 'background', ...signal }, () =>
    runCommand(FFMPEG_BIN, args, { label: what, timeoutMs, ...signal }),
  );
}

export interface CompressedAudio {
  /** The compressed recording, on disk. */
  path: string;
  /** A blob that reads it from there. */
  blob: Blob;
  durationSec: number;
  sizeBytes: number;
}

/**
 * Compress the audio or video file at `inputPath` into 32 kbps Opus mono
 * 16 kHz with silences > 2s collapsed. The output is a single file in
 * `workDir`, which the caller removes when it is done with it.
 */
export async function compressAudio(
  inputPath: string,
  workDir: string,
  work: AudioWork = {},
): Promise<CompressedAudio> {
  const outputPath = join(workDir, 'compressed.ogg');
  // ffmpeg runs roughly 20–100× real-time for audio-only transcoding on
  // modern servers; 20 minutes covers 4 hours of input comfortably.
  await convert(
    [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-af',
      'silenceremove=stop_periods=-1:stop_duration=2:stop_threshold=-35dB',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libopus',
      '-b:a',
      `${TARGET_BITRATE_KBPS}k`,
      outputPath,
    ],
    20 * 60 * 1000,
    'compressing a recording',
    work,
  );

  const [durationSec, stat] = await Promise.all([
    probeDurationSec(outputPath),
    fs.stat(outputPath),
  ]);
  return {
    path: outputPath,
    blob: await openAsBlob(outputPath, { type: 'audio/ogg' }),
    durationSec,
    sizeBytes: stat.size,
  };
}

export interface AudioChunk {
  blob: Blob;
  durationSec: number;
  index: number;
}

/**
 * Stream-copy split the compressed opus file at `compressedPath` into
 * chunks of at most CHUNK_DURATION_SEC (90 minutes). No re-encoding: output
 * is instant.
 *
 * Returns chunks sorted by start time, each a blob that reads its file in
 * `workDir`, which the caller removes when it is done with them.
 */
export async function chunkCompressedAudio(
  compressedPath: string,
  workDir: string,
  work: AudioWork = {},
): Promise<AudioChunk[]> {
  const outputDir = join(workDir, 'chunks');
  await fs.mkdir(outputDir, { recursive: true });
  await convert(
    [
      '-y',
      '-i',
      compressedPath,
      '-c',
      'copy',
      '-f',
      'segment',
      '-segment_time',
      String(CHUNK_DURATION_SEC),
      '-reset_timestamps',
      '1',
      join(outputDir, 'chunk-%03d.ogg'),
    ],
    5 * 60 * 1000,
    'splitting a recording',
    work,
  );

  const entries = (await fs.readdir(outputDir))
    .filter((name) => name.startsWith('chunk-') && name.endsWith('.ogg'))
    .sort();

  const chunks: AudioChunk[] = [];
  for (let i = 0; i < entries.length; i++) {
    const path = join(outputDir, entries[i]);
    const durationSec = await probeDurationSec(path);
    const blob = await openAsBlob(path, { type: 'audio/ogg' });
    chunks.push({ blob, durationSec, index: i });
  }
  return chunks;
}

/** Threshold at which chunking kicks in. Leave a 1 MB safety margin under
 * OpenAI's 25 MB hard limit. */
export const CHUNK_TRIGGER_BYTES = 24 * 1024 * 1024;
