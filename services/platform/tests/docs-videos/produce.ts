/**
 * Docs tutorial-video producer. Every committed video under
 * `services/docs/public/videos/` is produced by this script from a declarative
 * episode spec (`episodes/<id>/episode.ts`) — no hand-recorded video ever
 * ships (the doctrine lives in the `produce-video` skill).
 *
 *   bun run docs:videos                                   # ep1, en, all stages
 *   bun run docs:videos -- --episode ep1-welcome --locale en,de,fr
 *   bun run docs:videos -- --stage tts                    # narration only
 *   bun run docs:videos -- --stage record                 # needs the Mode-A stack
 *   bun run docs:videos -- --stage compose                # ffmpeg assembly only
 *   bun run docs:videos -- --list                         # enumerate episodes
 *   bun run docs:videos -- --audition                     # voice candidates → .state/audition/
 *
 * Stages are separable on purpose: TTS bills per character (cache-first,
 * `lib/tts.ts`), recording needs the running docs-demo stack (same runbook as
 * docs:screenshots — see README.md), compose needs only ffmpeg. The narration
 * audio plan produced by `tts` (`.state/tts/<episode>.<locale>.json`) is the
 * contract the other two stages build on.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EP1_WELCOME } from './episodes/ep1-welcome/episode';
import { EP2_CHAT } from './episodes/ep2-chat/episode';
import { SPIKE_SYNC } from './episodes/spike-sync/episode';
import { audioPlanPath, type AudioPlan } from './lib/audio-plan';
import { loadDevEnv } from './lib/dev-env';
import {
  LOCALES,
  narrationFor,
  type EpisodeSpec,
  type Locale,
} from './lib/episode';
import { ensureFfmpegAvailable } from './lib/ffmpeg';
import {
  elevenLabsApiKey,
  resolveTtsModel,
  synthesize,
  synthesizeEpisodeWhole,
} from './lib/tts';
import { toSpokenText } from './lib/tts-text';

// Dev-tooling secrets live in the repo-root `.env.dev` (never the platform's
// own env files) — load them before anything reads process.env.
loadDevEnv();

const EPISODES: readonly EpisodeSpec[] = [EP1_WELCOME, EP2_CHAT, SPIKE_SYNC];

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const STATE_DIR = path.join(HERE, '.state');

type Stage = 'tts' | 'record' | 'compose' | 'all';

interface CliArgs {
  episode: string;
  locales: Locale[];
  stage: Stage;
  list: boolean;
  audition: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    episode: 'ep1-welcome',
    locales: ['en'],
    stage: 'all',
    list: false,
    audition: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') args.list = true;
    else if (arg === '--audition') args.audition = true;
    else if (arg === '--episode') args.episode = argv[++i] ?? '';
    else if (arg === '--stage') args.stage = (argv[++i] ?? 'all') as Stage;
    else if (arg === '--locale') {
      const requested = (argv[++i] ?? '').split(',').filter(Boolean);
      const invalid = requested.filter((l) => !LOCALES.includes(l as Locale));
      if (invalid.length > 0) {
        throw new Error(
          `Unknown locale(s): ${invalid.join(', ')} (valid: ${LOCALES.join(', ')})`,
        );
      }
      args.locales = requested as Locale[];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['tts', 'record', 'compose', 'all'].includes(args.stage)) {
    throw new Error(`Unknown stage: ${args.stage}`);
  }
  return args;
}

function findEpisode(id: string): EpisodeSpec {
  const episode = EPISODES.find((e) => e.id === id);
  if (!episode) {
    throw new Error(
      `Unknown episode "${id}". Known: ${EPISODES.map((e) => e.id).join(', ')}`,
    );
  }
  return episode;
}

/**
 * Synthesize every scene's narration for one locale, cache-first, passing
 * neighbouring scene texts as previous/next context so prosody flows across
 * cuts. Writes the audio plan JSON.
 */
async function runTtsStage(
  episode: EpisodeSpec,
  locale: Locale,
): Promise<void> {
  const voiceId = episode.voices[locale];
  const model = await resolveTtsModel();
  // The synthesizer gets the SPOKEN respelling (brand pronunciation etc.);
  // captions and the episode spec keep the written form.
  const texts = episode.scenes.map((scene) =>
    toSpokenText(narrationFor(episode, scene.id, locale), locale),
  );
  const planScenes: AudioPlan['scenes'][number][] = [];
  let billed = 0;
  let cachedCount = 0;
  if (episode.wholeTakeLocales?.includes(locale)) {
    // One generation for the whole episode → consistent delivery; sliced
    // into per-scene mp3s by character timestamps.
    const whole = await synthesizeEpisodeWhole(texts, voiceId, STATE_DIR);
    billed = whole.billedCharacters;
    for (const [index, scene] of episode.scenes.entries()) {
      const slice = whole.slices[index];
      if (!slice || !slice.mp3Path) {
        planScenes.push({ id: scene.id, mp3Path: '', durationMs: 0 });
        console.log(`  ∅ ${locale}/${scene.id} — silent`);
        continue;
      }
      if (slice.cached) cachedCount += 1;
      planScenes.push({
        id: scene.id,
        mp3Path: slice.mp3Path,
        durationMs: slice.durationMs,
      });
      console.log(
        `  ${slice.cached ? '≡' : '♪'} ${locale}/${scene.id} — ${(slice.durationMs / 1000).toFixed(1)}s (whole take${slice.cached ? ', cached' : ''})`,
      );
    }
    const wholePlan: AudioPlan = {
      episodeId: episode.id,
      locale,
      voiceId,
      model,
      scenes: planScenes,
    };
    mkdirSync(path.dirname(audioPlanPath(STATE_DIR, episode.id, locale)), {
      recursive: true,
    });
    writeFileSync(
      audioPlanPath(STATE_DIR, episode.id, locale),
      `${JSON.stringify(wholePlan, null, 2)}\n`,
    );
    const wholeTotal = planScenes.reduce((sum, s) => sum + s.durationMs, 0);
    console.log(
      `TTS ${episode.id}/${locale}: ${planScenes.length} scenes, ${(wholeTotal / 1000).toFixed(1)}s narration (single take), ` +
        `${billed} characters billed.`,
    );
    return;
  }
  for (const [index, scene] of episode.scenes.entries()) {
    const text = texts[index] ?? '';
    if (!text.trim()) {
      // Deliberately silent scene — nothing to synthesize.
      planScenes.push({ id: scene.id, mp3Path: '', durationMs: 0 });
      console.log(`  ∅ ${locale}/${scene.id} — silent`);
      continue;
    }
    const result = await synthesize(
      {
        text,
        voiceId,
        previousText: texts[index - 1],
        nextText: texts[index + 1],
      },
      STATE_DIR,
    );
    billed += result.characters;
    if (result.cached) cachedCount += 1;
    planScenes.push({
      id: scene.id,
      mp3Path: result.mp3Path,
      durationMs: result.durationMs,
    });
    console.log(
      `  ${result.cached ? '≡' : '♪'} ${locale}/${scene.id} — ${(result.durationMs / 1000).toFixed(1)}s${result.cached ? ' (cached)' : ''}`,
    );
  }
  const plan: AudioPlan = {
    episodeId: episode.id,
    locale,
    voiceId,
    model,
    scenes: planScenes,
  };
  mkdirSync(path.dirname(audioPlanPath(STATE_DIR, episode.id, locale)), {
    recursive: true,
  });
  writeFileSync(
    audioPlanPath(STATE_DIR, episode.id, locale),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  const total = planScenes.reduce((sum, s) => sum + s.durationMs, 0);
  console.log(
    `TTS ${episode.id}/${locale}: ${planScenes.length} scenes, ${(total / 1000).toFixed(1)}s narration, ` +
      `${cachedCount} cached, ${billed} characters billed.`,
  );
}

/** Voice-audition candidates; samples double as future cache warmup. */
const AUDITION: ReadonlyArray<{
  locale: Locale;
  name: string;
  voiceId: string;
  sample: string;
}> = [
  {
    locale: 'en',
    name: 'alice',
    voiceId: 'Xb7hH8MSUJpSbSDYk0k2',
    sample:
      'Because here is the honest truth about language models: without your context, they answer anyway — fluently, confidently, and sometimes wrong. That is a hallucination. Grounding every answer in your own documents turns AI from a smooth talker into a colleague you can verify.',
  },
  {
    locale: 'en',
    name: 'bella',
    voiceId: 'hpp4J3VqNfWAUOO0d1Us',
    sample:
      'Because here is the honest truth about language models: without your context, they answer anyway — fluently, confidently, and sometimes wrong. That is a hallucination. Grounding every answer in your own documents turns AI from a smooth talker into a colleague you can verify.',
  },
  {
    locale: 'de',
    name: 'carla',
    voiceId: 'rKiu7lQ4c5P3az3745s3',
    sample:
      'Willkommen bei Tale. Hier arbeiten Teams mit KI an echten Aufgaben: Chat über die eigenen Dokumente, Agenten mit klarem Auftrag und Automatisierungen unter menschlicher Kontrolle.',
  },
  {
    locale: 'fr',
    name: 'koraly',
    voiceId: 'QbsdzCokdlo98elkq4Pc',
    sample:
      'Bienvenue dans Tale. Les équipes y travaillent avec l’IA sur de vraies tâches : conversations appuyées sur les documents de l’entreprise, agents avec un mandat clair et automatisations sous contrôle humain.',
  },
];

async function runAudition(): Promise<void> {
  const outDir = path.join(STATE_DIR, 'audition');
  mkdirSync(outDir, { recursive: true });
  for (const candidate of AUDITION) {
    const result = await synthesize(
      { text: candidate.sample, voiceId: candidate.voiceId },
      STATE_DIR,
    );
    const target = path.join(
      outDir,
      `${candidate.locale}-${candidate.name}.mp3`,
    );
    writeFileSync(target, readFileSync(result.mp3Path));
    console.log(
      `♪ ${candidate.locale}/${candidate.name} → ${target} (${(result.durationMs / 1000).toFixed(1)}s${result.cached ? ', cached' : ''})`,
    );
  }
  console.log(
    '\nListen to the samples above, then pin the winners in the episode spec (voices map).',
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const episode of EPISODES) {
      const locales = LOCALES.filter((l) =>
        episode.scenes.every((s) => s.narration[l]),
      );
      console.log(
        `${episode.id}  [${episode.section}]  ${episode.scenes.length} scenes, narration ready: ${locales.join(', ') || '—'}`,
      );
    }
    return;
  }

  await ensureFfmpegAvailable();
  elevenLabsApiKey();

  if (args.audition) {
    await runAudition();
    return;
  }

  const episode = findEpisode(args.episode);
  for (const locale of args.locales) {
    if (args.stage === 'tts' || args.stage === 'all') {
      await runTtsStage(episode, locale);
    }
    if (args.stage === 'record' || args.stage === 'all') {
      const { runRecordStage } = await import('./lib/recorder');
      await runRecordStage(episode, locale, STATE_DIR);
    }
    if (args.stage === 'compose' || args.stage === 'all') {
      const { runComposeStage } = await import('./lib/compose');
      await runComposeStage(episode, locale, STATE_DIR);
    }
  }
}

main().catch((error) => {
  console.error('docs:videos failed:', error);
  process.exit(1);
});
