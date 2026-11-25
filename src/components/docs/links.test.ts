import { describe, expect, it } from 'vitest';

import {
  extractPageAnchors,
  extractPageLinks,
  judgeLink,
  type AddressAnswer,
  type LinkSite,
} from './links';
import { buildNearMissIndex } from './near-miss';

const PAGE = `---
title: A page
description: Links in every form the renderer turns into one.
---

Intro with an [inline link](/guide/basics "A title") and <https://example.com/auto>.

![A screenshot](/images/shot.webp)

See [the reference][ref] and a [missing reference][nope].

<Card title="Next" href="/guide/next">Body</Card>
<Video src="/videos/ep1.mp4" poster='/videos/ep1.webp'></Video>
<img srcset="/images/a.webp 1x, /images/b.webp 2x" alt="" />
<!-- <Card href="/commented/out" /> -->

\`\`\`bash
curl https://docs.example.test/in/a/fence
\`\`\`

Inline \`[not a link](/in/code)\` and math $[x](y)$.

[ref]: /guide/reference
`;

describe('extractPageLinks', () => {
  it('reads every form the renderer links, with its source position', () => {
    expect(
      extractPageLinks(PAGE).map(({ url, line, kind, attribute }) =>
        attribute ? { url, line, kind, attribute } : { url, line, kind },
      ),
    ).toEqual([
      { url: '/guide/basics', line: 6, kind: 'link' },
      { url: 'https://example.com/auto', line: 6, kind: 'link' },
      { url: '/images/shot.webp', line: 8, kind: 'image' },
      { url: '/guide/next', line: 12, kind: 'attribute', attribute: 'href' },
      { url: '/videos/ep1.mp4', line: 13, kind: 'attribute', attribute: 'src' },
      {
        url: '/videos/ep1.webp',
        line: 13,
        kind: 'attribute',
        attribute: 'poster',
      },
      {
        url: '/images/a.webp',
        line: 14,
        kind: 'attribute',
        attribute: 'srcset',
      },
      {
        url: '/images/b.webp',
        line: 14,
        kind: 'attribute',
        attribute: 'srcset',
      },
      { url: '/guide/reference', line: 23, kind: 'definition' },
    ]);
  });

  it('points at the attribute inside a multi-line tag', () => {
    const [link] = extractPageLinks(
      '<Card\n  title="x"\n  href="/deep">\n</Card>\n',
    );
    expect(link).toMatchObject({ url: '/deep', line: 3, column: 3 });
  });
});

describe('extractPageAnchors', () => {
  it('renders the ids AnchoredHeading renders, and raw ids', () => {
    const anchors = extractPageAnchors(`# Title

## Ask *questions* in \`chat\`

### Größe und Übersicht

#### Keep the old address {#old-id}

##### Too deep for an id

## ![logo](/x.png) Logo text

<a id="manual-anchor"></a>
`);
    expect([...anchors].sort()).toEqual(
      [
        'ask-questions-in-chat',
        'groesse-und-uebersicht',
        'logo-text',
        'manual-anchor',
        'old-id',
        'title',
      ].sort(),
    );
  });
});

const PAGES = new Map<string, AddressAnswer>([
  ['/guide/basics', { kind: 'page', anchors: () => new Set(['setup']) }],
  [
    '/de/guide/basics',
    { kind: 'page', locale: 'de', anchors: () => new Set() },
  ],
  ['/guide/next', { kind: 'page', locale: 'en' }],
  ['/images/shot.webp', { kind: 'file' }],
  ['/guide', { kind: 'redirect', to: '/guide/basics' }],
]);
const SITE: LinkSite = {
  origins: ['https://docs.example.test'],
  answer: (pathname) => PAGES.get(pathname) ?? { kind: 'missing' },
  nearMiss: {
    index: buildNearMissIndex([
      { route: 'guide/basics', titles: ['Basics'] },
      { route: 'guide/next', titles: ['Next steps'] },
    ]),
    routeOf: (pathname) => pathname.slice(1),
    pathFor: (route) => `/${route}`,
  },
};
const OTHER: LinkSite = {
  origins: ['https://ui.example.test'],
  answer: () => ({ kind: 'missing' }),
};
const CONTEXT = {
  pageUrl: 'https://docs.example.test/guide/next',
  pageLocale: 'en',
  pageAnchors: new Set(['here']),
  sites: [SITE, OTHER],
};

describe('judgeLink', () => {
  it('lands on a page, a file, a known fragment or off the judged sites', () => {
    for (const url of [
      '/guide/basics',
      './basics',
      '/guide/basics#setup',
      '/images/shot.webp',
      '#here',
      'https://example.com/anything',
      'mailto:team@example.test',
    ]) {
      expect(judgeLink(url, CONTEXT), url).toBeNull();
    }
  });

  it('names a 404 and the page it probably meant', () => {
    expect(judgeLink('/guide/basic', CONTEXT)).toEqual({
      rule: 'link-target-missing',
      detail: '/guide/basic is a 404 — did you mean /guide/basics?',
    });
    expect(judgeLink('/images/gone.webp', CONTEXT)?.detail).toBe(
      '/images/gone.webp is a 404',
    );
    expect(judgeLink('https://ui.example.test/x', CONTEXT)).toEqual({
      rule: 'link-target-missing',
      detail: 'https://ui.example.test/x is a 404',
    });
  });

  it('never suggests an address that is itself missing', () => {
    const lingering: LinkSite = {
      ...SITE,
      answer: (pathname) =>
        pathname === '/guide/basics'
          ? { kind: 'missing' }
          : (PAGES.get(pathname) ?? { kind: 'missing' }),
    };
    expect(
      judgeLink('/guide/basic', { ...CONTEXT, sites: [lingering, OTHER] })
        ?.detail,
    ).toBe('/guide/basic is a 404');
  });

  it('asks for the page a redirect lands on', () => {
    expect(judgeLink('/guide', CONTEXT)).toEqual({
      rule: 'link-via-redirect',
      detail: '/guide redirects to /guide/basics — link the page itself',
    });
  });

  it('refuses an unknown fragment, here and on another page', () => {
    expect(judgeLink('#nowhere', CONTEXT)?.rule).toBe('fragment-missing');
    expect(judgeLink('/guide/basics#nowhere', CONTEXT)?.rule).toBe(
      'fragment-missing',
    );
  });

  it('keeps a page in its own language', () => {
    expect(
      judgeLink('/guide/next', {
        ...CONTEXT,
        pageUrl: 'https://docs.example.test/de/guide/basics',
        pageLocale: 'de',
      })?.rule,
    ).toBe('link-locale-switch');
  });

  it('refuses an empty or scripted link', () => {
    expect(judgeLink('', CONTEXT)?.rule).toBe('link-empty');
    expect(judgeLink('javascript:alert(1)', CONTEXT)?.rule).toBe('link-script');
  });
});
