import { describe, expect, it } from 'vitest';

import { extractToc } from './extract-toc';

describe('extractToc', () => {
  it('returns an empty array for empty input', () => {
    expect(extractToc('')).toEqual([]);
  });

  it('only emits h2 and h3 from h1-h6 ATX headings', () => {
    const md = [
      '# H1 skipped',
      '## H2 ok',
      '### H3 ok',
      '#### H4 skipped',
      '##### H5 skipped',
      '###### H6 skipped',
    ].join('\n');
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'H2 ok', id: 'h2-ok' },
      { level: 3, text: 'H3 ok', id: 'h3-ok' },
    ]);
  });

  it('strips bold, emphasis, strike, and inline code wrappers from heading text', () => {
    const md = '## Use **flags** and `code`';
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'Use flags and code', id: 'use-flags-and-code' },
    ]);
  });

  it('also strips emphasis written with single asterisks/underscores and tilde strike', () => {
    const md = [
      '## *italic* and _under_ and ~~strike~~',
      '### __bold__ underscores',
    ].join('\n');
    expect(extractToc(md)).toEqual([
      {
        level: 2,
        text: 'italic and under and strike',
        id: 'italic-and-under-and-strike',
      },
      { level: 3, text: 'bold underscores', id: 'bold-underscores' },
    ]);
  });

  it('strips link wrappers so the slug matches the rendered DOM id', () => {
    const md = '## [Read more](/x) about';
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'Read more about', id: 'read-more-about' },
    ]);
  });

  it('strips reference-style links and image wrappers from heading text', () => {
    const md = [
      '## [ref][1] then text',
      '### before ![alt text](/img.png) after',
    ].join('\n');
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'ref then text', id: 'ref-then-text' },
      { level: 3, text: 'before alt text after', id: 'before-alt-text-after' },
    ]);
  });

  it('produces unique non-empty slugs for German umlaut/eszett collisions', () => {
    const md = ['## Über große Größe', '## große', '## Größe'].join('\n');
    const entries = extractToc(md);
    expect(entries).toEqual([
      {
        level: 2,
        text: 'Über große Größe',
        id: 'ueber-grosse-groesse',
      },
      { level: 2, text: 'große', id: 'grosse' },
      { level: 2, text: 'Größe', id: 'groesse' },
    ]);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).not.toBe('');
      expect(id).not.toBe('section');
    }
  });

  it('strips combining diacritics from French accents', () => {
    const md = '## Café';
    expect(extractToc(md)).toEqual([{ level: 2, text: 'Café', id: 'cafe' }]);
  });

  it('falls back to "section" for CJK/emoji-only headings whose chars get fully stripped', () => {
    const md = ['## 你好', '### 🚀🚀'].join('\n');
    expect(extractToc(md)).toEqual([
      { level: 2, text: '你好', id: 'section' },
      { level: 3, text: '🚀🚀', id: 'section' },
    ]);
  });

  it('handles numbers and dashes (dots are stripped, hyphen runs collapse)', () => {
    const md = '## v1.2.3 release';
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'v1.2.3 release', id: 'v123-release' },
    ]);
  });

  it('collapses repeated hyphens / whitespace into single hyphens', () => {
    const md = '##   spaced    out   words';
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'spaced    out   words', id: 'spaced-out-words' },
    ]);
  });

  it('does not scan inside fenced code blocks', () => {
    const md = [
      '## real heading',
      '```',
      '# foo',
      '## bar',
      '### baz',
      '```',
      '## after fence',
    ].join('\n');
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'real heading', id: 'real-heading' },
      { level: 2, text: 'after fence', id: 'after-fence' },
    ]);
  });

  it('skips headings inside HTML comments', () => {
    const md = [
      '## visible',
      '<!--',
      '## hidden',
      '-->',
      '## also visible',
    ].join('\n');
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'visible', id: 'visible' },
      { level: 2, text: 'also visible', id: 'also-visible' },
    ]);
  });

  it('trims trailing closing # markers (closed ATX style)', () => {
    const md = '## Heading ##';
    expect(extractToc(md)).toEqual([
      { level: 2, text: 'Heading', id: 'heading' },
    ]);
  });
});
