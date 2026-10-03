import { describe, expect, test } from 'bun:test';

import type { AddressAnswer, LinkSiteModule } from '@tale/ui/docs/links';

import {
  lintRetirements,
  type Change,
  type GitReader,
} from '../src/retirements';

const ORIGIN = 'https://docs.example.test';

/** A docs site with pages under `docs/<locale>/…` and the given answers. */
function site(answers: Record<string, AddressAnswer>): LinkSiteModule {
  return {
    site: {
      origins: [ORIGIN],
      answer: (pathname) => answers[pathname] ?? { kind: 'missing' },
    },
    pages: () => [],
    contentRoot: 'docs/',
    pageAddress: (file) => {
      const match = /^docs\/(en|de)\/(.+)\.md$/.exec(file);
      if (!match) return null;
      const prefix = match[1] === 'en' ? '' : `/${match[1]}`;
      return { url: `${ORIGIN}${prefix}/${match[2]}`, slug: match[2] ?? '' };
    },
    ledger: 'docs/published.json',
    redirects: 'docs/redirects.json',
  };
}

function git(changes: Change[], ledgerBefore: string[] | null): GitReader {
  return {
    show: (_ref, file) =>
      file === 'docs/published.json' && ledgerBefore
        ? JSON.stringify({ slugs: ledgerBefore })
        : null,
    changes: () => changes,
  };
}

const ledger = (slugs: string[]) => () => JSON.stringify({ slugs });

describe('lintRetirements', () => {
  test('refuses a deleted page whose address now 404s, once for all its locales', () => {
    const findings = lintRetirements({
      modules: [site({})],
      base: 'base',
      git: git(
        [
          { status: 'D', file: 'docs/de/guide/old.md' },
          { status: 'D', file: 'docs/en/guide/old.md' },
          { status: 'M', file: 'docs/en/guide/kept.md' },
          { status: 'D', file: 'docs/AGENTS.md' },
        ],
        ['guide/old'],
      ),
      read: ledger(['guide/old']),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: 'docs/redirects.json',
      rule: 'retired-page-404',
    });
    expect(findings[0]?.detail).toBe(
      'docs/de/guide/old.md, docs/en/guide/old.md are deleted in this change and /guide/old now answers 404 — add "guide/old": "<the page that replaced it>" to docs/redirects.json and keep "guide/old" in docs/published.json',
    );
  });

  test('names the redirect a rename needs', () => {
    const [finding] = lintRetirements({
      modules: [site({})],
      base: 'base',
      git: git(
        [
          {
            status: 'R',
            file: 'docs/en/guide/old.md',
            renamedTo: 'docs/en/guide/new.md',
          },
        ],
        null,
      ),
      read: () => null,
    });
    expect(finding?.detail).toContain(
      'add "guide/old": "guide/new" to docs/redirects.json',
    );
  });

  test('refuses a ledger line the change removed', () => {
    const findings = lintRetirements({
      modules: [site({ '/guide/old': { kind: 'redirect', to: '/guide/new' } })],
      base: 'base',
      git: git([], ['guide/new', 'guide/old']),
      read: ledger(['guide/new']),
    });
    expect(findings.map(({ rule, file }) => `${rule} ${file}`)).toEqual([
      'published-line-removed docs/published.json',
    ]);
    expect(findings[0]?.detail).toContain(
      '"guide/old" was published before this change',
    );
  });

  test('accepts a retirement done right: a redirect, and the line kept', () => {
    expect(
      lintRetirements({
        modules: [
          site({ '/guide/old': { kind: 'redirect', to: '/guide/new' } }),
        ],
        base: 'base',
        git: git(
          [
            {
              status: 'R',
              file: 'docs/en/guide/old.md',
              renamedTo: 'docs/en/guide/new.md',
            },
          ],
          ['guide/old'],
        ),
        read: ledger(['guide/new', 'guide/old']),
      }),
    ).toEqual([]);
  });
});
