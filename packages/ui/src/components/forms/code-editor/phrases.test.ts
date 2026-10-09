import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { editorPhrases } from './extensions/phrases';

/**
 * CodeMirror asks for its user-facing words (the completion list's name,
 * the search panel, announcements) by English phrase. A phrase without a
 * translation shows in English to a German or French reader, so every
 * phrase the editor's packages ask for must be in `editorPhrases`, and every
 * key it uses in each package catalog. A CodeMirror upgrade that adds a
 * phrase fails here.
 */

const require = createRequire(join(__dirname, 'phrases.test.ts'));

/** The packages the editor imports that render or announce words. */
const PACKAGES = [
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/autocomplete',
  '@codemirror/search',
];

function phrasesIn(packageName: string): string[] {
  const entry = require.resolve(packageName);
  const source = readFileSync(entry, 'utf8');
  const found = new Set<string>();
  for (const call of source.matchAll(/phrase\(([^)]*)\)/g)) {
    for (const literal of call[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      found.add(JSON.parse(`"${literal[1]}"`));
    }
  }
  return [...found];
}

const keyOf = ((key: string) => key) as unknown as TFunction;
const table = editorPhrases(keyOf);

function catalog(locale: string): Record<string, unknown> {
  const raw: unknown = parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'i18n', 'messages', `${locale}.yml`),
      'utf8',
    ),
  );
  return raw as Record<string, unknown>;
}

function lookup(tree: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      tree,
    );
}

describe('CodeMirror phrases', () => {
  it.each(PACKAGES)(
    '%s asks for no phrase the editor leaves untranslated',
    (name) => {
      const phrases = phrasesIn(name);
      expect(phrases.length).toBeGreaterThan(0);
      const missing = phrases.filter((phrase) => !(phrase in table));
      expect(missing).toEqual([]);
    },
  );

  it.each(['en', 'de', 'fr'])(
    'the %s catalog has every phrase key',
    (locale) => {
      const messages = catalog(locale);
      const missing = Object.values(table).filter(
        (key) => typeof lookup(messages, `codeEditor.${key}`) !== 'string',
      );
      expect(missing).toEqual([]);
    },
  );
});
