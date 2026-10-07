import { describe, expect, it } from 'vitest';

import {
  buildRedirectPathMap,
  deriveSectionRedirects,
  expandRedirects,
  localizeExternalUrl,
  lookupRedirect,
  normalizeRequestPath,
  parseRedirects,
  renderRedirectHtml,
  slugRoute,
} from './redirects';

const pagePath = (locale: string, slug: string) => {
  const route = slugRoute(slug);
  if (locale === 'en') return route ? `/${route}` : '/';
  return route ? `/${locale}/${route}` : `/${locale}`;
};
const OPTIONS = { locales: ['en', 'de', 'fr'] as const, pagePath };

describe('renderRedirectHtml', () => {
  it('keeps the theme script and assets while replacing page metadata and escaping the destination', () => {
    const template =
      '<html lang="en"><head><script>applyTheme()</script><script type="module" src="/assets/app.js"></script><!-- seo:start --><title>Old page</title><!-- seo:end --></head><body><div id="root"></div></body></html>';
    const html = renderRedirectHtml(
      template,
      'de',
      'https://ui.tale.dev/?q="<guide>"&next=$&',
    );
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('<script>applyTheme()</script>');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).not.toContain('Old page');
    expect(html).toContain('<meta name="robots" content="noindex" />');
    const target =
      'https://ui.tale.dev/?q=&quot;&lt;guide&gt;&quot;&amp;next=$&amp;';
    expect(html).toContain(`content="0;url=${target}"`);
    expect(html).toContain(`<link rel="canonical" href="${target}"`);
    expect(html).toContain(`<a href="${target}">${target}</a>`);
  });
});

describe('parseRedirects', () => {
  it('rejects a file without the expected shape', () => {
    expect(() => parseRedirects({})).toThrow(/"redirects" key/);
    expect(() => parseRedirects({ redirects: [] })).toThrow(
      /old slug → new slug/,
    );
    expect(() => parseRedirects({ redirects: { old: 42 } })).toThrow(
      /must map to a string slug/,
    );
    expect(() =>
      parseRedirects({ redirects: { old: 'http://tale.dev/x' } }),
    ).toThrow(/slug or an https:\/\/ URL/);
  });

  it('accepts slugs and https targets', () => {
    expect(
      parseRedirects({
        redirects: { old: 'new/page', legal: 'https://tale.dev/legal/terms' },
      }),
    ).toEqual({ old: 'new/page', legal: 'https://tale.dev/legal/terms' });
  });
});

describe('expandRedirects', () => {
  it('keeps each locale in its own tree, on the site and off it', () => {
    expect(
      expandRedirects(
        { 'old/page': 'new/page', terms: 'https://tale.dev/legal/terms' },
        OPTIONS,
      ),
    ).toEqual([
      { locale: 'en', from: '/old/page', to: '/new/page' },
      { locale: 'de', from: '/de/old/page', to: '/de/new/page' },
      { locale: 'fr', from: '/fr/old/page', to: '/fr/new/page' },
      { locale: 'en', from: '/terms', to: 'https://tale.dev/legal/terms' },
      {
        locale: 'de',
        from: '/de/terms',
        to: 'https://tale.dev/de/legal/terms',
      },
      {
        locale: 'fr',
        from: '/fr/terms',
        to: 'https://tale.dev/fr/legal/terms',
      },
    ]);
  });

  it('localizes an external root', () => {
    expect(localizeExternalUrl('https://tale.dev/', 'de')).toBe(
      'https://tale.dev/de',
    );
    expect(localizeExternalUrl('https://tale.dev/x', 'en')).toBe(
      'https://tale.dev/x',
    );
  });
});

describe('deriveSectionRedirects', () => {
  it('derives the first page in reading order and lets explicit entries win', () => {
    const slugs = [
      'index',
      'guide/index',
      'guide/basics/first',
      'guide/basics/second',
      'guide/advanced/deep/page',
      'moved/section/page',
    ];
    expect(
      deriveSectionRedirects(slugs, { moved: 'guide/basics/first' }),
    ).toEqual({
      'guide/basics': 'guide/basics/first',
      'guide/advanced': 'guide/advanced/deep/page',
      'guide/advanced/deep': 'guide/advanced/deep/page',
      'moved/section': 'moved/section/page',
    });
  });
});

describe('lookupRedirect', () => {
  const paths = buildRedirectPathMap(
    {
      'old/page': 'new/page',
      home: 'index',
      terms: 'https://tale.dev/legal/terms',
    },
    OPTIONS,
  );

  it('follows a moved page to its target and its Markdown export', () => {
    expect(lookupRedirect('/old/page', paths)).toBe('/new/page');
    expect(lookupRedirect('/de/old/page.md', paths)).toBe('/de/new/page.md');
    expect(lookupRedirect('/home.md', paths)).toBe('/index.md');
    expect(lookupRedirect('/new/page', paths)).toBeUndefined();
  });

  it('answers the export of a page that left the site with the page', () => {
    expect(lookupRedirect('/fr/terms.md', paths)).toBe(
      'https://tale.dev/fr/legal/terms',
    );
  });

  it('ignores trailing slashes', () => {
    expect(normalizeRequestPath('/old/page/')).toBe('/old/page');
    expect(normalizeRequestPath('/')).toBe('/');
  });
});
