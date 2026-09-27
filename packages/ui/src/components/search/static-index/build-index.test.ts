import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';

import { SAMPLE_DOCS } from './__fixtures__/sample-docs';
import {
  buildSearchIndex,
  createMiniSearch,
  DEFAULT_SEARCH_OPTIONS,
} from './build-index';

describe('DEFAULT_SEARCH_OPTIONS', () => {
  it('disables prefix for short tokens and enables it for long', () => {
    const prefix = DEFAULT_SEARCH_OPTIONS.prefix;
    expect(typeof prefix).toBe('function');
    if (typeof prefix !== 'function') return;
    expect(prefix('cli', 0, ['cli'])).toBe(false);
    expect(prefix('test', 0, ['test'])).toBe(true);
    expect(prefix('configuration', 0, ['configuration'])).toBe(true);
  });

  it('disables fuzzy below 5 chars and enables 0.2 above', () => {
    const fuzzy = DEFAULT_SEARCH_OPTIONS.fuzzy;
    expect(typeof fuzzy).toBe('function');
    if (typeof fuzzy !== 'function') return;
    expect(fuzzy('api', 0, ['api'])).toBe(0);
    expect(fuzzy('test', 0, ['test'])).toBe(0);
    expect(fuzzy('react', 0, ['react'])).toBe(0.2);
    expect(fuzzy('configuration', 0, ['configuration'])).toBe(0.2);
  });

  it('caps fuzzy edit distance at 2', () => {
    expect(DEFAULT_SEARCH_OPTIONS.maxFuzzy).toBe(2);
  });

  it('honours frontmatter weight via boostDocument', () => {
    const boost = DEFAULT_SEARCH_OPTIONS.boostDocument;
    expect(typeof boost).toBe('function');
    if (typeof boost !== 'function') return;
    expect(boost('id1', 'term', { weight: 1.5 })).toBe(1.5);
    expect(boost('id1', 'term', { weight: undefined })).toBe(1);
    expect(boost('id1', 'term', {})).toBe(1);
    // Zero/negative weights fall back to neutral (1) — never penalise a
    // doc to oblivion by misconfiguration.
    expect(boost('id1', 'term', { weight: 0 })).toBe(1);
    expect(boost('id1', 'term', { weight: -3 })).toBe(1);
  });
});

describe('createMiniSearch', () => {
  it('returns an empty MiniSearch with title/headings/body fields', () => {
    const ms = createMiniSearch();
    expect(ms.documentCount).toBe(0);
    expect(ms.search('anything')).toEqual([]);
  });

  it('indexes title, headings, and body — but not url/section', () => {
    const ms = createMiniSearch();
    ms.addAll([
      {
        id: 'a',
        title: 'Pumpkin',
        headings: 'Carving',
        body: 'spice',
        url: '/halloween',
        section: 'recipes',
      },
    ]);
    expect(ms.search('pumpkin').length).toBeGreaterThan(0);
    expect(ms.search('carving').length).toBeGreaterThan(0);
    expect(ms.search('spice').length).toBeGreaterThan(0);
    expect(ms.search('halloween')).toEqual([]);
    expect(ms.search('recipes')).toEqual([]);
  });

  it('boosts title hits above body hits for the same query', () => {
    const ms = createMiniSearch();
    ms.addAll([
      {
        id: 'title',
        title: 'observability',
        headings: '',
        body: '',
        url: '/t',
      },
      {
        id: 'body',
        title: 'home',
        headings: '',
        body: 'we mention observability deep inside the body somewhere',
        url: '/b',
      },
    ]);
    const rows = ms.search('observability');
    expect(rows[0]?.id).toBe('title');
  });
});

describe('buildSearchIndex', () => {
  it('round-trips: index → toJSON → loadJSON → search works', () => {
    const built = buildSearchIndex(SAMPLE_DOCS);
    const json = JSON.stringify(built.index);
    const restored = MiniSearch.loadJSON(json, {
      fields: ['title', 'headings', 'body'],
      storeFields: ['title', 'url', 'section', 'locale', 'snippet', 'weight'],
      searchOptions: DEFAULT_SEARCH_OPTIONS,
    });

    const hits = restored.search('configuration');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.title).toBe('Configuration');
  });

  it('returns one stored doc per input, without the body', () => {
    const built = buildSearchIndex(SAMPLE_DOCS);
    expect(built.docs).toHaveLength(SAMPLE_DOCS.length);
    expect(built.docs[0]?.title).toBe(SAMPLE_DOCS[0].title);
    expect(built.docs[0]).not.toHaveProperty('body');
    expect(built.docs[0]).not.toHaveProperty('headings');
  });

  it('stores a snippet of at most 1500 characters, snapped to a word', () => {
    const longBody = 'word '.repeat(400).trim();
    expect(longBody.length).toBeGreaterThan(1500);
    const built = buildSearchIndex([
      { id: 'big', title: 'Big', headings: '', body: longBody, url: '/big' },
    ]);
    const stored = built.docs[0].snippet;
    expect(stored.length).toBeLessThanOrEqual(1500);
    // Word boundary: should not end mid-token. Each token is "word" so the
    // last 4 chars should be "word" — never a partial like "wo" or "wor".
    expect(stored.endsWith('word')).toBe(true);
    // The serialised index stores the snippet, never the full body.
    const serialised = JSON.parse(JSON.stringify(built.index)) as {
      storedFields: Record<string, Record<string, unknown>>;
    };
    expect(serialised.storedFields['0']).toHaveProperty('snippet', stored);
    expect(serialised.storedFields['0']).not.toHaveProperty('body');
  });

  it('indexes the full body: a term past the snippet is still a hit', () => {
    const longBody =
      'filler '.repeat(400) + 'WEBDAV_MAX_PUT_BYTES caps the upload';
    const built = buildSearchIndex([
      {
        id: 'ref',
        title: 'Reference',
        headings: '',
        body: longBody,
        url: '/r',
      },
    ]);
    expect(built.docs[0].snippet).not.toContain('WEBDAV_MAX_PUT_BYTES');
    const restored = MiniSearch.loadJSON(JSON.stringify(built.index), {
      fields: ['title', 'headings', 'body'],
      storeFields: ['title', 'url', 'section', 'locale', 'snippet', 'weight'],
      searchOptions: DEFAULT_SEARCH_OPTIONS,
    });
    const hits = restored.search('WEBDAV_MAX_PUT_BYTES');
    expect(hits.map((h) => h.id)).toEqual(['ref']);
    expect(hits[0]?.snippet).toBe(built.docs[0].snippet);
  });

  it('leaves a short body untouched as the snippet', () => {
    const built = buildSearchIndex([
      { id: 's', title: 'S', headings: '', body: 'short body', url: '/' },
    ]);
    expect(built.docs[0].snippet).toBe('short body');
  });
});
