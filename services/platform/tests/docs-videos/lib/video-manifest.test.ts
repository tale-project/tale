import { describe, expect, test } from 'vitest';

import {
  mergeManifestEntries,
  type VideoManifestEntry,
} from './video-manifest';

const entry = (
  file: string,
  overrides: Partial<VideoManifestEntry> = {},
): VideoManifestEntry => ({
  file,
  episode: 'ep1-welcome',
  locale: 'en',
  kind: 'video',
  ...overrides,
});

describe('mergeManifestEntries', () => {
  test('incoming entries win over existing ones by file', () => {
    const merged = mergeManifestEntries(
      [entry('videos/tutorials/a.en.mp4', { durationSec: 10 })],
      [entry('videos/tutorials/a.en.mp4', { durationSec: 99 })],
      () => true,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.durationSec).toBe(99);
  });

  test('entries whose asset vanished are pruned', () => {
    const merged = mergeManifestEntries(
      [entry('videos/tutorials/gone.en.mp4')],
      [entry('videos/tutorials/kept.en.mp4')],
      (file) => file.includes('kept'),
    );
    expect(merged.map((e) => e.file)).toEqual(['videos/tutorials/kept.en.mp4']);
  });

  test('output is stably sorted by file for diff-quiet commits', () => {
    const merged = mergeManifestEntries(
      [],
      [
        entry('videos/tutorials/b.fr.mp4', { locale: 'fr' }),
        entry('videos/tutorials/a.de.vtt', { locale: 'de', kind: 'captions' }),
        entry('videos/tutorials/a.de.mp4', { locale: 'de' }),
      ],
      () => true,
    );
    expect(merged.map((e) => e.file)).toEqual([
      'videos/tutorials/a.de.mp4',
      'videos/tutorials/a.de.vtt',
      'videos/tutorials/b.fr.mp4',
    ]);
  });
});
