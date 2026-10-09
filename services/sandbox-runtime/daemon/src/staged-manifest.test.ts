import { describe, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import {
  decodeStagedManifest,
  encodeStagedManifest,
  type StagedSource,
} from './staged-manifest.ts';

const DIGEST = 'a'.repeat(64);
const STAT = {
  dev: '2049',
  ino: '1234567',
  size: '7',
  mtimeNs: '1760000000123456789',
  ctimeNs: '1760000000123456789',
};
const SOURCES: Array<[string, StagedSource]> = [
  ['inputs/task/a.pdf', { sourceId: 'blob:a', digest: DIGEST, stat: STAT }],
  ['inputs/task/b.txt', { sourceId: 'blob:b', digest: DIGEST }],
];
const anyPath = () => true;

describe('the staged-files manifest', () => {
  test('reads back what it wrote, with and without a stat', () => {
    const text = encodeStagedManifest(SOURCES, 'token');
    expect(decodeStagedManifest(text, 'token', anyPath)).toEqual(
      new Map(SOURCES),
    );
  });

  test('is ignored when signed with another key: another session, a rotated token', () => {
    const text = encodeStagedManifest(SOURCES, 'token');
    expect(decodeStagedManifest(text, 'other', anyPath)).toBeNull();
  });

  test('is ignored when edited, even with its signature kept', () => {
    const text = encodeStagedManifest(SOURCES, 'token');
    const edited = text.replace('"blob:b"', '"blob:x"');
    expect(edited).not.toBe(text);
    expect(decodeStagedManifest(edited, 'token', anyPath)).toBeNull();
  });

  test.each([
    ['not JSON', 'nope'],
    ['another format', JSON.stringify({ format: 'v0', entries: [], mac: '' })],
    [
      'no signature',
      JSON.stringify({ format: 'tale-staged-sources-v1', entries: [] }),
    ],
  ])('is ignored when it is %s', (_, text) => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(decodeStagedManifest(text, 'token', anyPath)).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  test.each([
    ['a digest that is no sha256', ['p', 'blob:a', 'xyz']],
    ['an empty source', ['p', '', DIGEST]],
    [
      'a stat that is no number',
      ['p', 'blob:a', DIGEST, '1', '2', '-3', '4', '5'],
    ],
    ['an entry of the wrong length', ['p', 'blob:a', DIGEST, '1']],
    ['a source longer than the API allows', ['p', 'x'.repeat(2049), DIGEST]],
  ])('drops an entry that holds %s, and keeps the others', (_, entry) => {
    // Signed correctly: only the one entry's shape is wrong.
    const good = ['q', 'blob:good', DIGEST];
    const text = encodeStagedManifest([], 'token').replace(
      '"entries":[]',
      `"entries":${JSON.stringify([entry, good])}`,
    );
    const parsed: unknown = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('entries' in parsed) ||
      !Array.isArray(parsed.entries)
    )
      throw new Error('the encoded manifest has no entries');
    const mac = createHmac('sha256', 'token')
      .update(`tale-staged-sources-v1\n${JSON.stringify(parsed.entries)}`)
      .digest('hex');
    const signed = JSON.stringify({ ...parsed, mac });
    expect(decodeStagedManifest(signed, 'token', anyPath)).toEqual(
      new Map([['q', { sourceId: 'blob:good', digest: DIGEST }]]),
    );
  });

  test('keeps a source as long as the API allows', () => {
    const long: Array<[string, StagedSource]> = [
      ['p', { sourceId: 'x'.repeat(2048), digest: DIGEST }],
    ];
    const text = encodeStagedManifest(long, 'token');
    expect(decodeStagedManifest(text, 'token', anyPath)).toEqual(new Map(long));
  });

  test('drops the entries whose path may not be staged', () => {
    const text = encodeStagedManifest(SOURCES, 'token');
    expect(
      [
        ...(decodeStagedManifest(text, 'token', (path) =>
          path.endsWith('.txt'),
        ) ?? []),
      ].map(([path]) => path),
    ).toEqual(['inputs/task/b.txt']);
  });
});
