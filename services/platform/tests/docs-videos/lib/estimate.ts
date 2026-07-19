/**
 * Rough narration-length estimation for REHEARSAL runs (`--mock-tts`,
 * `--stage plan` before any TTS exists). Calibrated against the shipped
 * ep1 narration (~15.5 chars/sec at ElevenLabs' tutorial pace); good enough
 * to plan a timeline and rehearse choreography, never good enough to ship —
 * estimated audio plans are refused outside `.state/` by the compose stage.
 *
 * Pure module — no fs, no network.
 */

import { stripAudioTags } from './vtt';

/** Average speech rate: milliseconds per spoken character. */
const MS_PER_CHAR = 64;
/** Breathing room the voice takes at each sentence boundary. */
const MS_PER_SENTENCE_BREAK = 220;
/** Onset latency baked into every generated clip. */
const BASE_MS = 240;

/**
 * Estimate how long a narration text will take to speak, in milliseconds.
 * Returns 0 for a silent scene (empty or tags-only text).
 */
export function estimateSpeechMs(text: string): number {
  const clean = stripAudioTags(text);
  if (!clean) return 0;
  const sentenceBreaks = (clean.match(/[.!?…]+(?:\s|$)/g) ?? []).length;
  return Math.round(
    BASE_MS +
      clean.length * MS_PER_CHAR +
      sentenceBreaks * MS_PER_SENTENCE_BREAK,
  );
}
