import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readPageContent, unreadablePage } from './main-content';

const PAGE_URL = 'https://example.com/library/hours';

/** Prose long enough to be a page's content (200 characters or more). */
const PROSE =
  'The reading room opens at nine and closes at six on weekdays. ' +
  'Books on the open shelves may be borrowed for four weeks and renewed twice, ' +
  'unless another reader has reserved them; rare books are read in the room only.';

const read = (html: string, url = PAGE_URL) => readPageContent(html, url);
const textOf = (html: string): string => read(html).text;

/** A page recorded from a real site. Kept as `.txt` so that the formatter
 * leaves the markup as it was served. */
const recorded = (name: string): string =>
  readFileSync(
    join(import.meta.dirname, 'fixtures', `${name}.html.txt`),
    'utf8',
  );

describe('readPageContent', () => {
  describe('the main region', () => {
    it('reads the <main> and leaves the chrome around it', () => {
      const page = read(
        '<!DOCTYPE html><html><head><title>Hours</title></head><body>' +
          '<a href="#content">Skip to main content</a>' +
          '<div class="banner">Your browser is no longer supported.</div>' +
          `<main id="content"><h1>Opening hours</h1><p>${PROSE}</p></main>` +
          '<div class="legal">Privacy · Terms · © 2026</div>' +
          '</body></html>',
      );
      expect(page.text).toBe(`# Opening hours\n\n${PROSE}`);
      expect(page.needsBrowser).toBe(false);
      expect(page.canonicalUrl).toBeNull();
    });

    it('reads an element with role="main"', () => {
      expect(
        textOf(
          '<div class="toc">Contents</div>' +
            `<div role="main"><p>${PROSE}</p></div>`,
        ),
      ).toBe(PROSE);
    });

    it('reads the longest of several mains', () => {
      expect(
        textOf(
          '<main><p>Teaser</p></main>' +
            `<main><p>${PROSE}</p></main>` +
            '<main><p>Another teaser</p></main>',
        ),
      ).toBe(PROSE);
    });

    it('reads the one article of a page without a main', () => {
      expect(
        textOf(
          '<div class="sidebar">Recent posts</div>' +
            `<article><h2>Opening hours</h2><p>${PROSE}</p></article>` +
            '<div class="legal">Privacy</div>',
        ),
      ).toBe(`## Opening hours\n\n${PROSE}`);
    });

    it('reads the body of a page with several articles', () => {
      const text = textOf(
        '<body><p>Latest news</p>' +
          `<article><p>${PROSE}</p></article>` +
          '<article><p>The library closes on public holidays.</p></article>' +
          '</body>',
      );
      expect(text).toContain('Latest news');
      expect(text).toContain(PROSE);
      expect(text).toContain('The library closes on public holidays.');
    });

    it('passes over a main too short to hold the page for the body', () => {
      expect(
        textOf(
          '<body><main><p>Opening hours</p></main>' +
            `<div class="hours"><p>${PROSE}</p></div></body>`,
        ),
      ).toBe(`Opening hours\n\n${PROSE}`);
    });

    it('reads the whole page when everything in its body is cut', () => {
      // A site that opens a dialog hides the page behind it from assistive
      // technology: the page is still what there is to read.
      const text = textOf(
        `<body><div id="page" aria-hidden="true"><p>${PROSE}</p></div>` +
          '<div role="dialog"><p>Sign up for our newsletter</p></div></body>',
      );
      expect(text).toContain(PROSE);
      expect(text).toContain('Sign up for our newsletter');
    });

    it('reads the whole page when its body holds nothing', () => {
      expect(textOf(`<p>${PROSE}</p><body></body>`)).toBe(PROSE);
    });

    it('reads a page without markup as its text', () => {
      expect(textOf('Plain words, no tags.')).toBe('Plain words, no tags.');
      expect(textOf('')).toBe('');
    });
  });

  describe('what is not content', () => {
    /** The text of a main that holds `markup` and the prose after it. */
    const inMain = (markup: string): string =>
      textOf(`<main>${markup}<p>${PROSE}</p></main>`);

    it.each([
      ['navigation', '<nav><a href="/">Home</a> › Hours</nav>', 'Home'],
      ['a search', '<search><form>Find a book</form></search>', 'Find a book'],
      ['a dialog', '<dialog open><p>Subscribe now</p></dialog>', 'Subscribe'],
      [
        'an option list',
        '<select><option>North branch</option><option>South</option></select>',
        'North branch',
      ],
      ['a text field', '<textarea>Your comment</textarea>', 'Your comment'],
      ['a template', '<template><p>Row template</p></template>', 'Row'],
      ['a button', '<p><button>Copy link</button></p>', 'Copy link'],
      ['the hidden attribute', '<div hidden>Old hours</div>', 'Old hours'],
      ['aria-hidden', '<span aria-hidden="true">Icon name</span>', 'Icon'],
      ['display: none', '<p style="display: none">Old hours</p>', 'Old hours'],
      [
        'visibility: hidden',
        '<p style="color: red; visibility:hidden">Old hours</p>',
        'Old hours',
      ],
    ])('cuts %s', (_what, markup, cut) => {
      const text = inMain(markup);
      expect(text).not.toContain(cut);
      expect(text).toContain(PROSE);
    });

    it.each([
      'alertdialog',
      'banner',
      'complementary',
      'contentinfo',
      'dialog',
      'menu',
      'menubar',
      'navigation',
      'search',
      'toolbar',
    ])('cuts an element with role="%s"', (role) => {
      const text = inMain(`<div role="${role} region">Not content</div>`);
      expect(text).toBe(PROSE);
    });

    it('cuts the page header and footer and keeps an article’s own', () => {
      const text = textOf(
        '<body><header><a href="/">Example Library</a></header>' +
          '<div class="page"><article>' +
          '<header><h1>Opening hours</h1><p>By the front desk</p></header>' +
          `<p>${PROSE}</p>` +
          '<footer>Filed under: visiting</footer>' +
          '</article></div>' +
          '<footer>© 2026 Example Library</footer></body>',
      );
      expect(text).toBe(
        `# Opening hours\n\nBy the front desk\n\n${PROSE}\n\nFiled under: visiting`,
      );
    });

    it('cuts the page header and footer from the body', () => {
      expect(
        textOf(
          '<body><header>Example Library</header>' +
            `<div><p>${PROSE}</p></div>` +
            '<footer>© 2026 Example Library</footer></body>',
        ),
      ).toBe(PROSE);
    });

    it('cuts an aside beside the content and keeps one inside an article', () => {
      const text = textOf(
        '<main><aside>Related: our other branches</aside>' +
          `<article><p>${PROSE}</p><aside>Bring your library card.</aside></article>` +
          '</main>',
      );
      expect(text).not.toContain('Related');
      expect(text).toContain(PROSE);
      expect(text).toContain('Bring your library card.');
    });

    it('keeps a button that is a heading’s text', () => {
      // An accordion's heading is its button.
      expect(
        inMain('<h2><button aria-expanded="false">Holidays</button></h2>'),
      ).toBe(`## Holidays\n\n${PROSE}`);
    });

    it('keeps hidden content a page shows on demand', () => {
      const text = inMain(
        '<div role="tablist"><button aria-controls="tab-1 tab-2">Tabs</button></div>' +
          '<div role="tabpanel" hidden>Weekend hours</div>' +
          '<div id="tab-2" hidden>Holiday hours</div>' +
          '<div hidden="until-found">Summer hours</div>' +
          '<section role="region" style="display:none">Winter hours</section>',
      );
      expect(text).toContain('Weekend hours');
      expect(text).toContain('Holiday hours');
      expect(text).toContain('Summer hours');
      expect(text).toContain('Winter hours');
    });

    it('cuts a cookie notice around the content and keeps what only names cookies', () => {
      const text = textOf(
        '<body><div id="onetrust-consent-sdk"><p>We use cookies.</p></div>' +
          '<div class="cookie-bar">Accept all</div>' +
          `<div class="recipe"><p>${PROSE}</p></div>` +
          '<div class="cookie-recipes">Oat cookies</div></body>',
      );
      expect(text).not.toContain('We use cookies');
      expect(text).not.toContain('Accept all');
      expect(text).toContain(PROSE);
      expect(text).toContain('Oat cookies');
    });

    it('keeps a notice about cookies inside the main content', () => {
      expect(
        inMain('<div class="cookie-notice">How we use cookies</div>'),
      ).toContain('How we use cookies');
    });

    it('cuts what is nested in a cut element along with it', () => {
      const text = inMain(
        '<nav><div><ul><li><a href="/a">A</a><nav>Inner</nav></li></ul></div>Tail</nav>',
      );
      expect(text).toBe(PROSE);
    });
  });

  describe('where elements end', () => {
    /** The text of a main that holds `markup` after a long paragraph. */
    const inMain = (markup: string): string =>
      textOf(`<main><p>${PROSE}</p>${markup}</main>`);

    it.each([
      ['a list item at the next', '<ul><li hidden>Old<li>New</ul>'],
      ['a definition at the next', '<dl><dt hidden>Old<dd>New</dl>'],
      ['a paragraph at a block', '<p hidden>Old<div>New</div>'],
      [
        'a table row at the next',
        '<table><tr hidden><td>Old<tr><td>New</table>',
      ],
      ['a table cell at the next', '<table><tr><td hidden>Old<td>New</table>'],
      ['a heading at another', '<h2 hidden>Old<h3>New</h3>'],
      ['a button at another', '<button>Old<button hidden>Hidden</button>New'],
    ])('ends %s', (_where, markup) => {
      const text = inMain(markup);
      expect(text).toContain('New');
      expect(text).not.toContain('Old');
    });

    it('closes what an end tag skips over', () => {
      const text = inMain('<div hidden><span><b>Old</div><p>New</p>');
      expect(text).toContain('New');
      expect(text).not.toContain('Old');
    });

    it('ignores an end tag with no open element', () => {
      const text = inMain(
        '<div hidden>Old</span></p></li>Older</div><p>New</p>',
      );
      expect(text).toContain('New');
      expect(text).not.toContain('Old');
    });

    it('ignores an end tag that would close past a block', () => {
      // A browser leaves the span open: its end tag inside the block closes
      // nothing, and the text after the block is hidden too.
      const text = inMain(
        '<span hidden>Old <div>block</span> older</div> oldest</span><p>New</p>',
      );
      expect(text).toContain('New');
      expect(text).not.toMatch(/old|block/i);
    });

    it('ignores an end tag that would close past a table cell', () => {
      const text = inMain(
        '<div hidden><table><tr><td>Old</div>Older</td></tr></table>Oldest</div><p>New</p>',
      );
      expect(text).toContain('New');
      expect(text).not.toContain('Old');
    });

    it('ends any heading at a heading’s end tag', () => {
      const text = inMain('<h2 hidden>Old</h3><p>New</p>');
      expect(text).toContain('New');
      expect(text).not.toContain('Old');
    });

    it('ends an element at `/>` in SVG and MathML only', () => {
      const text = inMain(
        '<svg aria-hidden="true"/><p>Shown</p>' +
          '<math hidden><mi/></math><p>Also shown</p>' +
          '<div hidden/><p>Old</p>',
      );
      expect(text).toContain('Shown');
      expect(text).toContain('Also shown');
      expect(text).not.toContain('Old');
    });

    it('reads the elements whose content is text as text', () => {
      const text = inMain(
        '<script>document.write("<div hidden>")</script>' +
          '<style>.x::after { content: "</p>" }</style><p>New</p>',
      );
      expect(text).toContain('New');
    });

    it('ends an element left open at the end of the page', () => {
      expect(textOf(`<main><p>${PROSE}<div hidden>Old`)).toBe(PROSE);
    });
  });

  describe('a page its scripts build in the browser', () => {
    it.each([
      [
        'an app root',
        '<body><div id="root"></div><script src="/app.js"></script></body>',
      ],
      [
        'a Next.js root',
        '<body><div id="__next"></div><script src="/_next/main.js"></script></body>',
      ],
      [
        'a custom element in its main',
        '<body><nav>Home · About</nav>' +
          '<main><h1>Opening hours</h1><library-hours></library-hours></main>' +
          '<script type="module" src="/hours.js"></script></body>',
      ],
      [
        'nothing to read but its scripts',
        '<body><script>document.body.append("Opening hours")</script></body>',
      ],
    ])('needs a browser: %s', (_shape, html) => {
      expect(read(html).needsBrowser).toBe(true);
    });

    it.each([
      [
        'a page with its content and scripts',
        `<body><div id="root"><main><p>${PROSE}</p></main></div>` +
          '<script src="/app.js"></script></body>',
      ],
      [
        'a short page with text',
        '<body><p>Moved to the new site.</p><script>track()</script></body>',
      ],
      [
        'a custom element with content',
        '<body><main><library-hours>Open from nine</library-hours></main>' +
          '<script type="module" src="/hours.js"></script></body>',
      ],
      ['an app root without scripts', '<body><div id="root"></div></body>'],
      [
        'an app root with only data scripts',
        '<body><div id="root"></div>' +
          '<script type="application/ld+json">{"@type":"Library"}</script>' +
          '<script type="importmap">{"imports":{}}</script></body>',
      ],
      [
        'an SVG element with a hyphen',
        '<body><p>Opening hours</p><svg><font-face></font-face></svg>' +
          '<script src="/app.js"></script></body>',
      ],
      [
        'a hidden mount',
        '<body><p>Opening hours</p><div hidden><x-tooltip></x-tooltip></div>' +
          '<script src="/app.js"></script></body>',
      ],
    ])('reads as it is: %s', (_shape, html) => {
      expect(read(html).needsBrowser).toBe(false);
    });

    it('counts a script whose type is JavaScript or a module', () => {
      const shell = (type: string): string =>
        `<body><div id="app"></div><script type="${type}">start()</script></body>`;
      expect(read(shell('text/javascript')).needsBrowser).toBe(true);
      expect(read(shell('module')).needsBrowser).toBe(true);
      expect(read(shell('application/json')).needsBrowser).toBe(false);
      expect(read(shell('text/x-template')).needsBrowser).toBe(false);
    });
  });

  describe('the canonical URL', () => {
    const canonical = (link: string, url = PAGE_URL): string | null =>
      read(`<head>${link}</head><body><p>${PROSE}</p></body>`, url)
        .canonicalUrl;

    it('resolves the canonical link against the page’s URL', () => {
      expect(
        canonical(
          '<link rel="canonical" href="/library/hours">',
          'https://example.com/library/hours?tab=2&utm_source=x',
        ),
      ).toBe('https://example.com/library/hours');
      expect(
        canonical(
          '<link REL="Canonical" href="https://example.com/a?x=1&amp;y=2">',
        ),
      ).toBe('https://example.com/a?x=1&y=2');
    });

    it('takes the first canonical link', () => {
      expect(
        canonical(
          '<link rel="alternate" href="https://example.com/fr">' +
            '<link rel="canonical" href="https://example.com/first">' +
            '<link rel="canonical" href="https://example.com/second">',
        ),
      ).toBe('https://example.com/first');
    });

    it.each([
      ['no canonical link', '<link rel="icon" href="/favicon.ico">'],
      ['a script address', '<link rel="canonical" href="javascript:alert(1)">'],
      [
        'another scheme',
        '<link rel="canonical" href="ftp://example.com/hours">',
      ],
      ['no address', '<link rel="canonical" href="http://[example">'],
      [
        'an address too long',
        `<link rel="canonical" href="https://example.com/${'a'.repeat(3000)}">`,
      ],
    ])('is null for %s', (_shape, link) => {
      expect(canonical(link)).toBeNull();
    });
  });

  /**
   * Markup an attacker writes. `web_fetch` reads up to four megabytes a
   * site chooses, on the thread that serves every request: each shape below
   * repeats a construct that an element stack or a pattern could each time
   * look for through everything before it.
   */
  describe('markup built to be slow', () => {
    const RUN = 50_000;
    const cases: [string, string][] = [
      [
        'stray end tags under blocks',
        `${'<div>'.repeat(RUN)}${'</x>'.repeat(RUN)}`,
      ],
      [
        'stray end tags under spans',
        `${'<span>'.repeat(RUN)}${'</x>'.repeat(RUN)}`,
      ],
      ['list items with no end', `<ul>${'<li>a'.repeat(RUN)}`],
      ['nested lists', '<ul><li>'.repeat(RUN)],
      ['paragraphs with no end', '<p>a'.repeat(RUN)],
      ['nested tables', '<table><tr><td>'.repeat(RUN)],
      ['table rows with no end', `<table>${'<tr><td>a'.repeat(RUN)}`],
      ['headings with no end', '<h1>'.repeat(RUN)],
      ['buttons with no end', '<button>'.repeat(RUN)],
      [
        'nested hidden blocks',
        `${'<div hidden>'.repeat(RUN)}${'</div>'.repeat(RUN)}`,
      ],
      ['mains', '<main>x</main>'.repeat(RUN)],
      ['articles', '<article>x</article>'.repeat(RUN)],
      ['open quotes', '<a b="'.repeat(RUN)],
      ['comments with no end', '<!--'.repeat(RUN)],
      ['scripts with no end', '<script>'.repeat(RUN)],
      ['script end tags with no close', `<script>${'</script '.repeat(RUN)}`],
      ['custom elements', '<x-a>'.repeat(RUN)],
      ['controls', '<span aria-controls="a b c">'.repeat(RUN)],
      ['buttons in blocks', '<div><button>'.repeat(RUN)],
      [
        'list items under blocks',
        `<li>${'<div>'.repeat(RUN)}${'<li>'.repeat(RUN)}`,
      ],
      ['navigation between text', '<nav>x</nav>y'.repeat(RUN)],
      ['a run of <', '<'.repeat(RUN * 5)],
      ['spaces in a tag', `<a ${' '.repeat(RUN * 5)}`],
      ['a long style', `<a style="${';'.repeat(RUN)}${' '.repeat(RUN)}">`],
      ['body tags', '<body>'.repeat(RUN)],
      ['links', '<link rel=x href=y>'.repeat(RUN)],
      ['SVG elements that end themselves', `<svg>${'<path/>'.repeat(RUN)}`],
      ['table cells', `<table><tr>${'<td><th>'.repeat(RUN)}`],
      [
        'buttons in paragraphs',
        `${'<p><button>'.repeat(RUN)}${'<div>'.repeat(RUN)}`,
      ],
    ];

    it.each(cases)('reads %s in linear time', (_shape, html) => {
      const startedAt = performance.now();
      readPageContent(html, PAGE_URL);
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    });
  });

  describe('pages recorded from real sites', () => {
    it('reads a Microsoft Learn article without the site around it', () => {
      const page = read(
        recorded('learn-article'),
        'https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction?tabs=x',
      );
      expect(page.needsBrowser).toBe(false);
      expect(page.canonicalUrl).toBe(
        'https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction',
      );
      expect(page.text).toContain(
        "# Introduction to Azure Blob Storage\n\nAzure Blob Storage is Microsoft's object storage solution for the cloud.",
      );
      expect(page.text).toContain('- Streaming video and audio.');
      expect(page.text).toContain('## Next steps');
      for (const chrome of [
        'Skip to main content',
        'This browser is no longer supported',
        'Upgrade to Microsoft Edge',
        'Table of contents',
        'Exit editor mode',
        'Ask Learn',
        'Your Privacy Choices',
        'Theme',
        'Trademarks',
        '© Microsoft',
      ]) {
        expect(page.text).not.toContain(chrome);
      }
      expect(unreadablePage(200, page.text, page.needsBrowser)).toBeNull();
    });

    it('finds that a TED notice is drawn by its scripts', () => {
      const page = read(
        recorded('ted-notice-shell'),
        'https://ted.europa.eu/en/notice/-/detail/650000-2025',
      );
      expect(page.needsBrowser).toBe(true);
      expect(page.canonicalUrl).toBe(
        'https://ted.europa.eu/en/notice/-/detail/650000-2025',
      );
      expect(unreadablePage(200, page.text, page.needsBrowser)).toBe(
        'needs-browser',
      );
    });

    it('finds nothing to read in an AWS WAF challenge', () => {
      const page = read(
        recorded('aws-waf-challenge'),
        'https://ted.europa.eu/en/notice/-/detail/650000-2025',
      );
      expect(page.text).toBe('');
      expect(page.needsBrowser).toBe(true);
      expect(unreadablePage(202, page.text, page.needsBrowser)).toBe('blocked');
    });
  });
});

describe('unreadablePage', () => {
  it('is null for a page with text', () => {
    expect(unreadablePage(200, 'Opening hours', false)).toBeNull();
    expect(unreadablePage(202, 'Your request is queued.', false)).toBeNull();
  });

  it('finds a 202 with nothing to read blocked', () => {
    expect(unreadablePage(202, '', false)).toBe('blocked');
    expect(unreadablePage(202, ' \n', false)).toBe('blocked');
    expect(unreadablePage(202, 'Checking your browser', true)).toBe('blocked');
  });

  it('finds a page its scripts build in need of a browser', () => {
    expect(unreadablePage(200, '', true)).toBe('needs-browser');
    expect(unreadablePage(203, 'Menu · Log in', true)).toBe('needs-browser');
  });

  it('finds a page without text empty', () => {
    expect(unreadablePage(200, '', false)).toBe('empty');
    expect(unreadablePage(204, '  ', false)).toBe('empty');
  });
});
