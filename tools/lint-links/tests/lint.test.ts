import { describe, expect, test } from 'bun:test';

import type { AddressAnswer, LinkSiteModule } from '@tale/ui/docs/links';

import { lintLinks } from '../src/lint';

function site(
  origin: string,
  answers: Record<string, AddressAnswer>,
  pages: LinkSiteModule['pages'],
  contentRoot: string,
): LinkSiteModule {
  return {
    site: {
      origins: [origin],
      answer: (pathname) => answers[pathname] ?? { kind: 'missing' },
    },
    pages,
    contentRoot,
    pageAddress: () => null,
    ledger: `${contentRoot}published.json`,
    redirects: `${contentRoot}redirects.json`,
  };
}

const DOCS = site(
  'https://docs.example.test',
  {
    '/guide': { kind: 'page', anchors: () => new Set(['setup']) },
    '/guide/next': { kind: 'page' },
    '/old': { kind: 'redirect', to: '/guide' },
  },
  () => [
    { file: 'docs/guide/next.md', url: 'https://docs.example.test/guide/next' },
  ],
  'docs/',
);
const UI = site(
  'https://ui.example.test',
  { '/docs/button': { kind: 'page' } },
  () => [],
  'ui/content/',
);

const FILES: Record<string, string> = {
  'docs/guide/next.md':
    '[back](../guide#setup), [ui](https://ui.example.test/docs/buton) and https://docs.example.test/old\n',
  'app/help.tsx': "const help = 'https://docs.example.test/guide#nope';\n",
  'README.md':
    'Read https://docs.example.test/guide/next and https://example.com/x.\n',
  'generated/history.ts': 'https://docs.example.test/removed\n',
  'image.png': '',
};

describe('lintLinks', () => {
  test('judges content pages in full and every other file by its addresses', () => {
    const findings = lintLinks({
      modules: [DOCS, UI],
      files: Object.keys(FILES),
      read: (file) => (file.endsWith('.png') ? null : (FILES[file] ?? null)),
      docsOrigin: 'https://docs.example.test',
      skip: (file) => file.startsWith('generated/'),
    });
    expect(
      findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`),
    ).toEqual([
      'docs/guide/next.md:1 link-target-missing',
      'docs/guide/next.md:1 link-via-redirect',
      'app/help.tsx:1 fragment-missing',
    ]);
    expect(findings[0]?.detail).toContain('https://ui.example.test/docs/buton');
  });
});
