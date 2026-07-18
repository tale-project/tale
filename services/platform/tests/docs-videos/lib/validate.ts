/**
 * Static validation of episode specs and their choreography — everything
 * that can be proven WITHOUT a stack, a key, or a take. The type system
 * already guards the typed shapes; this catches the cross-file and
 * cross-system drift it cannot see:
 *
 *  - episode.ts ↔ scenes.ts scene-id parity (the join key of the pipeline),
 *  - per-locale narration consistency (a locale is all scenes or none),
 *  - hero prompts pairing with a `DOCS_REPLIES` match clause (an unpaired
 *    prompt streams the visibly synthetic e2e canned reply on camera),
 *  - the outro's room for the compose fade-out.
 *
 * Runs as `--stage check`, automatically before tts/record/compose, and as
 * the always-on vitest gate (`episodes.test.ts`) so drift fails `bun run
 * check` long before a take burns minutes discovering it.
 */

import { DOCS_REPLIES } from '../../../lib/mocks/overrides/docs-replies';
import type { EpisodeSpec } from './episode';
import { LOCALES } from './episode';
import type { ChoreographyModule } from './episodes';
import { DEFAULT_TAIL_MS } from './timeline';

/** The compose bookend: 1.5 s fade-out that must land inside the outro. */
const FADE_OUT_ROOM_MS = 2000;

export interface ValidationFinding {
  readonly severity: 'error' | 'warning';
  /** `episode-id` or `episode-id/scene-id`. */
  readonly where: string;
  readonly detail: string;
}

function listPreview(values: readonly string[], max = 5): string {
  const preview = values.slice(0, max).join(', ');
  return values.length > max
    ? `${preview}, … (${values.length} total)`
    : preview;
}

export function validateEpisodeSpec(episode: EpisodeSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const error = (where: string, detail: string) =>
    findings.push({ severity: 'error', where, detail });
  const warning = (where: string, detail: string) =>
    findings.push({ severity: 'warning', where, detail });

  if (episode.scenes.length === 0) {
    error(episode.id, 'has no scenes');
    return findings;
  }

  // Scene ids are the pipeline's join key — unique and non-empty.
  const seen = new Set<string>();
  for (const scene of episode.scenes) {
    if (!scene.id.trim()) error(episode.id, 'a scene has an empty id');
    if (seen.has(scene.id)) {
      error(`${episode.id}/${scene.id}`, 'duplicate scene id');
    }
    seen.add(scene.id);
    if (
      (scene.leadInMs ?? 0) < 0 ||
      (scene.tailMs ?? 0) < 0 ||
      (scene.minMs ?? 0) < 0
    ) {
      error(`${episode.id}/${scene.id}`, 'negative timing override');
    }
    if (scene.chapterTransition && !scene.chapterByLocale) {
      error(
        `${episode.id}/${scene.id}`,
        'chapterTransition without chapterByLocale — the transition has no card to play',
      );
    }
  }

  // A locale is authored for ALL scenes or NONE — a partial locale records
  // a take with silent holes. (Explicit '' is a deliberate silent scene.)
  const completeLocales = LOCALES.filter((locale) =>
    episode.scenes.every((scene) => scene.narration[locale] !== undefined),
  );
  for (const locale of LOCALES) {
    if (completeLocales.includes(locale)) continue;
    const present = episode.scenes.filter(
      (scene) => scene.narration[locale] !== undefined,
    );
    if (present.length === 0) continue; // not started — fine mid-authoring
    const missing = episode.scenes
      .filter((scene) => scene.narration[locale] === undefined)
      .map((scene) => scene.id);
    error(
      episode.id,
      `${locale} narration covers ${present.length}/${episode.scenes.length} scenes — missing: ${listPreview(missing)}`,
    );
  }
  if (completeLocales.length === 0) {
    error(episode.id, 'no locale has complete narration');
  }

  for (const locale of LOCALES) {
    if (!episode.voices[locale]?.trim()) {
      error(episode.id, `no ${locale} voice id`);
    }
  }

  // The compose stage fades out over the last 1.5 s — the outro needs room,
  // or the ending is audibly/visually clipped. (Diagnostic output never
  // ships, so a clipped probe tail is fine.)
  const outro = episode.scenes.at(-1);
  if (
    !episode.diagnostic &&
    outro &&
    (outro.tailMs ?? DEFAULT_TAIL_MS) < FADE_OUT_ROOM_MS
  ) {
    warning(
      `${episode.id}/${outro.id}`,
      `last scene tailMs ${outro.tailMs ?? DEFAULT_TAIL_MS}ms < ${FADE_OUT_ROOM_MS}ms — the 1.5s fade-out will clip it`,
    );
  }

  // A hero prompt that pairs with no DOCS_REPLIES match clause streams the
  // visibly synthetic e2e canned reply on camera (the #1 wow-scene failure).
  if (!episode.diagnostic) {
    for (const locale of LOCALES) {
      const prompt = episode.heroPromptByLocale?.[locale];
      if (!prompt) continue;
      const paired = DOCS_REPLIES.some((reply) =>
        prompt.toLowerCase().includes(reply.match),
      );
      if (!paired) {
        error(
          episode.id,
          `${locale} hero prompt pairs with no DOCS_REPLIES match clause — ` +
            `add/adjust the entry in lib/mocks/overrides/docs-replies.ts ` +
            `(the take would stream the canned e2e reply)`,
        );
      }
    }
  }

  return findings;
}

export function validateChoreography(
  episode: EpisodeSpec,
  module: ChoreographyModule,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const error = (where: string, detail: string) =>
    findings.push({ severity: 'error', where, detail });

  const specIds = new Set(episode.scenes.map((scene) => scene.id));
  const choreoIds = new Set<string>();
  for (const scene of module.SCENES) {
    if (choreoIds.has(scene.id)) {
      error(`${episode.id}/${scene.id}`, 'duplicate choreography id');
    }
    choreoIds.add(scene.id);
    if (!specIds.has(scene.id)) {
      error(
        `${episode.id}/${scene.id}`,
        'choreography for a scene episode.ts does not declare',
      );
    }
  }
  for (const id of specIds) {
    if (!choreoIds.has(id)) {
      error(`${episode.id}/${id}`, 'scene has no choreography in scenes.ts');
    }
  }
  if (!episode.diagnostic && typeof module.warmup !== 'function') {
    error(
      episode.id,
      'scenes.ts exports no warmup — every surface the take visits must be ' +
        'compiled and warmed before the screencast starts',
    );
  }
  return findings;
}

/** Console rendering: one aligned line per finding. */
export function formatFindings(findings: readonly ValidationFinding[]): string {
  return findings
    .map(
      (finding) =>
        `  ${finding.severity === 'error' ? '✗' : '⚠'} ${finding.where} — ${finding.detail}`,
    )
    .join('\n');
}
