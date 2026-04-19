#!/usr/bin/env bun
// Terminology lint across docs/ in all locales.
//
// Flags:
//   1. Formal-form pronouns in German (`Sie`, `Ihnen`, `Ihre`) and French (`vous`, `votre`)
//      in user-facing prose — we use the informal form (`du`, `tu`) per TERMINOLOGY_*.md.
//   2. UI-term drift: an English label appearing in a DE/FR page where the UI has a shipped
//      translation (e.g. "Canvas" in fr/ should be "Canevas"; "Prompt Library" in de/ should
//      be "Prompt-Bibliothek"). The canonical list lives in .agents/GLOSSARY.json.
//   3. Untranslated tab headings (e.g. German page starts with the English title because a
//      translator missed the frontmatter).
//
// Exits non-zero on any finding so it gates CI.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(currentDir);
const REPO = dirname(DOCS);
const GLOSSARY = JSON.parse(
  await readFile(join(REPO, '.agents', 'GLOSSARY.json'), 'utf8'),
) as {
  enToLocale: Record<'de' | 'fr', Record<string, string>>;
  formalPronouns: Record<'de' | 'fr', string[]>;
};

type Finding = { file: string; line: number; kind: string; detail: string };
const findings: Finding[] = [];

const SKIP_DIRS = new Set(['node_modules', 'scripts', 'images']);
const SKIP_FILES = new Set(['AGENTS.md', 'README.md', 'CONTRIBUTING.md']);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (
      (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) &&
      !SKIP_FILES.has(entry.name)
    )
      out.push(full);
  }
  return out;
}

function localeOf(relPath: string): 'en' | 'de' | 'fr' {
  if (relPath.startsWith('de/')) return 'de';
  if (relPath.startsWith('fr/')) return 'fr';
  return 'en';
}

// Strip fenced code blocks so we don't flag `Sie` inside a code sample, etc.
function stripCode(text: string): string {
  let out = '';
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out += '\n';
      continue;
    }
    out += inFence ? '\n' : line + '\n';
  }
  return out;
}

// Inline code: backtick-wrapped. We also want to skip those for term matching.
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, ' ');
}

function checkFormalPronouns(locale: 'de' | 'fr', text: string, file: string) {
  const forbidden = GLOSSARY.formalPronouns[locale];
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

function checkUiTerms(locale: 'de' | 'fr', text: string, file: string) {
  const map = GLOSSARY.enToLocale[locale];
  const stripped = stripCode(text);
  stripped.split('\n').forEach((raw, idx) => {
    const line = stripInlineCode(raw);
    for (const [enTerm, localeTerm] of Object.entries(map)) {
      if (enTerm === localeTerm) continue; // loanword kept — nothing to flag
      // Word-boundary, case-sensitive. Skip markdown link href targets (/...).
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

for (const file of await walk(DOCS)) {
  const rel = relative(DOCS, file);
  const locale = localeOf(rel);
  if (locale === 'en') continue; // nothing to check on EN
  const content = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  checkFormalPronouns(locale, content, rel);
  checkUiTerms(locale, content, rel);
}

if (findings.length === 0) {
  console.log('Terminology lint passed.');
  process.exit(0);
}

const byFile = new Map<string, Finding[]>();
for (const f of findings) {
  const list = byFile.get(f.file) ?? [];
  list.push(f);
  byFile.set(f.file, list);
}
for (const [file, list] of byFile) {
  console.error(`\n${file}`);
  for (const f of list) console.error(`  ${f.line}: [${f.kind}] ${f.detail}`);
}
console.error(
  `\nTerminology lint failed: ${findings.length} finding(s) in ${byFile.size} file(s).`,
);
process.exit(1);
