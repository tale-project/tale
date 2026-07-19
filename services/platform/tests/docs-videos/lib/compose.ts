/**
 * The compose stage: variable-rate screencast frames + planned narration
 * offsets → one constant-30fps H.264 mp4 with loudness-normalized audio,
 * a WebVTT caption track, and a poster.
 *
 * Before anything is encoded, the drift gate runs: every scene's ACTUAL start
 * (recorded by recorder.ts) must sit within MAX_DRIFT_MS of its plan, or the
 * compose refuses — audio is placed at the PLANNED offsets, so plan drift is
 * exactly A/V desync.
 *
 * Video assembly: ffmpeg's concat demuxer with per-frame durations from the
 * screencast timestamps (the demuxer needs the final file repeated so the
 * last duration applies), then `fps=30` resamples to CFR — a hold-last-frame
 * conversion with no interpolation artifacts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { encodeWebp } from '../../docs-screenshots/webp';
import { readAudioPlan } from './audio-plan';
import type { EpisodeSpec, Locale } from './episode';
import { narrationFor } from './episode';
import {
  ffmpegBin,
  probeAudioStream,
  probeDurationMs,
  runFfmpeg,
} from './ffmpeg';
import { DOCS_PUBLIC_DIR } from './paths';
import { framesDir, timelinePath, type RecordedTimeline } from './recorder';
import { writeReviewSheet } from './review';
import { driftReport, driftViolations, MAX_DRIFT_MS } from './timeline';
import { verifyComposedEpisode } from './verify';
import { upsertVideoManifest, type VideoManifestEntry } from './video-manifest';

const FPS = 30;
const OUT_WIDTH = 1920;
const OUT_HEIGHT = 1080;
/** Draft encodes trade fidelity for loop speed: 720p, fast preset. */
const DRAFT_WIDTH = 1280;
const DRAFT_HEIGHT = 720;
/** Ten minutes of encode budget — episodes are minutes long, 4K input. */
const ENCODE_TIMEOUT_MS = 10 * 60 * 1000;

interface ComposeOptions {
  /**
   * Fast low-res encode into `.state/out/` for review — never touches the
   * docs tree, the poster, or the manifest.
   */
  readonly draft?: boolean;
  /** Post-encode A/V verification (duration + speech coverage). Default on. */
  readonly verify?: boolean;
}

interface FramesLog {
  readonly frames: readonly { file: string; tMs: number }[];
}

/** Concat-demuxer playlist with per-frame durations, last frame held. */
function buildConcatList(frames: FramesLog['frames'], totalMs: number): string {
  if (frames.length === 0) throw new Error('No frames were recorded');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const current = frames[i];
    if (!current) continue;
    const nextTMs = frames[i + 1]?.tMs ?? Math.max(totalMs, current.tMs + 33);
    const durationSec = Math.max(nextTMs - current.tMs, 1) / 1000;
    lines.push(`file '${current.file}'`, `duration ${durationSec.toFixed(4)}`);
  }
  const last = frames.at(-1);
  if (last) lines.push(`file '${last.file}'`);
  return `${lines.join('\n')}\n`;
}

function assertDrift(recorded: RecordedTimeline): void {
  const report = driftReport(
    recorded.planned,
    new Map(Object.entries(recorded.actualStartsMs)),
  );
  const violations = driftViolations(report);
  for (const entry of report) {
    const marker = Math.abs(entry.driftMs) > MAX_DRIFT_MS ? '✗' : '✓';
    console.log(
      `  ${marker} ${entry.id}: planned ${entry.plannedMs}ms, actual ${entry.actualMs}ms (drift ${entry.driftMs > 0 ? '+' : ''}${entry.driftMs}ms)`,
    );
  }
  if (violations.length > 0) {
    throw new Error(
      `A/V drift gate failed for ${violations.length} scene(s): ` +
        violations
          .map((v) => `${v.id} ${v.driftMs > 0 ? '+' : ''}${v.driftMs}ms`)
          .join(', ') +
        ` (budget ±${MAX_DRIFT_MS}ms). Re-record — do not ship a desynced cut.`,
    );
  }
}

export async function runComposeStage(
  episode: EpisodeSpec,
  locale: Locale,
  stateDir: string,
  options: ComposeOptions = {},
): Promise<void> {
  const draft = options.draft ?? false;
  const audioPlan = readAudioPlan(stateDir, episode.id, locale);
  // Estimated (mock) narration re-plans differently from the real audio —
  // it must never reach the docs tree. Draft and diagnostic output stays
  // in `.state/`, so rehearsal takes remain fully composable.
  if (audioPlan.estimated && !draft && !episode.diagnostic) {
    throw new Error(
      `${episode.id}/${locale}: the audio plan is --mock-tts rehearsal silence — ` +
        `compose with --draft, or run --stage tts (real narration) and re-record first.`,
    );
  }
  const tlPath = timelinePath(stateDir, episode.id, locale);
  if (!existsSync(tlPath)) {
    throw new Error(`No recording at ${tlPath} — run --stage record first.`);
  }
  const recorded = JSON.parse(readFileSync(tlPath, 'utf8')) as RecordedTimeline;
  const dir = framesDir(stateDir, episode.id, locale);
  const framesLog = JSON.parse(
    readFileSync(path.join(dir, 'frames.json'), 'utf8'),
  ) as FramesLog;

  console.log(
    `Compose ${episode.id}/${locale}${draft ? ' (draft)' : ''}: drift gate…`,
  );
  assertDrift(recorded);

  const totalMs = recorded.planned.totalMs;
  const concatPath = path.join(dir, 'frames.txt');
  writeFileSync(concatPath, buildConcatList(framesLog.frames, totalMs));

  const outDir =
    draft || episode.diagnostic
      ? path.join(stateDir, 'out')
      : path.join(
          DOCS_PUBLIC_DIR,
          'videos',
          locale,
          episode.section,
          episode.id,
        );
  mkdirSync(outDir, { recursive: true });
  const baseName = `${episode.id}.${locale}${draft ? '.draft' : ''}`;
  const mp4Path = path.join(outDir, `${baseName}.mp4`);
  const outWidth = draft ? DRAFT_WIDTH : OUT_WIDTH;
  const outHeight = draft ? DRAFT_HEIGHT : OUT_HEIGHT;

  // Narrated scenes → audio inputs placed at their planned offsets.
  const narrated = recorded.planned.scenes
    .map((scene) => ({
      scene,
      audio: audioPlan.scenes.find((s) => s.id === scene.id),
    }))
    .filter((entry) => (entry.audio?.durationMs ?? 0) > 0);

  const inputArgs: string[] = ['-f', 'concat', '-safe', '0', '-i', concatPath];
  for (const entry of narrated) {
    inputArgs.push('-i', entry.audio?.mp3Path ?? '');
  }

  // A gentle fade in from black and out to black bookend every episode. The
  // outro scene's tail carries the room the fade-out needs (episode spec).
  const fadeOutStartSec = Math.max(totalMs / 1000 - 1.5, 0);
  const filters: string[] = [
    `[0:v]fps=${FPS},scale=${outWidth}:${outHeight}:flags=lanczos,format=yuv420p,` +
      `fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=1.5[v]`,
  ];
  const audioLabels: string[] = [];
  narrated.forEach((entry, index) => {
    const delay = entry.scene.narrationStartMs;
    filters.push(`[${index + 1}:a]adelay=${delay}|${delay}[a${index}]`);
    audioLabels.push(`[a${index}]`);
  });
  const mapArgs = ['-map', '[v]'];
  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0,` +
        `loudnorm=I=-16:TP=-1.5:LRA=11,` +
        // loudnorm upsamples to 192 kHz internally; without an explicit
        // resample the AAC track lands at 96 kHz, which ffmpeg decodes fine
        // but QuickTime and browser audio pipelines play as SILENCE.
        `aresample=44100,` +
        `afade=t=out:st=${Math.max(totalMs / 1000 - 1.5, 0).toFixed(3)}:d=1.5[a]`,
    );
    mapArgs.push('-map', '[a]');
  }

  console.log(
    `  encoding ${baseName}.mp4 (${framesLog.frames.length} frames)…`,
  );
  await runFfmpeg(
    ffmpegBin(),
    [
      '-y',
      ...inputArgs,
      '-filter_complex',
      filters.join(';'),
      ...mapArgs,
      '-t',
      (totalMs / 1000).toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      draft ? 'veryfast' : 'medium',
      '-crf',
      draft ? '30' : '20',
      '-maxrate',
      '3M',
      '-bufsize',
      '6M',
      ...(audioLabels.length > 0 ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-movflags',
      '+faststart',
      mp4Path,
    ],
    ENCODE_TIMEOUT_MS,
  );

  // Captions from the narration scripts at the same planned offsets.
  const { buildVtt, narrationToCues } = await import('./vtt');
  const cues = recorded.planned.scenes.flatMap((scene) => {
    const audio = audioPlan.scenes.find((s) => s.id === scene.id);
    if (!audio || audio.durationMs <= 0) return [];
    return narrationToCues(
      narrationFor(episode, scene.id, locale),
      scene.narrationStartMs,
      audio.durationMs,
    );
  });
  const vttPath = path.join(outDir, `${baseName}.vtt`);
  writeFileSync(vttPath, buildVtt(cues));

  // Poster: the fully revealed title card (mid-title-scene frame). Drafts
  // skip it — nothing in the review loop needs a webp.
  let poster: Awaited<ReturnType<typeof encodeWebp>> | null = null;
  let posterPath = '';
  if (!draft) {
    const titleScene = recorded.planned.scenes[0];
    const posterAtSec = titleScene
      ? (titleScene.startMs + titleScene.budgetMs * 0.6) / 1000
      : 1;
    const posterPngPath = path.join(dir, 'poster.png');
    await runFfmpeg(
      ffmpegBin(),
      [
        '-y',
        '-ss',
        posterAtSec.toFixed(3),
        '-i',
        mp4Path,
        '-frames:v',
        '1',
        posterPngPath,
      ],
      60_000,
    );
    poster = await encodeWebp(
      readFileSync(posterPngPath),
      `${baseName} poster`,
    );
    posterPath = path.join(outDir, `${baseName}.webp`);
    writeFileSync(posterPath, poster.bytes);
  }

  const mp4DurationMs = await probeDurationMs(mp4Path);
  // Playback-compatibility gate: ffmpeg happily DECODES exotic tracks its own
  // encoder produced, so "sounded fine in analysis" proves nothing — assert
  // the shipped container carries a track real players decode (a 96 kHz AAC
  // from an unresampled loudnorm output plays as silence in browsers).
  if (narrated.length > 0) {
    const audio = await probeAudioStream(mp4Path);
    if (!audio) {
      throw new Error(`${baseName}.mp4 has no audio stream — compose bug.`);
    }
    if (audio.sampleRate > 48_000) {
      throw new Error(
        `${baseName}.mp4 audio is ${audio.sampleRate} Hz ${audio.codec} — browsers play >48 kHz AAC ` +
          `as silence; keep the aresample=44100 stage in the filter chain.`,
      );
    }
  }
  // Automated watch-check: composed duration vs plan + audible speech over
  // every narrated window — a silent track or a global offset never ships
  // (nor survives a draft loop) unheard.
  if (options.verify ?? true) {
    const issues = await verifyComposedEpisode(mp4Path, recorded, audioPlan, {
      audioIsSilent: audioPlan.estimated ?? false,
    });
    if (issues.length > 0) {
      throw new Error(
        `A/V verification failed for ${baseName}.mp4:\n` +
          issues
            .map((issue) => `  ✗ ${issue.where} — ${issue.detail}`)
            .join('\n') +
          `\n(--no-verify skips the gate; a silent or desynced cut must never ship.)`,
      );
    }
    console.log(
      `  ✓ verified — duration on plan${audioPlan.estimated ? '' : ', every narration window audible'}`,
    );
  }

  const mp4SizeMb = readFileSync(mp4Path).byteLength / 1024 / 1024;
  const sheetPath = await writeReviewSheet({
    episode,
    locale,
    mp4Path,
    recorded,
    audioPlan,
    stateDir,
    draft,
    durationMs: mp4DurationMs,
    sizeMb: mp4SizeMb,
  });
  console.log(
    `  ✓ ${baseName}.mp4 — ${(mp4DurationMs / 1000).toFixed(1)}s, ${mp4SizeMb.toFixed(1)} MB, ` +
      `${cues.length} caption cues${poster ? `, poster ${poster.width}×${poster.height} q${poster.quality}` : ''}`,
  );
  console.log(`  ✓ review sheet → ${sheetPath}`);

  if (!draft && !episode.diagnostic) {
    const relative = (file: string) =>
      path.relative(DOCS_PUBLIC_DIR, file).split(path.sep).join('/');
    const entries: VideoManifestEntry[] = [
      {
        file: relative(mp4Path),
        episode: episode.id,
        locale,
        kind: 'video',
        durationSec: Math.round(mp4DurationMs / 100) / 10,
        width: OUT_WIDTH,
        height: OUT_HEIGHT,
      },
      {
        file: relative(vttPath),
        episode: episode.id,
        locale,
        kind: 'captions',
        durationSec: Math.round(mp4DurationMs / 100) / 10,
      },
      ...(poster
        ? [
            {
              file: relative(posterPath),
              episode: episode.id,
              locale,
              kind: 'poster',
              width: poster.width,
              height: poster.height,
            } satisfies VideoManifestEntry,
          ]
        : []),
    ];
    upsertVideoManifest(DOCS_PUBLIC_DIR, entries);
    console.log(`  ✓ manifest updated (${entries.length} entries)`);
  }
}
