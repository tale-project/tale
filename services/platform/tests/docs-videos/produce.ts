/**
 * Docs tutorial-video producer. Every committed video under
 * `services/docs/public/videos/` is produced by this script from a declarative
 * episode spec (`episodes/<id>/episode.ts`) — no hand-recorded video ever
 * ships (the doctrine lives in the `produce-video` skill, the runbook in
 * README.md, `--help` in lib/cli.ts).
 *
 * Stages are separable on purpose: `check` and `plan` are free and instant,
 * `tts` bills per character (cache-first, `lib/tts.ts` — or `--mock-tts`
 * rehearsal silence for zero-cost iteration), `record` needs the running
 * docs-demo stack (preflighted by `lib/doctor.ts`), `compose` needs only
 * ffmpeg (`--draft` for the fast review loop). The narration audio plan
 * written by `tts` (`.state/tts/<episode>.<locale>.json`) is the contract
 * the other stages build on.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { audioPlanPath, type AudioPlan } from './lib/audio-plan';
import {
  CliUsageError,
  helpText,
  parseCliArgs,
  type CliOptions,
} from './lib/cli';
import { loadDevEnv } from './lib/dev-env';
import { doctorHasFailures, formatDoctorReport, runDoctor } from './lib/doctor';
import {
  LOCALES,
  narrationFor,
  type EpisodeSpec,
  type Locale,
} from './lib/episode';
import { loadChoreography, loadEpisodes } from './lib/episodes';
import { estimateSpeechMs } from './lib/estimate';
import { ensureFfmpegAvailable } from './lib/ffmpeg';
import { formatClock } from './lib/format';
import { STATE_DIR } from './lib/paths';
import { planTimeline } from './lib/timeline';
import {
  elevenLabsApiKey,
  resolveTtsModel,
  synthesize,
  synthesizeEpisodeWhole,
} from './lib/tts';
import { synthesizeMockNarration } from './lib/tts-mock';
import { toSpokenText } from './lib/tts-text';
import {
  formatFindings,
  validateChoreography,
  validateEpisodeSpec,
  type ValidationFinding,
} from './lib/validate';

// Dev-tooling secrets live in the repo-root `.env.dev` (never the platform's
// own env files) — load them before anything reads process.env.
loadDevEnv();

/**
 * Static validation, printed. `withChoreography: false` while a script is
 * still narration-only (the storyboard-first workflow TTSes before scenes.ts
 * exists); record/compose always validate both sides.
 */
async function runCheckStage(
  episode: EpisodeSpec,
  withChoreography: boolean,
): Promise<boolean> {
  const findings: ValidationFinding[] = [...validateEpisodeSpec(episode)];
  if (withChoreography) {
    try {
      findings.push(
        ...validateChoreography(episode, await loadChoreography(episode.id)),
      );
    } catch (error) {
      findings.push({
        severity: 'error',
        where: episode.id,
        detail: `scenes.ts failed to load: ${String(error)}`,
      });
    }
  }
  if (findings.length > 0) console.log(formatFindings(findings));
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length === 0 && findings.length === 0) {
    console.log(`  ✓ ${episode.id} — spec and choreography are consistent`);
  }
  return errors.length === 0;
}

/** The spoken (respelled) narration per scene — the TTS/plan input. */
function spokenTexts(episode: EpisodeSpec, locale: Locale): string[] {
  return episode.scenes.map((scene) =>
    toSpokenText(narrationFor(episode, scene.id, locale), locale),
  );
}

function writeAudioPlan(plan: AudioPlan): void {
  const planPath = audioPlanPath(STATE_DIR, plan.episodeId, plan.locale);
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
}

/**
 * Synthesize every scene's narration for one locale and write the audio
 * plan. Three sources, one plan shape: `--mock-tts` estimated silence
 * (free), a whole-episode generation sliced by character timestamps
 * (consistent delivery), or per-scene generations with neighbour context.
 */
async function runTtsStage(
  episode: EpisodeSpec,
  locale: Locale,
  mockTts: boolean,
): Promise<void> {
  const voiceId = episode.voices[locale];
  const texts = spokenTexts(episode, locale);
  const planScenes: AudioPlan['scenes'][number][] = [];
  let billed = 0;
  let cachedCount = 0;
  let model: string;

  const logScene = (
    sceneId: string,
    entry: { durationMs: number; cached: boolean },
    flavour: 'mock' | 'whole' | 'scene',
  ) => {
    if (entry.durationMs <= 0) {
      console.log(`  ∅ ${locale}/${sceneId} — silent`);
      return;
    }
    const glyph = flavour === 'mock' ? '≈' : entry.cached ? '≡' : '♪';
    const suffix = [
      flavour === 'mock' ? 'estimated silence' : null,
      flavour === 'whole' ? 'whole take' : null,
      entry.cached && flavour !== 'mock' ? 'cached' : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `  ${glyph} ${locale}/${sceneId} — ${(entry.durationMs / 1000).toFixed(1)}s${suffix ? ` (${suffix})` : ''}`,
    );
  };

  if (mockTts) {
    model = 'mock-silence';
    for (const [index, scene] of episode.scenes.entries()) {
      const result = await synthesizeMockNarration(
        texts[index] ?? '',
        STATE_DIR,
      );
      if (result.cached && result.durationMs > 0) cachedCount += 1;
      planScenes.push({
        id: scene.id,
        mp3Path: result.mp3Path,
        durationMs: result.durationMs,
      });
      logScene(scene.id, result, 'mock');
    }
  } else if (episode.wholeTakeLocales?.includes(locale)) {
    // One generation for the whole episode → consistent delivery; sliced
    // into per-scene mp3s by character timestamps.
    model = await resolveTtsModel();
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
      logScene(scene.id, slice, 'whole');
    }
  } else {
    model = await resolveTtsModel();
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
      logScene(scene.id, result, 'scene');
    }
  }

  writeAudioPlan({
    episodeId: episode.id,
    locale,
    voiceId,
    model,
    ...(mockTts ? { estimated: true } : {}),
    scenes: planScenes,
  });
  const totalMs = planScenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  console.log(
    `TTS ${episode.id}/${locale}: ${planScenes.length} scenes, ` +
      `${(totalMs / 1000).toFixed(1)}s narration, ${cachedCount} cached, ` +
      `${billed} characters billed${mockTts ? ' (mock — estimates only)' : ''}.`,
  );
}

/**
 * Print the planned timeline — measured narration when an audio plan
 * exists, estimates otherwise. Free, instant, zero side effects: the
 * pacing-design tool for script iteration.
 */
function runPlanStage(episode: EpisodeSpec, locale: Locale): void {
  const planPath = audioPlanPath(STATE_DIR, episode.id, locale);
  const audioPlan = existsSync(planPath)
    ? (JSON.parse(readFileSync(planPath, 'utf8')) as AudioPlan)
    : null;
  const texts = spokenTexts(episode, locale);
  const timeline = planTimeline(
    episode.scenes.map((scene, index) => ({
      id: scene.id,
      audioDurationMs:
        audioPlan?.scenes.find((s) => s.id === scene.id)?.durationMs ??
        estimateSpeechMs(texts[index] ?? ''),
      leadInMs: scene.leadInMs,
      tailMs: scene.tailMs,
      minMs: scene.minMs,
    })),
  );
  const source = audioPlan
    ? audioPlan.estimated
      ? 'mock audio plan (estimated durations)'
      : `measured audio plan (${audioPlan.model})`
    : 'no audio plan — character-count estimates';
  console.log(`Plan ${episode.id}/${locale} — ${source}`);
  console.log('  start    budget  narration  scene');
  for (const [index, planned] of timeline.scenes.entries()) {
    const spec = episode.scenes[index];
    const audioMs =
      audioPlan?.scenes.find((s) => s.id === planned.id)?.durationMs ??
      estimateSpeechMs(texts[index] ?? '');
    const chapter = spec?.chapterByLocale?.[locale];
    console.log(
      `  ${formatClock(planned.startMs).padStart(7)}  ${`${(planned.budgetMs / 1000).toFixed(1)}s`.padStart(6)}  ${
        audioMs > 0
          ? `${(audioMs / 1000).toFixed(1)}s`.padStart(9)
          : '        —'
      }  ${planned.id}${chapter ? `  [${chapter}${spec?.chapterTransition === 'cut' ? ' · cut' : ''}]` : ''}`,
    );
  }
  const characters = texts.join('').length;
  console.log(
    `  = ${formatClock(timeline.totalMs)} planned total, ${characters} spoken characters`,
  );
}

interface UnitResult {
  readonly episode: string;
  readonly locale: Locale;
  readonly ok: boolean;
  readonly detail: string;
}

async function runList(): Promise<void> {
  for (const episode of await loadEpisodes()) {
    const narrationReady = LOCALES.filter((locale) =>
      episode.scenes.every((scene) => scene.narration[locale] !== undefined),
    );
    const ttsReady = LOCALES.filter((locale) =>
      existsSync(audioPlanPath(STATE_DIR, episode.id, locale)),
    );
    console.log(
      `${episode.id}  [${episode.section}]${episode.diagnostic ? ' (diagnostic)' : ''}  ` +
        `${episode.scenes.length} scenes, narration: ${narrationReady.join(', ') || '—'}, ` +
        `tts plans: ${ttsReady.join(', ') || '—'}`,
    );
  }
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

async function resolveSelection(
  options: CliOptions,
): Promise<readonly EpisodeSpec[]> {
  const episodes = await loadEpisodes();
  if (options.episodes === 'all') {
    // Diagnostics exercise the pipeline itself — they stay opt-in by id.
    return episodes.filter((episode) => !episode.diagnostic);
  }
  return Promise.all(
    options.episodes.map(async (id) => {
      const episode = episodes.find((e) => e.id === id);
      if (!episode) {
        throw new CliUsageError(
          `Unknown episode "${id}". Known: ${episodes.map((e) => e.id).join(', ')}`,
        );
      }
      return episode;
    }),
  );
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`docs:videos: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (options.help) {
    console.log(helpText());
    return;
  }
  if (options.list) {
    await runList();
    return;
  }
  if (options.audition) {
    await ensureFfmpegAvailable();
    elevenLabsApiKey();
    await runAudition();
    return;
  }

  const selection = await resolveSelection(options);
  const stages: readonly ('check' | 'plan' | 'tts' | 'record' | 'compose')[] =
    options.stage === 'all' ? ['tts', 'record', 'compose'] : [options.stage];
  const needsTts = stages.includes('tts');
  const needsRecord = stages.includes('record');
  const needsCompose = stages.includes('compose');

  // Fail on missing prerequisites in seconds, not minutes into a take —
  // doctor first (it REPORTS missing pieces; the hard gates below throw).
  if (options.doctor || needsRecord) {
    const checks = await runDoctor({
      episodes: selection,
      locales: options.locales,
      needsTts,
      needsRecord: needsRecord || options.doctor,
      needsCompose,
      mockTts: options.mockTts,
    });
    console.log(`Doctor:\n${formatDoctorReport(checks)}`);
    if (doctorHasFailures(checks)) {
      if (options.doctor) {
        process.exitCode = 1;
        return;
      }
      throw new Error(
        'preflight failed — fix the ✗ items above (or run --doctor after).',
      );
    }
    if (options.doctor) return;
  }
  if (needsTts || needsCompose) await ensureFfmpegAvailable();
  if (needsTts && !options.mockTts) elevenLabsApiKey();

  const results: UnitResult[] = [];
  for (const episode of selection) {
    // Structural drift fails here, before any stage burns time on it. The
    // tts stage validates the spec only — narration is authored (and
    // synthesized) before choreography exists.
    const checkOk = await runCheckStage(
      episode,
      options.stage === 'check' || needsRecord || needsCompose,
    );
    if (!checkOk || options.stage === 'check') {
      for (const locale of options.locales) {
        results.push({
          episode: episode.id,
          locale,
          ok: checkOk,
          detail: checkOk ? 'check' : 'check failed',
        });
      }
      continue;
    }

    for (const locale of options.locales) {
      try {
        if (options.stage === 'plan') {
          runPlanStage(episode, locale);
          results.push({
            episode: episode.id,
            locale,
            ok: true,
            detail: 'plan',
          });
          continue;
        }
        if (needsTts) await runTtsStage(episode, locale, options.mockTts);
        if (needsRecord) {
          const { runRecordStage } = await import('./lib/recorder');
          await runRecordStage(episode, locale, STATE_DIR);
        }
        if (needsCompose) {
          const { runComposeStage } = await import('./lib/compose');
          const planPath = audioPlanPath(STATE_DIR, episode.id, locale);
          const estimatedPlan =
            existsSync(planPath) &&
            ((JSON.parse(readFileSync(planPath, 'utf8')) as AudioPlan)
              .estimated ??
              false);
          // A rehearsal (mock) plan auto-composes as a draft — the guard in
          // compose would otherwise reject it at the end of a long take.
          const draft = options.draft || (estimatedPlan && !episode.diagnostic);
          if (draft && !options.draft) {
            console.log(
              '  · estimated narration → composing as draft (.state/out)',
            );
          }
          await runComposeStage(episode, locale, STATE_DIR, {
            draft,
            verify: options.verify,
          });
        }
        results.push({
          episode: episode.id,
          locale,
          ok: true,
          detail: stages.join('+'),
        });
      } catch (error) {
        console.error(`✗ ${episode.id}/${locale}:`, error);
        results.push({
          episode: episode.id,
          locale,
          ok: false,
          detail:
            String(error instanceof Error ? error.message : error).split(
              '\n',
            )[0] ?? 'failed',
        });
      }
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (results.length > 1) {
    console.log('\nSummary:');
    for (const result of results) {
      console.log(
        `  ${result.ok ? '✓' : '✗'} ${result.episode}/${result.locale} — ${result.detail}`,
      );
    }
  }
  if (failed.length > 0) {
    console.error(
      `\n${failed.length}/${results.length} unit(s) failed — see above.`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('docs:videos failed:', error);
  process.exit(1);
});
