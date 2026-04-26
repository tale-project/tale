import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCS_ROOT } from './_helpers';

interface NavGroup {
  group?: string;
  pages?: NavEntry[];
}

type NavEntry = string | NavGroup;

interface DocsConfig {
  navigation: {
    languages: Array<{
      language: string;
      groups: NavGroup[];
    }>;
  };
}

function collectPages(entries: NavEntry[] | undefined, out: string[] = []) {
  if (!entries) return out;
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(entry);
    } else {
      collectPages(entry.pages, out);
    }
  }
  return out;
}

function isDocsConfig(value: unknown): value is DocsConfig {
  if (value === null || typeof value !== 'object') return false;
  const nav = (value as { navigation?: unknown }).navigation;
  if (nav === null || typeof nav !== 'object') return false;
  const langs = (nav as { languages?: unknown }).languages;
  return Array.isArray(langs);
}

const configPath = path.join(DOCS_ROOT, 'docs.json');
const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!isDocsConfig(parsed)) {
  throw new Error(`${configPath} does not match expected DocsConfig shape`);
}
const config: DocsConfig = parsed;

function fileExistsForPage(page: string): boolean {
  const md = path.join(DOCS_ROOT, `${page}.md`);
  const mdx = path.join(DOCS_ROOT, `${page}.mdx`);
  return fs.existsSync(md) || fs.existsSync(mdx);
}

// Prefixes (`<locale>/`) for every non-English locale declared in
// `docs.json`. An English nav entry must not start with any of these.
const nonEnPrefixes = config.navigation.languages
  .filter((l) => l.language !== 'en')
  .map((l) => `${l.language}/`);

describe('docs navigation parity', () => {
  it('docs.json declares at least one language block', () => {
    expect(config.navigation.languages.length).toBeGreaterThan(0);
  });

  describe.each(config.navigation.languages)(
    'language $language',
    ({ language, groups }) => {
      const pages = collectPages(groups);

      it('every page entry resolves to a real .md or .mdx file', () => {
        const missing = pages.filter((p) => !fileExistsForPage(p));
        expect(
          missing,
          `${missing.length} navigation entry(ies) point at files that don't exist:\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
      });

      it('every page entry sits under the locale prefix (or root for `en`)', () => {
        const wrongPrefix: string[] = [];
        for (const p of pages) {
          if (language === 'en') {
            // English pages live at the docs root; they must NOT be prefixed
            // with any other declared locale folder.
            if (nonEnPrefixes.some((prefix) => p.startsWith(prefix))) {
              wrongPrefix.push(p);
            }
          } else {
            // Non-English pages must be prefixed with their locale folder.
            if (!p.startsWith(`${language}/`)) wrongPrefix.push(p);
          }
        }
        expect(
          wrongPrefix,
          `${wrongPrefix.length} entry(ies) have the wrong locale prefix for language "${language}":\n  ${wrongPrefix.join('\n  ')}`,
        ).toEqual([]);
      });
    },
  );
});
