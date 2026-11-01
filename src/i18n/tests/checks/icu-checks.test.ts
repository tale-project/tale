import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOCALE_REGISTRY } from '../locales';
import { createScanner } from '../scanner';
import { icuBraceBalance } from './icu-brace-balance';
import { icuPlaceholderParity } from './icu-placeholder-parity';
import { icuPluralRules } from './icu-plural-rules';
import type { CheckContext, Finding } from './types';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icu-checks-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function context(): CheckContext {
  // The checks read the catalogs themselves: no fragments, no glossary.
  return {
    locales: LOCALE_REGISTRY,
    messagesDir: dir,
    scanner: createScanner([], dir),
    glossary: () => {
      throw new Error('the ICU checks read no glossary');
    },
  };
}

// Whole findings, compared with `toEqual`, so an extra finding fails too.
function rows(findings: ReadonlyArray<Finding>) {
  return findings.map((f) => [f.locale, f.key, f.rule, f.detail]);
}

const LAYOUTS = {
  'a file per locale': (locale: string, topic: string, body: string) =>
    write(
      `${locale}.yml`,
      `${topic}:\n${body
        .split('\n')
        .map((line) => (line ? `  ${line}` : line))
        .join('\n')}`,
    ),
  'a file per topic and locale': (
    locale: string,
    topic: string,
    body: string,
  ) => write(`${locale}/${topic}.yml`, body),
};

describe.each(Object.entries(LAYOUTS))('with %s', (_layout, catalog) => {
  describe('icu-placeholder-parity', () => {
    it('finds a placeholder a translation renamed', () => {
      catalog('en', 'chat', "greeting: 'Hello {name}'\n");
      catalog('de', 'chat', "greeting: 'Hallo {name}'\n");
      catalog('fr', 'chat', "greeting: 'Bonjour {nom}'\n");

      expect(rows(icuPlaceholderParity.run(context()))).toEqual([
        [
          'fr',
          'chat.greeting',
          'icu-placeholder-mismatch',
          'placeholders mismatch [missing: name, extra: nom]',
        ],
      ]);
    });

    it('reads the placeholders inside plural branches', () => {
      const count = (one: string, other: string) =>
        `count: '{n, plural, one {${one}} other {${other}}}'\n`;
      catalog(
        'en',
        'tasks',
        count('# task for {owner}', '# tasks for {owner}'),
      );
      catalog(
        'de',
        'tasks',
        count('# Aufgabe für {besitzer}', '# Aufgaben für {besitzer}'),
      );
      catalog(
        'fr',
        'tasks',
        count('# tâche pour {owner}', '# tâches pour {owner}'),
      );

      expect(rows(icuPlaceholderParity.run(context()))).toEqual([
        [
          'de',
          'tasks.count',
          'icu-placeholder-mismatch',
          'placeholders mismatch [missing: owner, extra: besitzer]',
        ],
      ]);
    });

    it('takes a quoted placeholder for text', () => {
      catalog('en', 'chat', "greeting: 'Hello {name}'\n");
      catalog('de', 'chat', "greeting: 'Hallo {name}'\n");
      catalog('fr', 'chat', `greeting: "Bonjour '{name}'"\n`);

      expect(rows(icuPlaceholderParity.run(context()))).toEqual([
        [
          'fr',
          'chat.greeting',
          'icu-placeholder-mismatch',
          'placeholders mismatch [missing: name, extra: ∅]',
        ],
      ]);
    });

    it('finds an argument the base value does not name, in a regional override too', () => {
      catalog(
        'en',
        'versions',
        "summary: 'Changes: {fields}'\ntitle: 'Changes'\n",
      );
      catalog(
        'de',
        'versions',
        "summary: 'Änderungen: {fields}'\ntitle: 'Änderungen'\n",
      );
      catalog('de-CH', 'versions', "summary: '{count} Änderungen: {fields}'\n");
      catalog(
        'fr',
        'versions',
        "summary: 'Modifications : {fields}'\ntitle: '{count} modifications'\n",
      );

      expect(rows(icuPlaceholderParity.run(context()))).toEqual([
        [
          'de-CH',
          'versions.summary',
          'icu-placeholder-mismatch',
          'placeholders mismatch [missing: ∅, extra: count]',
        ],
        [
          'fr',
          'versions.title',
          'icu-placeholder-mismatch',
          'placeholders mismatch [missing: ∅, extra: count]',
        ],
      ]);
    });
  });

  describe('icu-plural-rules', () => {
    const count = (one: string, other: string) =>
      `count: '{n, plural, one {${one}} other {${other}}}'\n`;

    it('finds a plural a translation dropped or left short', () => {
      catalog('en', 'tasks', count('# task', '# tasks'));
      catalog('de', 'tasks', "count: '{n} Aufgaben'\n");
      catalog('fr', 'tasks', "count: '{n, plural, other {# tâches}}'\n");

      expect(rows(icuPluralRules.run(context()))).toEqual([
        [
          'de',
          'tasks.count',
          'icu-plural-missing',
          'base value uses ICU plural; locale value does not',
        ],
        [
          'fr',
          'tasks.count',
          'icu-plural-categories-missing',
          'placeholder "n" missing categories: one',
        ],
      ]);
    });

    it('takes =1 for one, and asks French for no many', () => {
      catalog('en', 'tasks', count('# task', '# tasks'));
      catalog(
        'de',
        'tasks',
        "count: '{n, plural, =1 {eine Aufgabe} other {# Aufgaben}}'\n",
      );
      catalog('fr', 'tasks', count('# tâche', '# tâches'));

      expect(rows(icuPluralRules.run(context()))).toEqual([]);
    });

    it('checks every plural of a value, in a select branch or where the base value has none', () => {
      catalog(
        'en',
        'issues',
        [
          "cause: '{code, select, keys {{n, plural, =0 {No keys.} other {Unknown keys: {list}.}}} other {Unknown.}}'",
          "added: '{days} days added'",
          '',
        ].join('\n'),
      );
      catalog(
        'de',
        'issues',
        [
          "cause: '{code, select, keys {{n, plural, =0 {Keine Schlüssel.} other {Unbekannte Schlüssel: {list}.}}} other {Unbekannt.}}'",
          "added: '{days} Tage hinzugefügt'",
          '',
        ].join('\n'),
      );
      catalog(
        'fr',
        'issues',
        [
          "cause: '{code, select, keys {{n, plural, =0 {Aucune clé.} one {Clé inconnue : {list}.} other {Clés inconnues : {list}.}}} other {Inconnu.}}'",
          "added: '{days, plural, other {# jours ajoutés}}'",
          '',
        ].join('\n'),
      );

      expect(rows(icuPluralRules.run(context()))).toEqual([
        [
          'de',
          'issues.cause',
          'icu-plural-categories-missing',
          'placeholder "n" missing categories: one',
        ],
        [
          'fr',
          'issues.added',
          'icu-plural-categories-missing',
          'placeholder "days" missing categories: one',
        ],
      ]);
    });

    it('checks a regional override', () => {
      catalog('en', 'tasks', count('# task', '# tasks'));
      catalog('de', 'tasks', count('# Aufgabe', '# Aufgaben'));
      catalog('de-CH', 'tasks', "count: '{n, plural, other {# Aufgaben}}'\n");
      catalog('fr', 'tasks', count('# tâche', '# tâches'));

      expect(rows(icuPluralRules.run(context()))).toEqual([
        [
          'de-CH',
          'tasks.count',
          'icu-plural-categories-missing',
          'placeholder "n" missing categories: one',
        ],
      ]);
    });

    it('leaves selectordinal alone', () => {
      catalog(
        'en',
        'rank',
        "place: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'\n",
      );
      catalog('de', 'rank', "place: '{n, selectordinal, other {#.}}'\n");
      catalog(
        'fr',
        'rank',
        "place: '{n, selectordinal, one {#er} other {#e}}'\n",
      );

      expect(rows(icuPluralRules.run(context()))).toEqual([]);
    });
  });

  describe('icu-brace-balance', () => {
    it('finds an unbalanced brace in any language', () => {
      catalog('en', 'home', "title: 'Hi {name}'\n");
      catalog('de', 'home', "title: 'Hallo {name'\n");
      catalog('fr', 'home', "title: 'Salut {name}'\n");

      expect(rows(icuBraceBalance.run(context()))).toEqual([
        [
          'de',
          'home.title',
          'icu-brace-unbalanced',
          'value has 1 unclosed { — ICU cannot parse it',
        ],
      ]);
    });

    it('takes a brace quoted after < or > for text', () => {
      catalog('en', 'editor', `hint: "Type '<{' to open a block"\n`);
      catalog('de', 'editor', `hint: "Tippe '<{', um einen Block zu öffnen"\n`);
      catalog('fr', 'editor', `hint: "Tape '>}' pour fermer un bloc"\n`);

      expect(rows(icuBraceBalance.run(context()))).toEqual([]);
    });
  });
});
