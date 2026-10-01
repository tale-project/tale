import { describe, expect, it } from 'vitest';

import {
  decodeHtmlEntities,
  htmlTitle,
  htmlToText,
  RENDERED_LAYOUT_ATTRIBUTE,
} from './html-to-text';

describe('htmlToText', () => {
  it('drops scripts and styles wholesale and keeps the prose', () => {
    const text = htmlToText(
      '<html><head><title>T</title><style>p{color:red}</style></head>' +
        '<body><script>alert("x")</script><p>Hello world.</p></body></html>',
    );
    expect(text).toBe('Hello world.');
  });

  it('keeps block structure, headings, and list markers readable', () => {
    const text = htmlToText(
      '<h2>Returns</h2><p>Two rules:</p><ul><li>30 days</li><li>Receipt required</li></ul>',
    );
    expect(text).toBe(
      '## Returns\n\nTwo rules:\n\n- 30 days\n\n- Receipt required',
    );
  });

  it('keeps absolute links as markdown and flattens relative ones', () => {
    const text = htmlToText(
      '<p>See <a href="https://example.com/a">the docs</a> or <a href="/local">here</a>.</p>',
    );
    expect(text).toContain('[the docs](https://example.com/a)');
    expect(text).toContain('here');
    expect(text).not.toContain('/local');
  });

  it('decodes the entities prose actually uses', () => {
    expect(decodeHtmlEntities('Fish &amp; Chips &#8212; &lt;tasty&gt;')).toBe(
      'Fish & Chips — <tasty>',
    );
    // Unknown entities pass through rather than being mangled.
    expect(decodeHtmlEntities('&nosuchentity;')).toBe('&nosuchentity;');
  });

  it('drops the doctype, processing instructions and CDATA wrappers, not only elements', () => {
    const text = htmlToText(
      '<!DOCTYPE html><?xml version="1.0"?><html><body><![CDATA[raw]]><p>Example Domain</p><!--[if IE]>old<![endif]--></body></html>',
    );
    expect(text).toBe('Example Domain');
  });

  // Regression: every inline tag became a space and a whitespace-only span
  // collapsed away, so example.com — whose script splits its text into one
  // <span> per character — was indexed as "T h i s d o m a i n i s …" and
  // no search for any of its words could match. The crawler's render lane
  // now hands over markup with the page's layout written in, and marks it.
  describe('markup the render lane laid out', () => {
    const laidOut = (body: string): string =>
      `<!DOCTYPE html><html lang="en" ${RENDERED_LAYOUT_ATTRIBUTE}="1"><body>${body}</body></html>`;
    const spell = (text: string): string =>
      text
        .split('')
        .map((char) => `<span>${char}</span>`)
        .join('');

    it('reads text split into one span per letter as words', () => {
      expect(
        htmlToText(
          laidOut(`<p>${spell('This domain is for use in examples.')}</p>`),
        ),
      ).toBe('This domain is for use in examples.');
    });

    it('adds no space at inline formatting, inside links too', () => {
      expect(
        htmlToText(laidOut('<p><b>Im</b>portant <em>news</em>!</p>')),
      ).toBe('Important news!');
      expect(
        htmlToText(
          laidOut(
            '<p><a href="https://example.com/"><span>Ex</span><span>ample</span></a></p>',
          ),
        ),
      ).toBe('[Example](https://example.com/)');
    });

    it('keeps a word boundary at tags that are not inline formatting', () => {
      expect(
        htmlToText(
          laidOut('<p><button>Save</button><button>Cancel</button></p>'),
        ),
      ).toBe('Save Cancel');
      expect(
        htmlToText(laidOut('<p>Before<img src="x.png" alt="">after</p>')),
      ).toBe('Before after');
    });
  });

  // Without the page's CSS nothing tells a bold syllable from two spans a
  // stylesheet sets apart, and the second is by far the commoner: a fetched
  // page, a mail body and a searched message keep a space at every tag.
  it('keeps a word boundary at every tag of markup that carries no layout', () => {
    expect(
      htmlToText(
        '<div class="flex"><span>Total</span><span>CHF 120</span></div>',
      ),
    ).toBe('Total CHF 120');
    expect(
      htmlToText(
        '<span style="display:block">Max Muster</span><span style="display:block">CEO</span>',
      ),
    ).toBe('Max Muster CEO');
    // The attribute counts on the document element only.
    expect(
      htmlToText(
        `<div ${RENDERED_LAYOUT_ATTRIBUTE}="1"><span>Total</span><span>CHF</span></div>`,
      ),
    ).toBe('Total CHF');
  });

  /**
   * Markup whose tags are never closed. The patterns looked for each tag's
   * end to the end of the input, from every opener: 29 KB of
   * `<a href="…" ` took six seconds, 58 KB more than twenty — on the one
   * thread that serves every request, for text a page, a sitemap or a mail
   * sender chooses. Each case is a megabyte or so and has to finish far
   * inside a second; before, none of them finished at all.
   */
  describe('markup that never closes its tags', () => {
    const RUN = 50_000;
    const cases: [string, string][] = [
      ['links with no end', '<a href="https://x.example/" '.repeat(RUN)],
      [
        'links whose only end is the last one',
        `${'<a href="x" '.repeat(RUN)}></a>`,
      ],
      [
        'unquoted links in raw text',
        `<xmp>${'<a href=x '.repeat(RUN)}</xmp></a>`,
      ],
      ['open quotes', `${'<a href="'.repeat(RUN)}</a>`],
      [
        'tags inside a link',
        `<a href="https://x.example/">${'<b '.repeat(RUN)}</a>`,
      ],
      ['tags with no end', '<b '.repeat(RUN)],
      ['comments with no end', '<!-- '.repeat(RUN)],
      ['scripts with no end', '<script '.repeat(RUN)],
      ['conditional markers', `${'<!['.repeat(RUN)}]x ]>`],
      [
        'list items then links',
        `${'<li '.repeat(RUN)}>${'<a href="u" '.repeat(RUN)}></a>`,
      ],
    ];

    it.each(cases)('converts %s in linear time', (_shape, html) => {
      const startedAt = performance.now();
      htmlToText(html);
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    });

    it('reads a title among unclosed title tags in linear time', () => {
      const startedAt = performance.now();
      expect(htmlTitle(`${'<title '.repeat(RUN)}</title>`)).toBeNull();
      expect(htmlTitle('<title '.repeat(RUN))).toBeNull();
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    });

    it('still converts what comes before the run', () => {
      expect(
        htmlToText(`<p>Before <b>the</b> run</p>${'<b '.repeat(10)}`),
      ).toBe(`Before the run\n${'<b '.repeat(10).trim()}`);
    });
  });

  /**
   * Text that opens on a run of whitespace. The test for the render lane's
   * mark allowed whitespace on both sides of an optional doctype, so on a
   * run that no `<html` follows it tried every split of the run between the
   * two: 120 KB of spaces took four seconds, and `web_fetch` reads four
   * megabytes. The mark is looked for before anything else, so this ran on
   * every page, mail body and searched message, not on rendered ones alone.
   */
  describe('text that opens on a run of whitespace', () => {
    const RUN = 500_000;
    const cases: [string, string, string][] = [
      ['spaces before markup', `${' '.repeat(RUN)}<p>word</p>`, 'word'],
      ['line breaks before text', `${'\n'.repeat(RUN)}word`, 'word'],
      [
        'whitespace on both sides of a doctype',
        `${' '.repeat(RUN)}<!DOCTYPE html>${'\t'.repeat(RUN)}<p>word</p>`,
        'word',
      ],
    ];

    it.each(cases)('converts %s in linear time', (_shape, html, text) => {
      const startedAt = performance.now();
      expect(htmlToText(html)).toBe(text);
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    });

    it('still finds the mark behind whitespace and a doctype', () => {
      const letters = '<p><span>O</span><span>K</span></p>';
      expect(
        htmlToText(
          `\n <!DOCTYPE html>\n<html ${RENDERED_LAYOUT_ATTRIBUTE}="1">${letters}</html>`,
        ),
      ).toBe('OK');
      expect(
        htmlToText(
          `  <html ${RENDERED_LAYOUT_ATTRIBUTE}="1">${letters}</html>`,
        ),
      ).toBe('OK');
      expect(htmlToText(`<!DOCTYPE html>\n<html>${letters}</html>`)).toBe(
        'O K',
      );
    });
  });

  it('renders table cells with separators instead of gluing them', () => {
    const text = htmlToText(
      '<table><tr><th>Name</th><th>Price</th></tr><tr><td>Widget</td><td>9</td></tr></table>',
    );
    expect(text).toContain('Name | Price');
    expect(text).toContain('Widget | 9');
  });
});

describe('htmlTitle', () => {
  it('reads and decodes the title, collapsing whitespace', () => {
    expect(htmlTitle('<title>\n  Example &amp; Domain \n</title>')).toBe(
      'Example & Domain',
    );
    expect(htmlTitle('<p>no title</p>')).toBeNull();
  });
});
