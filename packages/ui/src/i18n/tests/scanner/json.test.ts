import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanJson } from './json';

let dir: string;

function scan(text: string, keyPrefix?: string) {
  const file = path.join(dir, 'de.yml');
  fs.writeFileSync(file, text);
  return scanJson({ kind: 'json', path: file, locale: 'de', keyPrefix }, dir);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-json-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('scanJson', () => {
  // #4483: the website's FAQ items and tour stages are YAML lists, and no
  // check read them, so a regressed tour-stage eyebrow passed.
  it('emits every string in a list, keyed by its index', () => {
    const fragments = scan(
      [
        'faq:',
        '  heading: FAQ zu Agenten',
        '  items:',
        '    - q: Was ist ein Agent?',
        '      a: Ein Agent bearbeitet Aufgaben.',
        '    - q: Wo arbeitet er?',
        '      a: In seiner Sandbox.',
        'tour:',
        '  stages:',
        '    - eyebrow: Agenten',
        '      tags: [Projekte, Wissen]',
        '      order: 2',
      ].join('\n'),
    );

    expect(fragments.map(({ key, text }) => ({ key, text }))).toEqual([
      { key: 'faq.heading', text: 'FAQ zu Agenten' },
      { key: 'faq.items.0.q', text: 'Was ist ein Agent?' },
      { key: 'faq.items.0.a', text: 'Ein Agent bearbeitet Aufgaben.' },
      { key: 'faq.items.1.q', text: 'Wo arbeitet er?' },
      { key: 'faq.items.1.a', text: 'In seiner Sandbox.' },
      { key: 'tour.stages.0.eyebrow', text: 'Agenten' },
      { key: 'tour.stages.0.tags.0', text: 'Projekte' },
      { key: 'tour.stages.0.tags.1', text: 'Wissen' },
    ]);
    expect(fragments[1]).toMatchObject({
      surface: 'json',
      locale: 'de',
      pos: { file: 'de.yml', column: 1 },
    });
  });

  // A docs path such as `/platform/automations/concepts` read as text, and
  // the French `automations` in it failed the terminology check.
  it('leaves out a list item’s id and path, not a key of that name elsewhere', () => {
    const fragments = scan(
      [
        'docs:',
        '  - label: Konzepte der Automatisierung',
        '    path: /platform/automations/concepts',
        'tour:',
        '  stages:',
        '    - id: automations',
        '      eyebrow: Automatisierungen',
        'editor:',
        '  fields:',
        '    id: ID',
        '    path: Pfad',
      ].join('\n'),
    );

    expect(fragments.map(({ key }) => key)).toEqual([
      'docs.0.label',
      'tour.stages.0.eyebrow',
      'editor.fields.id',
      'editor.fields.path',
    ]);
  });

  it('puts a topic file’s list items under its topic', () => {
    expect(
      scan('items:\n  - title: Agenten\n', 'platformAgents').map(
        ({ key }) => key,
      ),
    ).toEqual(['platformAgents.items.0.title']);
  });
});
