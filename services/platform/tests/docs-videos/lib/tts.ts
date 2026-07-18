/**
 * ElevenLabs narration synthesis for the docs video pipeline.
 *
 * Every generation is cached under `.state/tts-cache/` keyed by a content
 * hash of (model, voice, text, settings, context) — the account bills per
 * character, so an unchanged scene must NEVER re-bill across runs. The cache
 * also pins narration durations, which the planned timeline (timeline.ts)
 * builds on: re-recording a video without changing a script re-uses both the
 * audio and its measured length.
 *
 * Model: `eleven_v3` (the flagship expressive model — 70+ languages, audio
 * tags, discrete stability), probed at run start and falling back to
 * `eleven_multilingual_v2` when the account lacks v3 access.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ffmpegBin, probeDurationMs, runFfmpeg } from './ffmpeg';

const API_BASE = 'https://api.elevenlabs.io';
const PREFERRED_MODEL = 'eleven_v3';
const FALLBACK_MODEL = 'eleven_multilingual_v2';
/** 128 kbps is the ceiling below the Creator tier — and transparent for a
 * single narration voice (the final AAC mux gains nothing above it). */
const OUTPUT_FORMAT = 'mp3_44100_128';
/** v3's stability is discrete: 0 Creative / 0.5 Natural / 1 Robust. Natural
 * keeps narration steady while still honouring sparing audio tags. */
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 } as const;
/** Fixed seed so an unchanged script re-synthesizes deterministically. */
const SEED = 4242;
const MAX_ATTEMPTS = 3;

export function elevenLabsApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set. Put it in the gitignored root .env.dev ' +
        '(loaded by the pipeline via lib/dev-env.ts); never commit it.',
    );
  }
  return key;
}

let resolvedModel: string | null = null;

/** Probe the account's model catalog once per run; prefer eleven_v3. */
export async function resolveTtsModel(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  const res = await fetch(`${API_BASE}/v1/models`, {
    headers: { 'xi-api-key': elevenLabsApiKey() },
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs /v1/models failed: HTTP ${res.status}`);
  }
  const models = (await res.json()) as Array<{
    model_id: string;
    can_do_text_to_speech: boolean;
  }>;
  const usable = new Set(
    models.filter((m) => m.can_do_text_to_speech).map((m) => m.model_id),
  );
  resolvedModel = usable.has(PREFERRED_MODEL)
    ? PREFERRED_MODEL
    : FALLBACK_MODEL;
  if (resolvedModel !== PREFERRED_MODEL) {
    console.warn(
      `ElevenLabs: ${PREFERRED_MODEL} unavailable on this key — using ${resolvedModel}.`,
    );
  }
  return resolvedModel;
}

interface SynthesisRequest {
  readonly text: string;
  readonly voiceId: string;
  /** Neighbouring narration for prosody continuity across scenes. */
  readonly previousText?: string;
  readonly nextText?: string;
}

interface SynthesisResult {
  readonly mp3Path: string;
  readonly durationMs: number;
  readonly cached: boolean;
  readonly characters: number;
}

interface CacheSidecar {
  readonly durationMs: number;
  readonly model: string;
  readonly voiceId: string;
  readonly characters: number;
}

/**
 * Cache key of one per-scene generation. BYTE-STABLE CONTRACT: the JSON
 * field set, order, and constant values must never change — every cached
 * mp3 under `.state/tts-cache/` is keyed by this, and a drifted key
 * re-bills the entire back catalog (pinned by tts-cache-key.test.ts).
 */
export function sceneCacheKey(
  model: string,
  request: SynthesisRequest,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        model,
        voiceId: request.voiceId,
        text: request.text,
        previousText: request.previousText ?? '',
        nextText: request.nextText ?? '',
        settings: VOICE_SETTINGS,
        seed: SEED,
        format: OUTPUT_FORMAT,
      }),
    )
    .digest('hex');
}

async function requestSpeech(
  model: string,
  request: SynthesisRequest,
): Promise<ArrayBuffer> {
  const url = `${API_BASE}/v1/text-to-speech/${request.voiceId}?output_format=${OUTPUT_FORMAT}`;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: request.text,
        model_id: model,
        voice_settings: VOICE_SETTINGS,
        seed: SEED,
        previous_text: request.previousText,
        next_text: request.nextText,
      }),
    });
    if (res.ok) return await res.arrayBuffer();
    lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    // Only transient statuses are worth retrying; a 4xx re-bills identically.
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(
    `ElevenLabs synthesis failed for voice ${request.voiceId}: ${lastError}`,
  );
}

/**
 * Synthesize one narration segment, cache-first. `stateDir` is the pipeline's
 * `.state/` directory; audio lands in `<stateDir>/tts-cache/<sha>.mp3` with a
 * `.json` sidecar carrying the measured duration.
 */
export async function synthesize(
  request: SynthesisRequest,
  stateDir: string,
): Promise<SynthesisResult> {
  const model = await resolveTtsModel();
  // eleven_v3 rejects previous_text/next_text (API: unsupported_model).
  // Strip them BEFORE the cache key so a neighbour-scene edit never
  // invalidates (and re-bills) this scene under v3.
  const effective: SynthesisRequest =
    model === PREFERRED_MODEL
      ? { text: request.text, voiceId: request.voiceId }
      : request;
  const key = sceneCacheKey(model, effective);
  const cacheDir = path.join(stateDir, 'tts-cache');
  const mp3Path = path.join(cacheDir, `${key}.mp3`);
  const sidecarPath = path.join(cacheDir, `${key}.json`);

  if (existsSync(mp3Path) && existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(
        readFileSync(sidecarPath, 'utf8'),
      ) as CacheSidecar;
      return {
        mp3Path,
        durationMs: sidecar.durationMs,
        cached: true,
        characters: 0,
      };
    } catch (error) {
      console.warn(
        `Regenerating unreadable TTS sidecar ${sidecarPath}:`,
        error,
      );
    }
  }

  const audio = await requestSpeech(model, effective);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(mp3Path, Buffer.from(audio));
  const durationMs = await probeDurationMs(mp3Path);
  if (durationMs <= 0) {
    throw new Error(
      `Synthesized audio for voice ${request.voiceId} has no measurable duration (${mp3Path})`,
    );
  }
  const sidecar: CacheSidecar = {
    durationMs,
    model,
    voiceId: request.voiceId,
    characters: request.text.length,
  };
  writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  return {
    mp3Path,
    durationMs,
    cached: false,
    characters: request.text.length,
  };
}

interface CharacterAlignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}

/** One scene's slice of a whole-episode generation. */
interface EpisodeSliceResult {
  readonly mp3Path: string;
  readonly durationMs: number;
  readonly cached: boolean;
}

/** Silence kept around each slice so cuts never clip a syllable. */
const SLICE_LEAD_SEC = 0.08;
const SLICE_TAIL_SEC = 0.15;

/**
 * Cache key of one whole-episode generation. Same byte-stability contract
 * as `sceneCacheKey` (pinned by tts-cache-key.test.ts).
 */
export function wholeEpisodeCacheKey(
  model: string,
  voiceId: string,
  joined: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'whole-episode-v1',
        model,
        voiceId,
        joined,
        settings: VOICE_SETTINGS,
        seed: SEED,
        format: OUTPUT_FORMAT,
      }),
    )
    .digest('hex');
}

/**
 * Synthesize a whole episode's narration as ONE generation and slice it into
 * per-scene mp3s via the character-timestamp alignment. One generation means
 * one consistent delivery — per-scene generations audibly drift in tone
 * (eleven_v3 rejects previous_text/next_text, so this is the only way to give
 * it cross-scene context). Empty texts (silent scenes) come back as empty
 * slices. Cache-first like `synthesize`: an unchanged SCRIPT is free, any
 * edit re-bills the whole episode's locale.
 */
export async function synthesizeEpisodeWhole(
  texts: readonly string[],
  voiceId: string,
  stateDir: string,
): Promise<{ slices: EpisodeSliceResult[]; billedCharacters: number }> {
  const model = await resolveTtsModel();
  const spoken = texts.map((t) => t.trim());
  const joined = spoken.filter(Boolean).join('\n\n');
  const key = wholeEpisodeCacheKey(model, voiceId, joined);
  const cacheDir = path.join(stateDir, 'tts-cache');
  const wholePath = path.join(cacheDir, `${key}.whole.mp3`);
  const sidecarPath = path.join(cacheDir, `${key}.whole.json`);

  interface WholeSidecar {
    readonly slices: readonly { file: string; durationMs: number }[];
  }
  if (existsSync(wholePath) && existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(
        readFileSync(sidecarPath, 'utf8'),
      ) as WholeSidecar;
      return {
        billedCharacters: 0,
        slices: sidecar.slices.map((slice) => ({
          mp3Path: slice.file ? path.join(cacheDir, slice.file) : '',
          durationMs: slice.durationMs,
          cached: true,
        })),
      };
    } catch (error) {
      console.warn(`Regenerating unreadable whole-take sidecar:`, error);
    }
  }

  // One request for the full script, with character-level timestamps.
  const url = `${API_BASE}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
  interface WholeTakeResponse {
    readonly audio_base64: string;
    readonly alignment: CharacterAlignment;
  }
  let payload: WholeTakeResponse | null = null;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: joined,
        model_id: model,
        voice_settings: VOICE_SETTINGS,
        seed: SEED,
      }),
    });
    if (res.ok) {
      payload = (await res.json()) as WholeTakeResponse;
      break;
    }
    lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  if (!payload?.audio_base64 || !payload.alignment) {
    throw new Error(
      `Whole-episode synthesis failed: ${lastError || 'no alignment returned'}`,
    );
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(wholePath, Buffer.from(payload.audio_base64, 'base64'));

  const alignment = payload.alignment;
  const totalSec =
    alignment.character_end_times_seconds[
      alignment.character_end_times_seconds.length - 1
    ] ?? 0;

  // Locate each scene's character span inside `joined` and cut around it.
  const slices: EpisodeSliceResult[] = [];
  const sidecarSlices: { file: string; durationMs: number }[] = [];
  let cursor = 0;
  let previousEndSec = 0;
  for (const [index, text] of spoken.entries()) {
    if (!text) {
      slices.push({ mp3Path: '', durationMs: 0, cached: false });
      sidecarSlices.push({ file: '', durationMs: 0 });
      continue;
    }
    const start = joined.indexOf(text, cursor);
    if (start < 0) {
      throw new Error(`Scene ${index} text not found in the joined script`);
    }
    const end = start + text.length - 1;
    cursor = start + text.length;
    const startSec = Math.max(
      previousEndSec,
      (alignment.character_start_times_seconds[start] ?? 0) - SLICE_LEAD_SEC,
    );
    const endSec = Math.min(
      totalSec,
      (alignment.character_end_times_seconds[end] ?? totalSec) + SLICE_TAIL_SEC,
    );
    previousEndSec = endSec;
    const file = `${key}.scene-${index}.mp3`;
    const slicePath = path.join(cacheDir, file);
    await runFfmpeg(
      ffmpegBin(),
      [
        '-y',
        '-i',
        wholePath,
        '-ss',
        startSec.toFixed(3),
        '-to',
        endSec.toFixed(3),
        '-c:a',
        'libmp3lame',
        '-q:a',
        '2',
        slicePath,
      ],
      60_000,
    );
    const durationMs = await probeDurationMs(slicePath);
    if (durationMs <= 0) {
      throw new Error(`Slice ${index} has no measurable duration`);
    }
    slices.push({ mp3Path: slicePath, durationMs, cached: false });
    sidecarSlices.push({ file, durationMs });
  }
  writeFileSync(
    sidecarPath,
    `${JSON.stringify({ slices: sidecarSlices }, null, 2)}\n`,
  );
  return { slices, billedCharacters: joined.length };
}
