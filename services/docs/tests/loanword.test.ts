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
 * Flags any English term from `translateBucket` in `GLOSSARY.json` that appears
 * untranslated in a DE or FR page body (outside code fences, inline code, URLs,
 * frontmatter, and brand names).
 *
 * Currently runs warn-only. When the rewrite is complete the simplest move is
 * to fold the translateBucket entries into `enToLocale` so the existing
 * terminology.test.ts catches them as hard failures and this file can be
 * deleted.
 */

type Bucket = { en: string; native: string }[];
type Glossary = {
  translateBucket?: Record<string, Bucket>;
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
  // Strip URLs and the link targets in `[text](url)` so embedded English
  // path segments don't get flagged.
  return line.replace(/\bhttps?:\/\/\S+/g, ' ').replace(/\(\/[^)\s]+\)/g, ' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const locales = discoverLocales();
const localizedPages = walkDocs().filter(
  (rel) => localeOf(rel, locales) !== 'en',
);

describe('docs translate-bucket loanwords (warn-only)', () => {
  it('loaded glossary with translateBucket', () => {
    expect(GLOSSARY.translateBucket).toBeDefined();
    expect(Object.keys(GLOSSARY.translateBucket!).length).toBeGreaterThan(0);
  });

  it('warns when a DE/FR page leaves a translate-bucket English noun untranslated', () => {
    const findings: Finding[] = [];
    for (const rel of localizedPages) {
      const locale = localeOf(rel, locales);
      const bucket = GLOSSARY.translateBucket?.[locale];
      if (!bucket || bucket.length === 0) continue;
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const stripped = stripFences(stripFrontmatter(raw));
      stripped.split('\n').forEach((line, idx) => {
        const masked = maskUrls(maskInlineCode(line));
        for (const entry of bucket) {
          const re = new RegExp(
            `(^|[^A-Za-z])${escapeRegex(entry.en)}(?![A-Za-z])`,
          );
          if (re.test(masked)) {
            findings.push({
              file: rel,
              line: idx + 1,
              en: entry.en,
              native: entry.native,
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
      `loanword (${findings.length} untranslated occurrence(s) in DE/FR pages):\n${formatted}`,
    ).toEqual([]);
  });
});
