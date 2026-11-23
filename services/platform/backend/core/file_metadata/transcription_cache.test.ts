import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  transcriptionCacheHash,
  transcriptionCacheHasher,
} from './transcription_cache';

const bytes = new Uint8Array([0, 1, 255, 0, 2]);
const target = {
  providerName: 'audio-provider',
  modelId: 'speech-a',
  baseUrl: 'https://audio.example.invalid/v1',
};

describe('transcription cache identity', () => {
  it('reuses identical bytes at the same target and ignores credential rotation', () => {
    const before = { ...target, apiKey: 'synthetic-before' };
    const after = { ...target, apiKey: 'synthetic-after' };
    expect(transcriptionCacheHash(bytes, before)).toBe(
      transcriptionCacheHash(new Uint8Array(bytes), after),
    );
  });

  it.each([
    { providerName: 'other-provider' },
    { modelId: 'speech-b' },
    { baseUrl: 'https://other.example.invalid/v1' },
    { responseFormat: 'json' as const },
  ])('does not reuse another transcription target: %j', (difference) => {
    expect(
      transcriptionCacheHash(bytes, { ...target, ...difference }),
    ).not.toBe(transcriptionCacheHash(bytes, target));
  });

  it('treats an explicit verbose format the same as the compatible default', () => {
    expect(
      transcriptionCacheHash(bytes, {
        ...target,
        responseFormat: 'verbose_json',
      }),
    ).toBe(transcriptionCacheHash(bytes, target));
  });

  it('does not confuse adjacent field boundaries or embedded delimiters', () => {
    const first = { ...target, providerName: 'a', modelId: 'b::c\0d' };
    const second = { ...target, providerName: 'a::b', modelId: 'c\0d' };
    expect(transcriptionCacheHash(bytes, first)).not.toBe(
      transcriptionCacheHash(bytes, second),
    );
  });

  it('does not reuse a prefix, suffix or altered audio blob', () => {
    const expected = transcriptionCacheHash(bytes, target);
    for (const changed of [
      bytes.slice(1),
      bytes.slice(0, -1),
      new Uint8Array([0, 1, 255, 0, 3]),
    ]) {
      expect(transcriptionCacheHash(changed, target)).not.toBe(expected);
    }
  });

  it('leaves legacy bytes-only cache entries as misses without changing their data', () => {
    const legacy = createHash('sha256').update(bytes).digest('hex');
    const current = transcriptionCacheHash(bytes, target);
    expect(current).toMatch(/^[a-f0-9]{64}$/);
    expect(current).not.toBe(legacy);
  });

  it('makes the same hash of bytes that arrive in pieces, wherever they are cut', () => {
    const audio = new Uint8Array(1000).map((_byte, at) => (at * 31) % 256);
    const expected = transcriptionCacheHash(audio, target);
    for (const piece of [1, 7, 256, 999, 1000, 4096]) {
      const hasher = transcriptionCacheHasher(target);
      for (let at = 0; at < audio.length; at += piece) {
        hasher.update(audio.subarray(at, at + piece));
      }
      expect(hasher.digest(), `pieces of ${piece}`).toBe(expected);
    }
    // And of no bytes at all.
    expect(transcriptionCacheHasher(target).digest()).toBe(
      transcriptionCacheHash(new Uint8Array(), target),
    );
  });
});
