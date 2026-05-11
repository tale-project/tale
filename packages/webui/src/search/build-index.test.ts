import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';

import { SAMPLE_DOCS } from './__fixtures__/sample-docs';
import {
  buildSearchIndex,
  createMiniSearch,
  DEFAULT_SEARCH_OPTIONS,
  stripMarkdown,
} from './build-index';

describe('stripMarkdown', () => {
  it('drops fenced code blocks entirely', () => {
    const md = 'before\n```ts\nconst x: number = 1;\n```\nafter';
    expect(stripMarkdown(md)).toBe('before after');
  });

  it('drops inline code', () => {
    expect(stripMarkdown('use the `cli` to deploy')).toBe('use the to deploy');
  });

  it('keeps visible text from inline links, drops the URL', () => {
    expect(stripMarkdown('See [the docs](https://example.com).')).toBe(
      'See the docs.',
    );
  });

  it('drops images entirely', () => {
    expect(stripMarkdown('hello ![alt](img.png) world')).toBe('hello world');
  });

  it('strips html tags', () => {
    expect(stripMarkdown('a <span class="x">b</span> c')).toBe('a b c');
  });

  it('strips blockquote prefixes', () => {
    expect(stripMarkdown('> quoted\n> more')).toBe('quoted more');
  });

  it('strips heading hashes but keeps the heading text', () => {
    expect(stripMarkdown('# Title\n## Sub')).toBe('Title Sub');
  });

  it('strips emphasis markers', () => {
    expect(stripMarkdown('a *b* _c_ ~d~')).toBe('a b c d');
  });

  it('collapses runs of whitespace', () => {
    expect(stripMarkdown('a   b\n\nc')).toBe('a b c');
  });

  it('strips heading-anchor extensions like `{#foo}`', () => {
    expect(stripMarkdown('### Upload-Richtlinie {#upload-policy}')).toBe(
      'Upload-Richtlinie',
    );
  });

  it('strips inline `{#foo}` even when it sits inside a body line', () => {
    expect(stripMarkdown('See Upload-Richtlinie {#upload-policy} below.')).toBe(
      'See Upload-Richtlinie below.',
    );
  });

  it('drops a markdown table separator row', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    // Cells survive (as prose) but pipes and the `---` divider are gone.
    expect(stripMarkdown(md)).toBe('a b 1 2');
  });

  it('drops table separators with alignment colons', () => {
    const md = '| a | b |\n| :--- | ---: |\n| 1 | 2 |';
    expect(stripMarkdown(md)).toBe('a b 1 2');
  });

  it('leaves real prose `|` and `---` outside tables alone-ish', () => {
    // A standalone `---` page break is collapsed to a space (no row context),
    // which is fine for snippet purposes — readers don't expect mdast HRs in
    // a one-line excerpt.
    expect(stripMarkdown('foo --- bar')).toBe('foo --- bar');
    // Pipes in prose still get replaced (acceptable cost) — verifies docs
    // shouldn't rely on raw pipes outside tables.
    expect(stripMarkdown('a | b')).toBe('a b');
  });
});

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
      storeFields: ['title', 'url', 'section', 'locale', 'body', 'weight'],
      searchOptions: DEFAULT_SEARCH_OPTIONS,
    });

    const hits = restored.search('configuration');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.title).toBe('Configuration');
  });

  it('returns the same docs as input plus body truncation if needed', () => {
    const built = buildSearchIndex(SAMPLE_DOCS);
    expect(built.docs).toHaveLength(SAMPLE_DOCS.length);
    expect(built.docs[0]?.title).toBe(SAMPLE_DOCS[0].title);
  });

  it('truncates oversized bodies and snaps to a word boundary', () => {
    const longBody = 'word '.repeat(400).trim();
    expect(longBody.length).toBeGreaterThan(1500);
    const built = buildSearchIndex([
      { id: 'big', title: 'Big', headings: '', body: longBody, url: '/big' },
    ]);
    const stored = built.docs[0].body;
    expect(stored.length).toBeLessThanOrEqual(1500);
    // Word boundary: should not end mid-token. Each token is "word" so the
    // last 4 chars should be "word" — never a partial like "wo" or "wor".
    expect(stored.endsWith('word')).toBe(true);
  });

  it('leaves a short body untouched', () => {
    const built = buildSearchIndex([
      { id: 's', title: 'S', headings: '', body: 'short body', url: '/' },
    ]);
    expect(built.docs[0].body).toBe('short body');
  });
});
