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

type Glossary = {
  enToLocale: Record<string, Record<string, string>>;
  formalPronouns: Record<string, string[]>;
};

// services/docs/tests/  →  services/docs/  →  services/  →  <repo root>
const REPO_ROOT = path.resolve(DOCS_ROOT, '..', '..');
const glossaryPath = path.join(REPO_ROOT, '.agents', 'GLOSSARY.json');
const GLOSSARY: Glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));

type Finding = { file: string; line: number; kind: string; detail: string };

// Strip fenced code blocks so we don't flag `Sie` inside a code sample, etc.
// Handles both backtick (```) and tilde (~~~) fences per CommonMark.
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

function checkFormalPronouns(
  locale: string,
  text: string,
  file: string,
  findings: Finding[],
) {
  const forbidden = GLOSSARY.formalPronouns[locale];
  if (!forbidden) return;
  const stripped = stripCode(text);
  stripped.split('\n').forEach((raw, idx) => {
    const line = stripInlineCode(raw);
    for (const word of forbidden) {
      // Word-boundary match, case-sensitive (since DE "Sie" capitalisation matters).
      // German "Sie" at sentence start is almost always third person (sie/Sie = she/they);
      // skip it to reduce false positives. French "vous/votre/vos" is always flagged
      // because the informal form is lexically different (tu/ton/ta/tes), so there is no
      // sentence-initial ambiguity.
      const pattern =
        locale === 'de' && /^[A-ZÄÖÜ]/.test(word)
          ? `(?<=[,;:—–\\-]\\s+|[a-zäöüß]\\s+|[a-zäöüß])${word}(?![A-Za-zÄÖÜäöüß])`
          : `(^|[^A-Za-zÄÖÜäöüß])${word}(?![A-Za-zÄÖÜäöüß])`;
      const re = new RegExp(pattern);
      if (re.test(line)) {
        findings.push({
          file,
          line: idx + 1,
          kind: 'formal-pronoun',
          detail: `${locale}: "${word}" — use informal form (du / tu) per TERMINOLOGY_${locale.toUpperCase()}.md`,
        });
        break;
      }
    }
  });
}

function checkUiTerms(
  locale: string,
  text: string,
  file: string,
  findings: Finding[],
) {
  const map = GLOSSARY.enToLocale[locale];
  if (!map) return;
  const stripped = stripCode(text);
  stripped.split('\n').forEach((raw, idx) => {
    const line = stripInlineCode(raw);
    for (const [enTerm, localeTerm] of Object.entries(map)) {
      if (enTerm === localeTerm) continue; // loanword kept — nothing to flag
      const re = new RegExp(
        `(^|[^A-Za-z])${enTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![A-Za-z])`,
      );
      if (re.test(line)) {
        findings.push({
          file,
          line: idx + 1,
          kind: 'ui-term-drift',
          detail: `${locale}: "${enTerm}" should be "${localeTerm}" (matches shipped UI label)`,
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
  it('loaded glossary with pronoun and term rules', () => {
    expect(Object.keys(GLOSSARY.enToLocale).length).toBeGreaterThan(0);
    expect(Object.keys(GLOSSARY.formalPronouns).length).toBeGreaterThan(0);
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
