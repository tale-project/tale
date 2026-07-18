/**
 * Shared episode/scene types for the docs video pipeline. An episode is
 * authored in two coupled files under `episodes/<id>/`:
 *
 *  - `episode.ts` — the SPEC: narration per scene per locale, voices, the
 *    live chat prompt, timing overrides. Everything TTS and compose need.
 *  - `scenes.ts` — the CHOREOGRAPHY: per scene, the Playwright actions that
 *    put the recorded page into the narrated state (recorder stage only).
 *
 * Scene ids are the join key across spec, choreography, TTS cache, timeline
 * and drift report — rename in both files or the pipeline fails loudly.
 */

export const LOCALES = ['en', 'de', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export interface SceneSpec {
  readonly id: string;
  /** Narration per locale — authored natively, never translated 1:1. A
   * locale missing here fails `--stage tts` for that locale (fail fast). */
  readonly narration: Partial<Record<Locale, string>>;
  /**
   * Scene-change card label, played by the recorder as this scene opens
   * (all locales, or omit — the set ships indivisibly). Use it where the
   * tour enters a new section, not on every scene.
   */
  readonly chapterByLocale?: Record<Locale, string>;
  /**
   * How the chapter changes surface. `'cut'` — the scene jumps to another
   * URL with no on-camera navigation: the swap happens under a blur veil,
   * cursor hidden, card over the veil. `'navigate'` (default) — the
   * choreography navigates on camera: only the bottom-left card plays.
   */
  readonly chapterTransition?: 'cut' | 'navigate';
  readonly leadInMs?: number;
  readonly tailMs?: number;
  readonly minMs?: number;
}

export interface EpisodeSpec {
  readonly id: string;
  /** Output subdirectory under `services/docs/public/videos/`. */
  readonly section: 'tutorials';
  /**
   * Diagnostic episodes exercise the pipeline itself (sync probe); their
   * output goes to `.state/out/`, never to the docs public tree.
   */
  readonly diagnostic?: boolean;
  readonly titleByLocale: Record<Locale, string>;
  /** The eyebrow on the title card, e.g. "Episode 1" / "Épisode 1". */
  readonly episodeLabelByLocale: Record<Locale, string>;
  /** Whether recording needs the RAG backend (Indexed badges on camera). */
  readonly needsKnowledgeDb: boolean;
  /** ElevenLabs voice id per locale. */
  readonly voices: Record<Locale, string>;
  /**
   * Locales whose narration is synthesized as ONE whole-episode generation
   * and sliced by character timestamps — one generation, one consistent
   * delivery (per-scene generations drift in tone). The default for new
   * work; ep1's de/fr keep their user-approved per-scene takes until their
   * scripts next change.
   */
  readonly wholeTakeLocales?: readonly Locale[];
  /**
   * The question typed live in the chat wow scene, per locale — omit when
   * the episode has no live-typed chat scene. A non-empty prompt MUST
   * contain a `DOCS_REPLIES` match clause (validated by `--stage check`),
   * or the take streams the visibly synthetic e2e canned reply.
   */
  readonly heroPromptByLocale?: Record<Locale, string>;
  readonly scenes: readonly SceneSpec[];
}

/**
 * Narration text for one scene+locale, or throw naming the gap. An explicit
 * empty string means "deliberately silent scene" and is returned as-is; only
 * an ABSENT locale is an authoring error.
 */
export function narrationFor(
  episode: EpisodeSpec,
  sceneId: string,
  locale: Locale,
): string {
  const scene = episode.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    throw new Error(`Episode ${episode.id} has no scene "${sceneId}"`);
  }
  const text = scene.narration[locale];
  if (text === undefined) {
    throw new Error(
      `Episode ${episode.id} scene "${sceneId}" has no ${locale} narration yet`,
    );
  }
  return text;
}
