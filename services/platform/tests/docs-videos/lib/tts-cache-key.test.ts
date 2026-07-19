import { describe, expect, it } from 'vitest';

import { sceneCacheKey, wholeEpisodeCacheKey } from './tts';

/**
 * Characterization lock on the TTS cache keys. The digests below were
 * computed from the shipped implementation on 2026-07-18; if any assertion
 * here fails, the change under review REKEYS the ElevenLabs cache — every
 * already-paid-for narration in `.state/tts-cache/` goes stale and the next
 * `--stage tts` re-bills the entire back catalog. That is practically never
 * an acceptable side effect; revert the key-shape change instead of updating
 * these values. (Deliberate rekeying — a new voice-settings epoch — must
 * update the digests in the same change, with the re-billing called out.)
 */
describe('tts cache keys', () => {
  it('pins the per-scene key for the v3 shape (no neighbour context)', () => {
    expect(
      sceneCacheKey('eleven_v3', { voiceId: 'VOICE_A', text: 'Hello world.' }),
    ).toBe('60a4359c0bb0cd7742a296afb07efa776e2d7690d4c9831da5b52ae9417e2f25');
  });

  it('pins the per-scene key with previous/next context (v2 fallback)', () => {
    expect(
      sceneCacheKey('eleven_multilingual_v2', {
        voiceId: 'VOICE_A',
        text: 'Hello world.',
        previousText: 'Before.',
        nextText: 'After.',
      }),
    ).toBe('ee55237dcc99d57029190c76a917800c9dd8d768f58d76abff1e750b5880600b');
  });

  it('pins the whole-episode key', () => {
    expect(
      wholeEpisodeCacheKey('eleven_v3', 'VOICE_A', 'Scene one.\n\nScene two.'),
    ).toBe('42e17d19fdc1b40190f2c9a22e1ac9b84560b28569e87b63b4ced0259481cc24');
  });

  it('keys ignore absent-vs-empty neighbour context (same bytes)', () => {
    expect(sceneCacheKey('eleven_v3', { voiceId: 'V', text: 'T' })).toBe(
      sceneCacheKey('eleven_v3', {
        voiceId: 'V',
        text: 'T',
        previousText: '',
        nextText: '',
      }),
    );
  });
});
