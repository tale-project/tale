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
import { FORMAL_PRONOUNS } from './data/formal-pronouns';

/**
 * Hard-fail terminology check.
 *
 * Reads the flat `terms[]` array in GLOSSARY.json (term mappings) plus
 * `data/formal-pronouns.ts` (test-data, not term-shaped). For each
 * DE / FR / de-CH page, two passes:
 *
 *   1. Formal-pronoun pass — reject `Sie/Ihnen/...` in DE, `vous/votre/...`
 *      in FR (per `FORMAL_PRONOUNS`). Sentence-initial `Sie` in DE is allowed
 *      heuristically because it can be the capitalised third-person plural.
 *   2. UI-term pass — for each term whose locale form differs from `en`,
 *      reject the EN form appearing in the page body.
 *
 * Both passes mask fenced code blocks and inline-code spans so terms inside
 * `` `Header` `` or ` ```http ` blocks are not flagged.
 */

type Term = {
  key: string;
  category: string;
  en: string;
  de?: string;
  fr?: string;
  de_ch?: string;
  _lintExclude?: string[];
  _note?: string;
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

type Finding = { file: string; line: number; kind: string; detail: string };

/** Resolve a term's form for a locale, applying the fallback chain
 *  de_ch → de → en, fr → en, de → en. */
function resolveForm(term: Term, locale: string): string {
  if (locale === 'de-CH' || locale === 'de_ch') {
    return term.de_ch ?? term.de ?? term.en;
  }
  if (locale === 'de') return term.de ?? term.en;
  if (locale === 'fr') return term.fr ?? term.en;
  return term.en;
}

/** Strip fenced code blocks so we don't flag a term inside a code sample.
 *  Handles both backtick (```) and tilde (~~~) fences per CommonMark. */
function stripCode(text: string): string {
  let out = '';
  let inFence = false;
  let fenceMarker: string | null = null;
  for (const line of text.split('\n')) {
    const m = /^(\s*)(```+|~~~+)/.exec(line);
    if (m) {
      const marker = m[2][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      out += '\n';
      continue;
    }
    out += inFence ? '\n' : line + '\n';
  }
  return out;
}

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, ' ');
}

function maskUrls(line: string): string {
  return line.replace(/\bhttps?:\/\/\S+/g, ' ').replace(/\(\/[^)\s]+\)/g, ' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function checkFormalPronouns(
  locale: string,
  text: string,
  file: string,
  findings: Finding[],
) {
  // de-CH uses the same pronoun rules as de.
  const key = locale === 'de-CH' ? 'de' : locale;
  const forbidden = FORMAL_PRONOUNS[key];
  if (!forbidden) return;
  const stripped = stripCode(text);
  stripped.split('\n').forEach((raw, idx) => {
    const line = stripInlineCode(raw);
    for (const word of forbidden) {
      // German "Sie" at sentence start is almost always third person (sie/Sie
      // = she/they); skip to reduce false positives. French "vous/votre/vos"
      // is always flagged because the informal form is lexically distinct.
      const pattern =
        key === 'de' && /^[A-ZÄÖÜ]/.test(word)
          ? `(?<=[,;:—–\\-]\\s+|[a-zäöüß]\\s+|[a-zäöüß])${word}(?![A-Za-zÄÖÜäöüß])`
          : `(^|[^A-Za-zÄÖÜäöüß])${word}(?![A-Za-zÄÖÜäöüß])`;
      const re = new RegExp(pattern);
      if (re.test(line)) {
        findings.push({
          file,
          line: idx + 1,
          kind: 'formal-pronoun',
          detail: `${locale}: "${word}" — use informal form (du / tu) per TERMINOLOGY_${key.toUpperCase()}.md`,
        });
        break;
      }
    }
  });
}

/** Categories whose EN→native gap is enforced by this test. Other
 *  categories (`brand`, `acronym`, `codeIdentifier`, `actionVerb`,
 *  `technicalVocab`, `loanword`, `gitDomain`, `deploymentVocab`,
 *  `abbreviation`) are documented in the glossary but not flagged here:
 *  some are intentionally kept English in DE/FR (`brand`, `loanword`,
 *  `gitDomain`), some are soft rules with context-dependent exceptions
 *  (`acronym` — `AI`/`KI`, `abbreviation` — `e.g.`/`z. B.`), and some
 *  appear inline in code-like contexts (`actionVerb` — button labels). */
const ENFORCED_CATEGORIES = new Set([
  'feature',
  'role',
  'knowledgeEntity',
  'translateBucket',
]);

function checkUiTerms(
  locale: string,
  text: string,
  file: string,
  findings: Finding[],
) {
  const stripped = stripCode(text);
  stripped.split('\n').forEach((raw, idx) => {
    const masked = maskUrls(stripInlineCode(raw));
    for (const term of GLOSSARY.terms) {
      if (!ENFORCED_CATEGORIES.has(term.category)) continue;
      // `_lintExclude` lets a term opt out of enforcement for specific locales
      // where the English form is genuinely ambiguous (e.g. `Editor` in DE,
      // which also names the IDE/workflow editor).
      const excludeKey = locale === 'de-CH' ? 'de' : locale;
      if (term._lintExclude?.includes(excludeKey)) continue;
      const localised = resolveForm(term, locale);
      if (localised === term.en) continue; // loanword / same in this locale
      const re = new RegExp(`(^|[^A-Za-z])${escapeRegex(term.en)}(?![A-Za-z])`);
      if (re.test(masked)) {
        findings.push({
          file,
          line: idx + 1,
          kind: 'ui-term-drift',
          detail: `${locale}: "${term.en}" should be "${localised}" (matches shipped UI label, key=${term.key})`,
        });
      }
    }
  });
}

function formatFindings(findings: Finding[]): string {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  const lines: string[] = [];
  for (const [file, list] of byFile) {
    lines.push(file);
    for (const f of list) lines.push(`    ${f.line}: [${f.kind}] ${f.detail}`);
  }
  return lines.join('\n  ');
}

const locales = discoverLocales();
const localizedPages = walkDocs().filter(
  (rel) => localeOf(rel, locales) !== 'en',
);

describe('docs terminology', () => {
  it('loaded glossary with terms and pronouns', () => {
    expect(GLOSSARY.terms.length).toBeGreaterThan(0);
    expect(Object.keys(FORMAL_PRONOUNS).length).toBeGreaterThan(0);
  });

  it('uses informal pronouns and matches shipped UI terms in all locales', () => {
    const findings: Finding[] = [];
    for (const rel of localizedPages) {
      const locale = localeOf(rel, locales);
      const content = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      checkFormalPronouns(locale, content, rel, findings);
      checkUiTerms(locale, content, rel, findings);
    }
    expect(
      findings,
      `Terminology findings (${findings.length}):\n  ${formatFindings(findings)}`,
    ).toEqual([]);
  });
});
