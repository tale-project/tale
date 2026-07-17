/**
 * The narration audio plan — the `tts` stage's output and the contract the
 * `record` and `compose` stages build on: per scene, the cached mp3 and its
 * measured duration. Written to `.state/tts/<episode>.<locale>.json`.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Locale } from './episode';

export interface AudioPlanScene {
  readonly id: string;
  readonly mp3Path: string;
  readonly durationMs: number;
}

export interface AudioPlan {
  readonly episodeId: string;
  readonly locale: Locale;
  readonly voiceId: string;
  readonly model: string;
  readonly scenes: readonly AudioPlanScene[];
}

export function audioPlanPath(
  stateDir: string,
  episodeId: string,
  locale: Locale,
): string {
  return path.join(stateDir, 'tts', `${episodeId}.${locale}.json`);
}

export function readAudioPlan(
  stateDir: string,
  episodeId: string,
  locale: Locale,
): AudioPlan {
  const planPath = audioPlanPath(stateDir, episodeId, locale);
  if (!existsSync(planPath)) {
    throw new Error(
      `No narration audio plan at ${planPath} — run \`bun run docs:videos -- ` +
        `--episode ${episodeId} --locale ${locale} --stage tts\` first.`,
    );
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as AudioPlan;
  for (const scene of plan.scenes) {
    // Silent scenes carry an empty mp3Path by design.
    if (scene.mp3Path && !existsSync(scene.mp3Path)) {
      throw new Error(
        `Audio plan references a missing mp3 (${scene.mp3Path}) — re-run --stage tts.`,
      );
    }
  }
  return plan;
}
