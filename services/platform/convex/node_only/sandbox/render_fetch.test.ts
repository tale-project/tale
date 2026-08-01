import { describe, expect, it } from 'vitest';

import { parseRenderResults } from './render_fetch';

/**
 * The worker↔engine protocol, pinned: what the crawl engine does with a page
 * hinges on this mapping — `ok` stores content, `failed` charges the page's
 * fail_count, `not_attempted` leaves the row due for the next link. A
 * malformed record must never look like a success.
 */

const URLS = ['https://a.ch/x', 'https://a.ch/y'] as const;

describe('parseRenderResults', () => {
  it('maps rendered pages, failures, and untouched URLs', () => {
    const results = parseRenderResults(
      {
        pages: [
          {
            url: 'https://a.ch/x',
            attempted: true,
            status: 200,
            finalUrl: 'https://a.ch/x2',
            html: '<html>ok</html>',
          },
          { url: 'https://a.ch/y', attempted: true, error: 'nav timeout' },
        ],
      },
      URLS,
    );
    expect(results.get('https://a.ch/x')).toEqual({
      kind: 'ok',
      status: 200,
      finalUrl: 'https://a.ch/x2',
      html: '<html>ok</html>',
    });
    expect(results.get('https://a.ch/y')).toEqual({
      kind: 'failed',
      reason: 'nav timeout',
    });
  });

  it('treats a URL the worker never reached as not attempted', () => {
    const results = parseRenderResults(
      { pages: [{ url: 'https://a.ch/x', attempted: false }] },
      URLS,
    );
    expect(results.get('https://a.ch/x')).toEqual({ kind: 'not_attempted' });
    expect(results.get('https://a.ch/y')).toEqual({ kind: 'not_attempted' });
  });

  it('never turns a malformed record into a success', () => {
    const results = parseRenderResults(
      {
        pages: [
          // Attempted but no html and no error: failed with a stock reason.
          { url: 'https://a.ch/x', attempted: true, status: 200 },
          // Unknown URL and junk entries: ignored.
          { url: 'https://other.ch/z', attempted: true, html: '<p>' },
          null,
          'garbage',
        ],
      },
      URLS,
    );
    expect(results.get('https://a.ch/x')).toEqual({
      kind: 'failed',
      reason: 'render produced no content',
    });
    expect(results.get('https://a.ch/y')).toEqual({ kind: 'not_attempted' });
    expect(results.size).toBe(2);
  });

  it('survives a payload that is not an object at all', () => {
    for (const payload of [null, 42, 'nope', { pages: 'nope' }]) {
      const results = parseRenderResults(payload, URLS);
      expect(results.get('https://a.ch/x')).toEqual({ kind: 'not_attempted' });
    }
  });
});
