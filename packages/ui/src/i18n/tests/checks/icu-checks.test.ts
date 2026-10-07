import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOCALE_REGISTRY } from '../locales';
import { createScanner } from '../scanner';
import { icuBraceBalance } from './icu-brace-balance';
import { icuPlaceholderParity } from './icu-placeholder-parity';
import { icuPluralRules } from './icu-plural-rules';
import type { CheckContext } from './types';

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
    locales: LOCALE_REGISTRY.filter((locale) =>
      ['en', 'de', 'fr'].includes(locale.id),
    ),
    messagesDir: dir,
    scanner: createScanner([], dir),
    glossary: () => {
      throw new Error('the ICU checks read no glossary');
    },
  };
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
  it('finds a placeholder a translation renamed', () => {
    catalog('en', 'chat', "greeting: 'Hello {name}'\n");
    catalog('de', 'chat', "greeting: 'Hallo {name}'\n");
    catalog('fr', 'chat', "greeting: 'Bonjour {nom}'\n");

    const findings = icuPlaceholderParity.run(context());

    expect(findings.map((f) => [f.locale, f.key])).toEqual([
      ['fr', 'chat.greeting'],
    ]);
  });

  it('finds a plural a translation dropped or left short', () => {
    const plural = (one: string, other: string) =>
      `count: '{n, plural, one {${one}} other {${other}}}'\n`;
    catalog('en', 'tasks', plural('# task', '# tasks'));
    catalog('de', 'tasks', "count: '{n} Aufgaben'\n");
    catalog('fr', 'tasks', plural('# tâche', '# tâches'));

    const findings = icuPluralRules.run(context());

    expect(findings.map((f) => [f.locale, f.rule])).toContainEqual([
      'de',
      'icu-plural-missing',
    ]);
  });

  it('finds an unbalanced brace in any language', () => {
    catalog('en', 'home', "title: 'Hi {name}'\n");
    catalog('de', 'home', "title: 'Hallo {name'\n");
    catalog('fr', 'home', "title: 'Salut {name}'\n");

    const findings = icuBraceBalance.run(context());

    expect(findings.map((f) => [f.locale, f.key])).toEqual([
      ['de', 'home.title'],
    ]);
  });
});
