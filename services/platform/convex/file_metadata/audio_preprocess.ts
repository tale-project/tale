'use node';

/**
 * Audio preprocessing for long-form meeting transcription.
 *
 * Two stages, both via native ffmpeg (installed in the Convex container):
 *
 * 1. compressAudio — single ffmpeg pass: strip video, remove silences > 2s,
 *    downmix to mono 16 kHz, encode to Opus at 32 kbps. Output is nearly
 *    always < 24 MB for meetings under ~2 hours.
 *
 * 2. chunkAudio — used only when the compressed output is still > 24 MB
 *    (e.g. 3–4 hour continuous recording with few pauses). Uses ffmpeg
 *    stream-copy segmentation (no re-encode) to split into 90-minute chunks,
 *    each ≤ ~21 MB.
 *
 * Both functions write to /tmp and clean up on return or throw. Errors from
 * ffmpeg itself are surfaced with stderr tail for diagnostics.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

async function runFfmpeg(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

async function readTmpAsBlob(path: string, mime: string): Promise<Blob> {
  const buf = await fs.readFile(path);
  return new Blob([buf], { type: mime });
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

export interface CompressedAudio {
  blob: Blob;
  durationSec: number;
  sizeBytes: number;
  cleanup: () => Promise<void>;
}

/**
 * Compress an arbitrary audio/video input into 32 kbps Opus mono 16 kHz with
 * silences > 2s collapsed. Output is a single file in /tmp.
 *
 * Caller must invoke `cleanup()` when done reading the blob (typically in a
 * try/finally).
 */
export async function compressAudio(
  inputBlob: Blob,
  originalFileName: string,
): Promise<CompressedAudio> {
  const ext = originalFileName.split('.').pop()?.toLowerCase() ?? 'bin';
  const inputPath = await writeBlobToTmp(inputBlob, `.${ext}`);
  const outputPath = join(tmpdir(), `transcribe-${randomUUID()}.ogg`);

  try {
    // ffmpeg runs roughly 20–100× real-time for audio-only transcoding on
    // modern servers; 20 minutes covers 4 hours of input comfortably.
    await runFfmpeg(
      FFMPEG_BIN,
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
    );

    const [durationSec, stat] = await Promise.all([
      probeDurationSec(outputPath),
      fs.stat(outputPath),
    ]);

    const blob = await readTmpAsBlob(outputPath, 'audio/ogg');
    return {
      blob,
      durationSec,
      sizeBytes: stat.size,
      cleanup: () => cleanupTmp([inputPath, outputPath]),
    };
  } catch (err) {
    await cleanupTmp([inputPath, outputPath]);
    throw err;
  }
}

export interface AudioChunk {
  blob: Blob;
  durationSec: number;
  index: number;
}

/**
 * Stream-copy split a compressed opus file into chunks of at most
 * CHUNK_DURATION_SEC (90 minutes). No re-encoding: output is instant.
 *
 * Returns chunks sorted by start time, plus a single cleanup function that
 * removes all chunk files. Input path is the CompressedAudio source — caller
 * is responsible for its cleanup.
 */
export async function chunkCompressedAudio(
  compressedBlob: Blob,
): Promise<{ chunks: AudioChunk[]; cleanup: () => Promise<void> }> {
  const inputPath = await writeBlobToTmp(compressedBlob, '.ogg');
  const outputDir = join(tmpdir(), `transcribe-chunks-${randomUUID()}`);
  await fs.mkdir(outputDir, { recursive: true });

  try {
    await runFfmpeg(
      FFMPEG_BIN,
      [
        '-y',
        '-i',
        inputPath,
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
    );

    const entries = (await fs.readdir(outputDir))
      .filter((name) => name.startsWith('chunk-') && name.endsWith('.ogg'))
      .sort();

    const chunks: AudioChunk[] = [];
    for (let i = 0; i < entries.length; i++) {
      const path = join(outputDir, entries[i]);
      const durationSec = await probeDurationSec(path);
      const blob = await readTmpAsBlob(path, 'audio/ogg');
      chunks.push({ blob, durationSec, index: i });
    }

    const allPaths = [
      inputPath,
      ...entries.map((name) => join(outputDir, name)),
    ];
    return {
      chunks,
      cleanup: async () => {
        await cleanupTmp(allPaths);
        await fs
          .rm(outputDir, { force: true, recursive: true })
          .catch(() => {});
      },
    };
  } catch (err) {
    await cleanupTmp([inputPath]);
    await fs.rm(outputDir, { force: true, recursive: true }).catch(() => {});
    throw err;
  }
}

/** Threshold at which chunking kicks in. Leave a 1 MB safety margin under
 * OpenAI's 25 MB hard limit. */
export const CHUNK_TRIGGER_BYTES = 24 * 1024 * 1024;
