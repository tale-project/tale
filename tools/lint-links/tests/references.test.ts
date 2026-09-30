import { describe, expect, test } from 'bun:test';

import { docsPathReferences, originReferences } from '../src/references';

const ORIGINS = ['https://docs.tale.dev', 'https://ui.tale.dev'];

describe('originReferences', () => {
  test('finds absolute addresses on the judged origins, with their position', () => {
    const text = [
      'See https://docs.tale.dev/platform/chat/basics.',
      '<a href="https://ui.tale.dev/docs/components/button#props">x</a>',
      "const url = 'https://docs.tale.dev';",
      'Not this: https://docs.tale.dev.example.com/x or https://tale.dev/pricing',
    ].join('\n');
    expect(originReferences(text, ORIGINS)).toEqual([
      { url: 'https://docs.tale.dev/platform/chat/basics', line: 1, column: 5 },
      {
        url: 'https://ui.tale.dev/docs/components/button#props',
        line: 2,
        column: 10,
      },
      { url: 'https://docs.tale.dev', line: 3, column: 14 },
    ]);
  });

  test('leaves templates and prose shapes alone', () => {
    const text = [
      'https://docs.tale.dev/${slug}',
      'https://docs.tale.dev/{{page}}',
      'https://docs.tale.dev/:locale/x',
      'every concatenation produced `https://ui.tale.dev//docs/…`',
    ].join('\n');
    expect(originReferences(text, ORIGINS)).toEqual([]);
  });
});

describe('docsPathReferences', () => {
  const DOCS = 'https://docs.tale.dev';

  test('reads docs paths built on the docs origin in code', () => {
    const code = [
      'const href = `${TALE_DOCS_URL}/develop/api-reference`;',
      'export const X = `${DOCS_URL}/get-started/quickstart`;',
      "  docsPath: '/platform/chat/overview',",
      'const prose = `${DOCS_URL}/…`;',
    ].join('\n');
    expect(docsPathReferences('app/x.tsx', code, DOCS)).toEqual([
      { url: `${DOCS}/develop/api-reference`, line: 1, column: 31 },
      { url: `${DOCS}/get-started/quickstart`, line: 2, column: 30 },
      { url: `${DOCS}/platform/chat/overview`, line: 3, column: 14 },
    ]);
    expect(docsPathReferences('notes.md', code, DOCS)).toEqual([]);
  });

  test('reads the docs lists of the marketing catalogs', () => {
    const yaml = [
      'platformChat:',
      '  docs:',
      '    - label: Chat basics',
      '      path: /platform/chat/basics',
      '    - label: Elsewhere',
      '      path: https://example.com/x',
      '  nav:',
      '    path: /not/a/docs/list',
    ].join('\n');
    expect(
      docsPathReferences('services/web/messages/de.yml', yaml, DOCS),
    ).toEqual([{ url: `${DOCS}/platform/chat/basics`, line: 4, column: 13 }]);
  });
});
