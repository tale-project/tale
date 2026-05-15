import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTENT_ROOT,
  DOCS_ROOT,
  discoverLocales,
  localeOf,
  walkDocs,
} from './_helpers';

/**
 * Warn-only German gender-agreement check.
 *
 * Flags the most common class of translation bug the audit caught — an
 * indefinite article (and optional adjective) that disagrees in case+gender
 * with the noun it governs. Example from the rewrite audit:
 *
 *   `einen einmaligen [SECURITY]-Warnung`  (masculine accusative on a feminine noun)
 *
 * The closed list of nouns lives in `GLOSSARY.json` under `nounGenders.de`.
 * Indefinite-article mismatches against that list are detectable with a
 * regex; definite-article cases (der/die/das/dem/den/des) are ambiguous
 * across case+number and are deliberately out of scope for v1 of this
 * check.
 *
 * Status: warn-only. Promote to hard-fail after the rewrite is in and
 * after a sweep clears the existing corpus.
 */

type Glossary = {
  nounGenders?: {
    de?: Record<string, 'm' | 'f' | 'n'>;
  };
};

const REPO_ROOT = path.resolve(DOCS_ROOT, '..', '..');
const glossaryPath = path.join(
  REPO_ROOT,
  '.agents',
  'terminology',
  'GLOSSARY.json',
);
const GLOSSARY: Glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));

type Finding = {
  file: string;
  line: number;
  match: string;
  article: string;
  noun: string;
  nounGender: 'm' | 'f' | 'n';
};

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return content;
  return content.slice(end + 5);
}

function stripFences(text: string): string {
  let out = '';
  let inFence = false;
  let marker: string | null = null;
  for (const line of text.split('\n')) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (m) {
      const ch = m[1][0];
      if (!inFence) {
        inFence = true;
        marker = ch;
      } else if (ch === marker) {
        inFence = false;
        marker = null;
      }
      out += '\n';
      continue;
    }
    out += inFence ? '\n' : line + '\n';
  }
  return out;
}

function maskInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, ' ');
}

function maskUrls(line: string): string {
  return line.replace(/\bhttps?:\/\/\S+/g, ' ').replace(/\(\/[^)\s]+\)/g, ' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Articles whose case+gender is unambiguous. For each article, list the
 * noun genders it CAN govern. A mismatch against the noun's gender is a
 * bug.
 *
 *   einen — masculine accusative only → noun must be m
 *   eine  — feminine nom/acc          → noun must be f
 *   einem — masc/neut dative          → noun must be m or n
 *   einer — fem dat/gen               → noun must be f
 *   eines — masc/neut genitive        → noun must be m or n
 *
 * `ein` is omitted: it covers masc nom AND neut nom/acc, which makes it
 * ambiguous when followed by `Plan` (m) vs `Modell` (n).
 */
const ARTICLE_ALLOWED: Record<string, ReadonlyArray<'m' | 'f' | 'n'>> = {
  einen: ['m'],
  eine: ['f'],
  einem: ['m', 'n'],
  einer: ['f'],
  eines: ['m', 'n'],
};

const ARTICLE_WORDS = Object.keys(ARTICLE_ALLOWED).join('|');

const locales = discoverLocales();
const dePages = walkDocs().filter((rel) => {
  const loc = localeOf(rel, locales);
  return loc === 'de' || loc === 'de-CH';
});

const nounGenders = GLOSSARY.nounGenders?.de;

describe('docs German gender agreement (warn-only)', () => {
  it('loaded glossary with nounGenders.de', () => {
    expect(nounGenders).toBeDefined();
    expect(Object.keys(nounGenders ?? {}).length).toBeGreaterThan(0);
  });

  it('warns when an indefinite article disagrees with the noun it governs', () => {
    if (!nounGenders) return;
    const nounAlternation = Object.keys(nounGenders).map(escapeRegex).join('|');
    // Match: indefinite article, optional one or two adjective-like words,
    // then a tracked noun. The adjective gap allows constructs like
    // `eine kurze Warnung` or `einen unerwarteten kritischen Fehler`.
    const pattern = new RegExp(
      `\\b(${ARTICLE_WORDS})\\s+(?:[A-Za-zÄÖÜäöüß-]+\\s+){0,2}(${nounAlternation})\\b`,
      'g',
    );

    const findings: Finding[] = [];

    for (const rel of dePages) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const stripped = stripFences(stripFrontmatter(raw));
      stripped.split('\n').forEach((line, idx) => {
        const masked = maskUrls(maskInlineCode(line));
        for (const m of masked.matchAll(pattern)) {
          const article = m[1] as keyof typeof ARTICLE_ALLOWED;
          const noun = m[2];
          const nounGender = nounGenders[noun];
          const allowed = ARTICLE_ALLOWED[article];
          if (!allowed.includes(nounGender)) {
            findings.push({
              file: rel,
              line: idx + 1,
              match: m[0],
              article,
              noun,
              nounGender,
            });
          }
        }
      });
    }

    if (findings.length > 0) {
      const formatted = findings
        .map(
          (f) =>
            `  ${f.file}:${f.line} "${f.match}" — article "${f.article}" disagrees with ${f.noun} (${f.nounGender})`,
        )
        .join('\n');
      console.warn(
        `grammar-de (${findings.length} gender-agreement warning(s)):\n${formatted}`,
      );
    }

    // Warn-only for now. Flip the next line to a strict assertion once the
    // rewrite sweep clears the existing corpus.
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });
});
