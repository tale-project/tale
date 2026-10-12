import { describe, expect, it } from 'vitest';

import { stripMarkdown } from './strip-markdown';

describe('stripMarkdown', () => {
  it('drops fenced code blocks entirely', () => {
    const md = 'before\n```ts\nconst x: number = 1;\n```\nafter';
    expect(stripMarkdown(md)).toBe('before after');
  });

  it('keeps the text of inline code — codes, headers and env vars are searched for', () => {
    expect(stripMarkdown('use the `cli` to deploy')).toBe(
      'use the cli to deploy',
    );
    expect(
      stripMarkdown(
        'answers `400` with `ORG_SLUG_REQUIRED`; send `Idempotency-Key`.',
      ),
    ).toBe('answers 400 with ORG_SLUG_REQUIRED ; send Idempotency-Key .');
  });

  it('strips emphasis only at word boundaries, so identifiers survive', () => {
    expect(stripMarkdown('**Settings > API** then _save_')).toBe(
      'Settings > API then save',
    );
    expect(stripMarkdown('set WEBDAV_MAX_PUT_BYTES or __automation__')).toBe(
      'set WEBDAV_MAX_PUT_BYTES or automation',
    );
    expect(stripMarkdown('- item one\n* item two\n+ item three')).toBe(
      'item one item two item three',
    );
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
