/**
 * Diagnostic episode — the pipeline's own sync probe, never shipped to docs
 * (`diagnostic: true` routes its output to `.state/out/`). Run it after any
 * change to the recorder/compose machinery:
 *
 *   bun run docs:videos -- --episode spike-sync --locale en
 *
 * What it proves, and how to check it (see the probe scene's choreography):
 *  - narration onset: `ffmpeg -i out.mp4 -af silencedetect` — first
 *    silence_end must sit at the title scene's narrationStart (±100 ms);
 *  - visual cue landing: the probe scene flips the page to solid red exactly
 *    at cue(1.0) — the flip frame must land at narrationStart+1000 ms;
 *  - cursor rendering: a glide + ripple against a labelled target.
 *
 * The title narration text is EP1's verbatim — same voice, same model — so
 * this episode is a permanent TTS cache hit and never bills a character.
 */

import type { EpisodeSpec } from '../../lib/episode';
import { EP1_WELCOME } from '../ep1-welcome/episode';

export const SPIKE_SYNC: EpisodeSpec = {
  id: 'spike-sync',
  section: 'tutorials',
  diagnostic: true,
  titleByLocale: {
    en: 'Sync probe',
    de: 'Sync probe',
    fr: 'Sync probe',
  },
  episodeLabelByLocale: {
    en: 'Pipeline diagnostic',
    de: 'Pipeline diagnostic',
    fr: 'Pipeline diagnostic',
  },
  needsKnowledgeDb: false,
  voices: EP1_WELCOME.voices,
  heroPromptByLocale: { en: '', de: '', fr: '' },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      // Verbatim EP1 title narration → permanent cache hit.
      narration: {
        en: EP1_WELCOME.scenes[0]?.narration.en ?? '',
      },
    },
    {
      id: 'probe',
      minMs: 6000,
      narration: { en: '' },
    },
  ],
} as const;
