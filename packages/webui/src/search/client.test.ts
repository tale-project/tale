import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SAMPLE_DOCS, SAMPLE_DOCS_DE } from './__fixtures__/sample-docs';
import {
  buildSearchIndex,
  type SearchDoc,
  type SerializedIndex,
} from './build-index';
import {
  loadIndex,
  proximityBoost,
  rerank,
  resetSearchCache,
  search,
} from './client';

function makeIndexResponse(docs: readonly SearchDoc[]): Response {
  const built: SerializedIndex = buildSearchIndex(docs);
  return new Response(JSON.stringify(built), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(
  responder: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return responder(url);
  });
  // oxlint-disable-next-line typescript/no-explicit-any -- jsdom global type
  vi.stubGlobal('fetch', spy as any);
  return spy;
}

describe('loadIndex', () => {
  beforeEach(() => {
    resetSearchCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSearchCache();
  });

  it('fetches the per-locale JSON and hydrates a MiniSearch instance', async () => {
    const fetchSpy = stubFetch((url) => {
      expect(url).toBe('/search-index-en.json');
      return makeIndexResponse(SAMPLE_DOCS);
    });
    const ms = await loadIndex('en');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(ms.search('configuration').length).toBeGreaterThan(0);
  });

  it('respects baseUrl when building the index URL', async () => {
    const fetchSpy = stubFetch((url) => {
      expect(url).toBe('https://cdn.example.com/search-index-en.json');
      return makeIndexResponse(SAMPLE_DOCS);
    });
    await loadIndex('en', 'https://cdn.example.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the cached instance for repeat calls on the same locale', async () => {
    const fetchSpy = stubFetch(() => makeIndexResponse(SAMPLE_DOCS));
    const a = await loadIndex('en');
    const b = await loadIndex('en');
    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when the fetch returns a non-2xx', async () => {
    stubFetch(() => new Response('not found', { status: 404 }));
    await expect(loadIndex('en')).rejects.toThrow(/failed to load .*: 404/);
  });

  it('drops the slot on failure so a retry can succeed', async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      if (attempt === 1) return new Response('boom', { status: 500 });
      return makeIndexResponse(SAMPLE_DOCS);
    });
    await expect(loadIndex('en')).rejects.toThrow();
    const ms = await loadIndex('en');
    expect(ms.search('configuration').length).toBeGreaterThan(0);
    expect(attempt).toBe(2);
  });

  it('is race-safe across locales: concurrent calls resolve to distinct indices', async () => {
    stubFetch((url) => {
      if (url.endsWith('search-index-en.json')) {
        return makeIndexResponse(SAMPLE_DOCS);
      }
      if (url.endsWith('search-index-de.json')) {
        return makeIndexResponse(SAMPLE_DOCS_DE);
      }
      return new Response('not found', { status: 404 });
    });
    const [en, de] = await Promise.all([loadIndex('en'), loadIndex('de')]);
    expect(en).not.toBe(de);
    // Each index returns only docs from its own corpus — IDs are locale-prefixed.
    const enHits = en.search('configuration');
    const deHits = de.search('konfiguration');
    expect(enHits.length).toBeGreaterThan(0);
    expect(deHits.length).toBeGreaterThan(0);
    expect(enHits.every((r) => String(r.id).startsWith('en:'))).toBe(true);
    expect(deHits.every((r) => String(r.id).startsWith('de:'))).toBe(true);
  });

  it('dedupes concurrent calls for the same locale onto one fetch', async () => {
    const fetchSpy = stubFetch(() => makeIndexResponse(SAMPLE_DOCS));
    const [a, b] = await Promise.all([loadIndex('en'), loadIndex('en')]);
    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resetSearchCache clears every locale', async () => {
    const fetchSpy = stubFetch(() => makeIndexResponse(SAMPLE_DOCS));
    await loadIndex('en');
    resetSearchCache();
    await loadIndex('en');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('search', () => {
  beforeEach(() => {
    resetSearchCache();
    stubFetch(() => makeIndexResponse(SAMPLE_DOCS));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSearchCache();
  });

  it('returns [] for an empty / whitespace query', async () => {
    expect(await search('en', '')).toEqual([]);
    expect(await search('en', '   ')).toEqual([]);
  });

  it('returns results for a single-token query', async () => {
    const rows = await search('en', 'configuration');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.title).toBe('Configuration');
  });

  it('exposes matchedTerms/queryTerms/match on every result', async () => {
    const rows = await search('en', 'configuration');
    const top = rows[0];
    expect(Array.isArray(top.matchedTerms)).toBe(true);
    expect(Array.isArray(top.queryTerms)).toBe(true);
    expect(top.queryTerms).toContain('configuration');
    expect(typeof top.match).toBe('object');
    // The title field is the one that fired for this query.
    expect(Object.values(top.match).flat()).toContain('title');
  });

  it('highlights *what was matched* — prefix expansion surfaces "configuration" for query "config"', async () => {
    const rows = await search('en', 'config');
    const top = rows[0];
    expect(top.title).toBe('Configuration');
    // Prefix expansion should surface "configuration" as the index term that
    // fired, even though the user typed "config".
    expect(top.matchedTerms).toContain('configuration');
  });

  it('falls back to OR when AND yields a thin result set for multi-token', async () => {
    // "rag observability" — those words don't co-occur in any single doc
    // under AND (rag is only in the rag and observability pages, but the
    // platform/observability page does have both "rag" and the title
    // "observability"). Pick a pair that's clearly AND-unsatisfiable:
    // "windows configuration" — appears in cli/install + platform/configuration
    // but never in the same doc. AND yields 0 → OR fallback should populate.
    const rows = await search('en', 'windows configuration');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('demotes body-only matches relative to title/heading matches', async () => {
    const rows = await search('en', 'configuration');
    // The platform/observability page mentions "configure" in the body only;
    // it must not outrank the dedicated Configuration page.
    expect(rows[0]?.id).toBe('en:platform/configuration');
  });

  it('boosts proximity: co-located terms beat spread-out terms', async () => {
    // "configure rag" — the rag page has them adjacent in a heading + body;
    // the observability page mentions "configure" early and "rag" much later.
    const rows = await search('en', 'configure rag');
    // RAG page must rank above observability when proximity matters.
    const rag = rows.findIndex((r) => r.id === 'en:platform/rag');
    const obs = rows.findIndex((r) => r.id === 'en:platform/observability');
    expect(rag).toBeGreaterThanOrEqual(0);
    if (obs >= 0) {
      expect(rag).toBeLessThan(obs);
    }
  });

  it('sorts results by score descending', async () => {
    const rows = await search('en', 'configuration');
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
  });
});

describe('rerank (unit)', () => {
  it('multiplies score by coverage when not all tokens matched', () => {
    const rows = rerank(
      [
        {
          id: 'a',
          score: 10,
          terms: ['config'],
          queryTerms: ['config'],
          match: { config: ['title'] },
          body: 'config',
        },
      ],
      ['config', 'rag'],
    );
    // coverage = 1/2 → 0.6 + 0.4 * 0.5 = 0.8; title bonus 1.6;
    // 10 * 0.8 * 1.6 = 12.8
    expect(rows[0].score).toBeCloseTo(12.8, 5);
  });

  it('applies the body-only penalty', () => {
    const rows = rerank(
      [
        {
          id: 'a',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['body'] },
          body: 'x',
        },
      ],
      ['x'],
    );
    // Single token, full coverage, body-only penalty 0.6 → 10 * 0.6 = 6.
    expect(rows[0].score).toBeCloseTo(6, 5);
  });

  it('boosts results that matched in the title field', () => {
    const rows = rerank(
      [
        {
          id: 'a',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['title', 'body'] },
          body: 'x',
        },
      ],
      ['x'],
    );
    // Title bonus 1.6 (heading bonus is mutually exclusive); not body-only.
    expect(rows[0].score).toBeCloseTo(16, 5);
  });

  it('boosts heading-only matches (smaller than title)', () => {
    const rows = rerank(
      [
        {
          id: 'a',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['headings'] },
          body: 'x',
        },
      ],
      ['x'],
    );
    // Heading bonus 1.15 (no title); not body-only because only field is headings.
    expect(rows[0].score).toBeCloseTo(11.5, 5);
  });

  it('boosts results whose URL contains a query token (slug match)', () => {
    const rows = rerank(
      [
        {
          id: 'a',
          score: 10,
          terms: ['retention'],
          queryTerms: ['retention'],
          match: { retention: ['body'] },
          body: 'retention',
          url: '/platform/retention/limits',
        },
      ],
      ['retention'],
    );
    // body-only 0.6; slug bonus 1.25 → 10 * 0.6 * 1.25 = 7.5.
    expect(rows[0].score).toBeCloseTo(7.5, 5);
  });

  it('skips slug bonus when no token reaches 3 characters', () => {
    const rows = rerank(
      [
        {
          id: 'a',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['body'] },
          body: 'x',
          url: '/x/y',
        },
      ],
      ['x'],
    );
    expect(rows[0].score).toBeCloseTo(6, 5);
  });

  it('title-match doc outranks a doc with the same MiniSearch score that matched only in body', () => {
    const rows = rerank(
      [
        {
          id: 'body-only',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['body'] },
          body: 'x',
        },
        {
          id: 'title-hit',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['title'] },
          body: 'x',
        },
      ],
      ['x'],
    );
    expect(rows.map((r) => r.id)).toEqual(['title-hit', 'body-only']);
  });

  it('sorts the rerank output by descending score', () => {
    const rows = rerank(
      [
        {
          id: 'low',
          score: 1,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['title'] },
          body: '',
        },
        {
          id: 'high',
          score: 10,
          terms: ['x'],
          queryTerms: ['x'],
          match: { x: ['title'] },
          body: '',
        },
      ],
      ['x'],
    );
    expect(rows.map((r) => r.id)).toEqual(['high', 'low']);
  });

  it('coerces missing fields without throwing', () => {
    const rows = rerank(
      // oxlint-disable-next-line typescript/no-explicit-any -- partial fixture
      [{ id: 1, score: 5 } as any],
      ['x'],
    );
    expect(rows[0].id).toBe('1');
    expect(rows[0].title).toBe('');
    expect(rows[0].matchedTerms).toEqual([]);
  });
});

describe('proximityBoost (unit)', () => {
  it('returns 1 when fewer than two tokens are present', () => {
    expect(proximityBoost('lorem ipsum', ['unrelated'])).toBe(1);
    expect(proximityBoost('config only', ['config', 'missing'])).toBe(1);
  });

  it('returns 1.4 when tokens are within 60 chars', () => {
    expect(
      proximityBoost('configure the rag service please', ['configure', 'rag']),
    ).toBe(1.4);
  });

  it('returns 1.15 when tokens are between 60-200 chars apart', () => {
    const body = 'configure ' + 'x '.repeat(50) + 'rag';
    expect(proximityBoost(body, ['configure', 'rag'])).toBe(1.15);
  });

  it('returns 1 when tokens are far apart (>200 chars)', () => {
    const body = 'configure ' + 'x '.repeat(120) + 'rag';
    expect(proximityBoost(body, ['configure', 'rag'])).toBe(1);
  });

  it('returns 1 for an empty body', () => {
    expect(proximityBoost('', ['a', 'b'])).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(
      proximityBoost('Configure The RAG service', ['configure', 'rag']),
    ).toBe(1.4);
  });
});
