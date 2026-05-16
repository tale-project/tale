#!/usr/bin/env bun
/**
 * Glossary audit script.
 *
 * Cross-references `.agents/terminology/GLOSSARY.json` against the shipped
 * UI strings in `services/platform/messages/{en,de,fr}.json` and the docs
 * corpus, then writes three Markdown reports under
 * `services/docs/scripts/audit-output/`:
 *
 *   1. `stale-glossary.md` — glossary entries whose declared locale form
 *      has zero hits in the corresponding messages.json. Candidate for
 *      removal or repurposing.
 *
 *   2. `ui-string-leaks.md` — UI strings in a non-English locale that
 *      contain the English form of a `translateBucket` glossary entry.
 *      These are platform-UI bugs the docs tests cannot fix.
 *
 *   3. `missing-from-glossary.md` — frequent English words in
 *      `en.json` that look like product nouns (capitalised, ≥4 chars) and
 *      are NOT in the glossary. Candidates for new entries.
 *
 * Run from anywhere:
 *
 *   bun services/docs/scripts/glossary-audit.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadGlossary, type Term } from '../tests/lib/glossary';
import { GLOSSARY_PATH, MESSAGES_ROOT, REPO_ROOT } from '../tests/lib/paths';
import { escapeRegex } from '../tests/lib/regex';
import { walkDocs } from '../tests/lib/walk';

const OUT_DIR = path.join(
  REPO_ROOT,
  'services',
  'docs',
  'scripts',
  'audit-output',
);

interface FlatMessage {
  key: string;
  value: string;
}

/** Recursively flatten a nested messages JSON into `{ key: dot.path, value: string }`. */
function flatten(
  node: unknown,
  prefix = '',
  out: FlatMessage[] = [],
): FlatMessage[] {
  if (typeof node === 'string') {
    out.push({ key: prefix, value: node });
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

function loadMessages(locale: string): FlatMessage[] {
  const file = path.join(MESSAGES_ROOT, `${locale}.json`);
  if (!fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return flatten(json);
}

function countMatches(messages: FlatMessage[], term: string): FlatMessage[] {
  const re = new RegExp(
    `(^|[^A-Za-zÄÖÜäöüß])${escapeRegex(term)}(?![A-Za-zÄÖÜäöüß])`,
    'i',
  );
  return messages.filter((m) => re.test(m.value));
}

function reportStale(
  glossary: Term[],
  messagesByLocale: Record<string, FlatMessage[]>,
): string {
  const lines = [
    '# Stale glossary entries',
    '',
    'Glossary terms whose declared locale form has zero hits in the corresponding',
    '`services/platform/messages/<locale>.json`. Candidate for removal, or note',
    'that the term lives in docs/marketing copy only.',
    '',
    '| key | category | locale | declared form | UI hits |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const term of glossary) {
    for (const locale of ['en', 'de', 'fr'] as const) {
      const form =
        locale === 'en' ? term.en : locale === 'de' ? term.de : term.fr;
      if (!form) continue;
      if (form === term.en && locale !== 'en') continue; // loanword — same form
      const hits = countMatches(messagesByLocale[locale] ?? [], form);
      if (hits.length === 0) {
        lines.push(
          `| \`${term.key}\` | ${term.category} | ${locale} | \`${form}\` | 0 |`,
        );
      }
    }
  }
  return lines.join('\n') + '\n';
}

function reportLeaks(
  glossary: Term[],
  messagesByLocale: Record<string, FlatMessage[]>,
): string {
  const lines = [
    '# UI string leaks',
    '',
    'UI strings in `services/platform/messages/{de,fr}.json` that contain the',
    'English form of a `translateBucket` glossary entry. These are platform-UI',
    'bugs the docs tests cannot fix — file each one against the platform team.',
    '',
    '| key | locale | term (en) | should be | UI string |',
    '| --- | --- | --- | --- | --- |',
  ];
  const bucketTerms = glossary.filter((t) => t.category === 'translateBucket');
  for (const locale of ['de', 'fr'] as const) {
    const messages = messagesByLocale[locale] ?? [];
    for (const term of bucketTerms) {
      const native = locale === 'de' ? term.de : term.fr;
      if (!native || native === term.en) continue;
      const hits = countMatches(messages, term.en);
      for (const m of hits) {
        const value = m.value.replaceAll('|', '\\|').slice(0, 80);
        lines.push(
          `| \`${m.key}\` | ${locale} | \`${term.en}\` | \`${native}\` | ${value} |`,
        );
      }
    }
  }
  return lines.join('\n') + '\n';
}

function reportMissing(glossary: Term[], en: FlatMessage[]): string {
  const known = new Set(glossary.map((t) => t.en.toLowerCase()));
  const candidates = new Map<string, number>();
  // Find capitalised standalone words ≥4 chars. Skip common English words
  // and brand fragments. The output is a starting point — every entry
  // needs manual review before being added to the glossary.
  for (const { value } of en) {
    for (const match of value.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
      const word = match[1];
      if (known.has(word.toLowerCase())) continue;
      candidates.set(word, (candidates.get(word) ?? 0) + 1);
    }
  }
  const ranked = [...candidates.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);
  const lines = [
    '# Missing from glossary',
    '',
    'Frequent capitalised words in `services/platform/messages/en.json` that',
    'are NOT in the glossary. Candidates for new entries; each one needs',
    'manual triage (some are common English, some are product terms).',
    '',
    '| word | UI occurrences |',
    '| --- | --- |',
  ];
  for (const [word, count] of ranked) {
    lines.push(`| \`${word}\` | ${count} |`);
  }
  return lines.join('\n') + '\n';
}

function main(): void {
  const glossary = loadGlossary().terms;
  const messagesByLocale = {
    en: loadMessages('en'),
    de: loadMessages('de'),
    fr: loadMessages('fr'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const stale = reportStale(glossary, messagesByLocale);
  const leaks = reportLeaks(glossary, messagesByLocale);
  const missing = reportMissing(glossary, messagesByLocale.en);

  fs.writeFileSync(path.join(OUT_DIR, 'stale-glossary.md'), stale);
  fs.writeFileSync(path.join(OUT_DIR, 'ui-string-leaks.md'), leaks);
  fs.writeFileSync(path.join(OUT_DIR, 'missing-from-glossary.md'), missing);

  // Reference walkDocs so the dependency isn't dropped — corpus pluralisation
  // pass is left as a future expansion; touching it here keeps the import
  // intact for the planned phase.
  void walkDocs;
  void GLOSSARY_PATH;

  // eslint-disable-next-line no-console
  console.log(`Wrote three reports to ${path.relative(REPO_ROOT, OUT_DIR)}/`);
  // eslint-disable-next-line no-console
  console.log(`  glossary: ${glossary.length} terms`);
  // eslint-disable-next-line no-console
  console.log(
    `  messages: en=${messagesByLocale.en.length} de=${messagesByLocale.de.length} fr=${messagesByLocale.fr.length}`,
  );
}

main();
