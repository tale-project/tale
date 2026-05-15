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
 * Flags any term from GLOSSARY.json with `category === "translateBucket"`
 * whose English form appears untranslated in a DE / FR / de-CH page body
 * (outside code fences, inline code, URLs, and frontmatter).
 *
 * This is a narrow, focused subset of `terminology.test.ts` — it carries a
 * pointed error message ("translate-bucket term left English") for the
 * Bucket-3 set (`Header`, `Request`, `Email`, `Help Center`, `Billing`,
 * `Sales Research`, `Draft`, `Attachment`, `Self-hosted`, plus FR-only
 * `Engineering`). The broader UI-term check lives in `terminology.test.ts`.
 */

type Term = {
  key: string;
  category: string;
  en: string;
  de?: string;
  fr?: string;
  de_ch?: string;
};

type Glossary = {
  terms: Term[];
};

const REPO_ROOT = path.resolve(DOCS_ROOT, '..', '..');
const glossaryPath = path.join(
  REPO_ROOT,
  '.agents',
  'terminology',
  'GLOSSARY.json',
);
const GLOSSARY: Glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));

type Finding = { file: string; line: number; en: string; native: string };

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

function resolveForm(term: Term, locale: string): string {
  if (locale === 'de-CH') return term.de_ch ?? term.de ?? term.en;
  if (locale === 'de') return term.de ?? term.en;
  if (locale === 'fr') return term.fr ?? term.en;
  return term.en;
}

const locales = discoverLocales();
const localizedPages = walkDocs().filter(
  (rel) => localeOf(rel, locales) !== 'en',
);

const translateBucketTerms = GLOSSARY.terms.filter(
  (t) => t.category === 'translateBucket',
);

describe('docs translate-bucket loanwords', () => {
  it('loaded glossary with translate-bucket terms', () => {
    expect(translateBucketTerms.length).toBeGreaterThan(0);
  });

  it('rejects translate-bucket English nouns left untranslated in DE/FR/de-CH pages', () => {
    const findings: Finding[] = [];
    for (const rel of localizedPages) {
      const locale = localeOf(rel, locales);
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const stripped = stripFences(stripFrontmatter(raw));
      stripped.split('\n').forEach((line, idx) => {
        const masked = maskUrls(maskInlineCode(line));
        for (const term of translateBucketTerms) {
          const native = resolveForm(term, locale);
          if (native === term.en) continue;
          const re = new RegExp(
            `(^|[^A-Za-z])${escapeRegex(term.en)}(?![A-Za-z])`,
          );
          if (re.test(masked)) {
            findings.push({
              file: rel,
              line: idx + 1,
              en: term.en,
              native,
            });
          }
        }
      });
    }
    const formatted = findings
      .map((f) => `  ${f.file}:${f.line} "${f.en}" → "${f.native}"`)
      .join('\n');
    expect(
      findings,
      `loanword (${findings.length} untranslated occurrence(s) in DE/FR/de-CH pages):\n${formatted}`,
    ).toEqual([]);
  });
});
