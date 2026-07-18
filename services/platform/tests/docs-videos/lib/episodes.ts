/**
 * Episode registry by filesystem convention: every `episodes/<id>/episode.ts`
 * that exports an `EpisodeSpec` is registered automatically — there is no
 * manual import list to forget when adding an episode. The spec's `id` must
 * equal its directory name (it already keys the TTS cache, timeline and
 * output paths), and discovery fails loudly on any directory that doesn't
 * export a recognizable spec.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { EpisodeSpec } from './episode';
import { EPISODES_DIR } from './paths';
import type { SceneChoreography, SceneContext } from './scene';

export interface ChoreographyModule {
  readonly SCENES: readonly SceneChoreography[];
  /** Optional pre-screencast lap over every surface the take visits. */
  readonly warmup?: (
    page: import('@playwright/test').Page,
    ctx: SceneContext,
  ) => Promise<void>;
}

/** The paired `scenes.ts` of one episode (choreography side of the spec). */
export async function loadChoreography(
  episodeId: string,
): Promise<ChoreographyModule> {
  return (await import(
    path.join(EPISODES_DIR, episodeId, 'scenes.ts')
  )) as ChoreographyModule;
}

/** `ep2-…` before `ep10-…` — numeric-aware, deterministic across machines. */
const collator = new Intl.Collator('en', { numeric: true });
const naturalOrder = (a: string, b: string): number => collator.compare(a, b);

function isEpisodeSpec(value: unknown): value is EpisodeSpec {
  if (typeof value !== 'object' || value === null) return false;
  const spec = value as Partial<EpisodeSpec>;
  return (
    typeof spec.id === 'string' &&
    Array.isArray(spec.scenes) &&
    typeof spec.voices === 'object'
  );
}

let cache: readonly EpisodeSpec[] | null = null;

/** All episodes, discovered from `episodes/<id>/episode.ts`, natural order. */
export async function loadEpisodes(): Promise<readonly EpisodeSpec[]> {
  if (cache) return cache;
  const directories = readdirSync(EPISODES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(EPISODES_DIR, name, 'episode.ts')))
    .sort(naturalOrder);
  const episodes: EpisodeSpec[] = [];
  for (const directory of directories) {
    const module = (await import(
      path.join(EPISODES_DIR, directory, 'episode.ts')
    )) as Record<string, unknown>;
    const spec = Object.values(module).find(isEpisodeSpec);
    if (!spec) {
      throw new Error(
        `episodes/${directory}/episode.ts exports no EpisodeSpec — export a ` +
          `const with id/scenes/voices (see episodes/ep1-welcome/episode.ts).`,
      );
    }
    if (spec.id !== directory) {
      throw new Error(
        `episodes/${directory}: spec id "${spec.id}" must equal the directory ` +
          `name — the id keys the TTS cache, timeline and output paths.`,
      );
    }
    episodes.push(spec);
  }
  cache = episodes;
  return episodes;
}

/** One episode by id, or throw naming the known ids. */
export async function findEpisode(id: string): Promise<EpisodeSpec> {
  const episodes = await loadEpisodes();
  const episode = episodes.find((e) => e.id === id);
  if (!episode) {
    throw new Error(
      `Unknown episode "${id}". Known: ${episodes.map((e) => e.id).join(', ')}`,
    );
  }
  return episode;
}
