import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGlossary } from '../glossary/loader';
import type { Term } from '../glossary/types';
import { LOCALE_REGISTRY } from '../locales';
import { createScanner, type Source } from '../scanner';
import { terminologyUiLabel } from './terminology-ui-label';
import type { CheckContext } from './types';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminology-ui-label-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** `terms: null` checks against the shipped glossary. */
function context(
  terms: readonly Term[] | null,
  texts: Record<string, string>,
  kind: Source['kind'] = 'markdown',
): CheckContext {
  // The glossary loader and the scanner cache by path for the whole run, so
  // every context writes to its own directory.
  const dir = fs.mkdtempSync(path.join(root, 'context-'));
  let glossaryPath: string | undefined;
  if (terms) {
    glossaryPath = path.join(dir, 'glossary.yml');
    fs.writeFileSync(glossaryPath, JSON.stringify({ terms }));
  }
  const glossary = loadGlossary(glossaryPath);
  const sources: Source[] = Object.entries(texts).map(([locale, text]) => {
    const filePath = path.join(
      dir,
      `${locale}.${kind === 'json' ? 'yml' : 'md'}`,
    );
    fs.writeFileSync(filePath, text);
    return { kind, path: filePath, locale };
  });
  return {
    locales: LOCALE_REGISTRY.filter((locale) => locale.id in texts),
    glossary: () => glossary,
    scanner: createScanner(sources, dir),
  };
}

describe('terminology UI labels', () => {
  it('reports repeated matches across fragments with their original positions', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          { key: 'task', category: 'feature', en: 'Task', de: 'Aufgabe' },
          { key: 'owner', category: 'role', en: 'Owner', de: 'Inhaber' },
        ],
        { de: 'Task, Task.\nTask.\nOwner Task.' },
      ),
    );
    expect(
      findings.map(({ line, column, suggest }) => ({ line, column, suggest })),
    ).toEqual([
      { line: 1, column: 1, suggest: 'use "Aufgabe"' },
      { line: 1, column: 7, suggest: 'use "Aufgabe"' },
      { line: 2, column: 1, suggest: 'use "Aufgabe"' },
      { line: 3, column: 7, suggest: 'use "Aufgabe"' },
      { line: 3, column: 1, suggest: 'use "Inhaber"' },
    ]);
    expect(findings[0]).toEqual({
      file: 'de.md',
      line: 1,
      column: 1,
      key: undefined,
      locale: 'de',
      rule: 'ui-label-mismatch',
      detail: 'UI-label term "Task" must match shipped string',
      suggest: 'use "Aufgabe"',
      doctrine: LOCALE_REGISTRY.find((locale) => locale.id === 'de')?.doctrine,
    });
  });

  it('keeps every overlapping term in category and term order', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          { key: 'owner', category: 'role', en: 'Owner', de: 'Inhaber' },
          {
            key: 'board',
            category: 'feature',
            en: 'Task Board',
            de: 'Aufgabenboard',
          },
          { key: 'task', category: 'feature', en: 'Task', de: 'Aufgabe' },
        ],
        { de: 'Owner Task Board, Task, Task Board.' },
      ),
    );
    expect(
      findings.map(({ column, suggest }) => ({ column, suggest })),
    ).toEqual([
      { column: 7, suggest: 'use "Aufgabenboard"' },
      { column: 25, suggest: 'use "Aufgabenboard"' },
      { column: 7, suggest: 'use "Aufgabe"' },
      { column: 19, suggest: 'use "Aufgabe"' },
      { column: 25, suggest: 'use "Aufgabe"' },
      { column: 1, suggest: 'use "Inhaber"' },
    ]);
  });

  it.each([
    ['Task.Board', 'TaskxBoard'],
    ['Task|Board', 'Task Board'],
    ['Task+Board', 'TaskBoard TasktBoard'],
    ['Task[Board]UI', 'TaskBUI TaskdUI'],
    ['Task(Board)UI', 'TaskBoardUI'],
    ['Task?Board', 'TaskBoard TasBoard'],
  ])(
    'treats %s as a literal in the prefilter and individual pattern',
    (en, decoy) => {
      const findings = terminologyUiLabel.run(
        context([{ key: 'literal', category: 'feature', en, de: 'Aufgabe' }], {
          de: `${en} ${decoy}.`,
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        column: 1,
        detail: `UI-label term "${en}" must match shipped string`,
      });
    },
  );

  it('retains case-sensitive ASCII word boundaries on every fragment', () => {
    const findings = terminologyUiLabel.run(
      context(
        [{ key: 'task', category: 'feature', en: 'Task', de: 'Aufgabe' }],
        { de: 'Tasking Task_ _Task Task2 2Task task.\n(Task), Task!\näTaské' },
      ),
    );
    expect(findings.map(({ line, column }) => ({ line, column }))).toEqual([
      { line: 2, column: 2 },
      { line: 2, column: 9 },
      { line: 3, column: 2 },
    ]);
  });

  it('keeps locale exclusions, category filtering, and native suggestions', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'task',
            category: 'feature',
            en: 'Task',
            de: 'Aufgabe',
            fr: 'Tâche',
            _lintExclude: { de: true },
          },
          {
            key: 'owner',
            category: 'role',
            en: 'Owner',
            de: 'Inhaber',
            fr: 'Propriétaire',
          },
          {
            key: 'dashboard',
            category: 'feature',
            en: 'Dashboard',
            de: 'Dashboard',
            fr: 'Dashboard',
          },
          { key: 'brand', category: 'brand', en: 'Tale', de: 'Geschichte' },
        ],
        {
          en: 'Owner Task Dashboard Tale',
          de: 'Owner Task Dashboard Tale',
          fr: 'Owner Task Dashboard Tale',
        },
      ),
    );
    expect(
      findings.map(({ locale, suggest }) => ({ locale, suggest })),
    ).toEqual([
      { locale: 'de', suggest: 'use "Inhaber"' },
      { locale: 'fr', suggest: 'use "Tâche"' },
      { locale: 'fr', suggest: 'use "Propriétaire"' },
    ]);
  });

  it('honors a Markdown source opt-out before matching any term', () => {
    expect(
      terminologyUiLabel.run(
        context(
          [{ key: 'task', category: 'feature', en: 'Task', de: 'Aufgabe' }],
          {
            de: '---\ni18nLintExclude: ["terminology-ui-label"]\n---\nTask Task',
          },
        ),
      ),
    ).toEqual([]);
  });

  it('retains catalog keys and positions from the real JSON scanner', () => {
    const findings = terminologyUiLabel.run(
      context(
        [{ key: 'task', category: 'feature', en: 'Task', de: 'Aufgabe' }],
        { de: '{"menu": {\n  "title": "Task, Task"\n}}' },
        'json',
      ),
    );
    expect(
      findings.map(({ key, line, column }) => ({ key, line, column })),
    ).toEqual([
      { key: 'menu.title', line: 2, column: 1 },
      { key: 'menu.title', line: 2, column: 7 },
    ]);
  });

  // #4499: French UI strings and guides used a lowercase loanword and two
  // retired translations that the case-sensitive `en` form never matched.
  it('reports non-shipped names in any case, only in their locale', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'legalHold',
            category: 'feature',
            en: 'Legal hold',
            de: 'Aufbewahrungs-Pflicht',
            fr: 'Conservation légale',
            _avoid: { fr: ['legal hold', 'gel juridique'] },
          },
        ],
        {
          de: 'Legal Hold, legal hold.',
          fr: [
            'Placement de legal hold refusé, LEGAL HOLD.',
            'Legal hold et Gel juridique.',
            'Conservation légale, gel, gels juridiques, legal-hold, illegal holdings.',
          ].join('\n'),
        },
      ),
    );
    expect(
      findings.map(({ locale, line, column, rule, detail, suggest }) => ({
        locale,
        line,
        column,
        rule,
        detail,
        suggest,
      })),
    ).toEqual([
      {
        locale: 'fr',
        line: 1,
        column: 14,
        rule: 'ui-label-non-shipped',
        detail:
          '"legal hold" is not the shipped name of UI-label term "Legal hold"',
        suggest: 'use "Conservation légale"',
      },
      {
        locale: 'fr',
        line: 1,
        column: 33,
        rule: 'ui-label-non-shipped',
        detail:
          '"LEGAL HOLD" is not the shipped name of UI-label term "Legal hold"',
        suggest: 'use "Conservation légale"',
      },
      {
        locale: 'fr',
        line: 2,
        column: 1,
        rule: 'ui-label-mismatch',
        detail: 'UI-label term "Legal hold" must match shipped string',
        suggest: 'use "Conservation légale"',
      },
      {
        locale: 'fr',
        line: 2,
        column: 15,
        rule: 'ui-label-non-shipped',
        detail:
          '"Gel juridique" is not the shipped name of UI-label term "Legal hold"',
        suggest: 'use "Conservation légale"',
      },
    ]);
  });

  it('keeps non-shipped names behind locale exclusions and opt-outs', () => {
    const term: Term = {
      key: 'legalHold',
      category: 'feature',
      en: 'Legal hold',
      fr: 'Conservation légale',
      _avoid: { fr: ['legal hold'] },
    };
    expect(
      terminologyUiLabel.run(
        context([{ ...term, _lintExclude: { fr: true } }], {
          fr: 'Placement de legal hold refusé.',
        }),
      ),
    ).toEqual([]);
    expect(
      terminologyUiLabel.run(
        context([term], {
          fr: '---\ni18nLintExclude: ["terminology-ui-label"]\n---\nlegal hold',
        }),
      ),
    ).toEqual([]);
  });

  const shippedLegalHold = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) => detail.includes('UI-label term "Legal hold"'))
      .map(({ locale, line, detail }) => ({ locale, line, detail }));

  it('rejects the French legal-hold names that #4502 replaced', () => {
    const nonShipped = (name: string) =>
      `"${name}" is not the shipped name of UI-label term "Legal hold"`;
    expect(
      shippedLegalHold({
        fr: [
          'Placement de legal hold refusé',
          'Ce projet est sous legal hold et ne peut pas être supprimé.',
          'Levées de legal holds en échec',
          'Conservation juridique',
          'Les conservations juridiques priment sur la rétention.',
          'Elle reste sous gel juridique.',
          'Les gels juridiques bloquent la suppression.',
        ].join('\n'),
      }),
    ).toEqual([
      { locale: 'fr', line: 1, detail: nonShipped('legal hold') },
      { locale: 'fr', line: 2, detail: nonShipped('legal hold') },
      { locale: 'fr', line: 3, detail: nonShipped('legal holds') },
      { locale: 'fr', line: 4, detail: nonShipped('Conservation juridique') },
      { locale: 'fr', line: 5, detail: nonShipped('conservations juridiques') },
      { locale: 'fr', line: 6, detail: nonShipped('gel juridique') },
      { locale: 'fr', line: 7, detail: nonShipped('gels juridiques') },
    ]);
  });

  it('keeps the shipped French name and the German loanword', () => {
    expect(
      shippedLegalHold({
        fr: [
          'Placement de conservation légale refusé',
          'Ce projet est sous conservation légale et ne peut pas être supprimé.',
          'Une conservation légale préserve les données ; lève la conservation dans Gouvernance > Conservation légale.',
        ].join('\n'),
        de: 'Ein Legal Hold schützt die Daten.\nDie Aufbewahrungs-Pflicht bleibt.',
      }),
    ).toEqual([]);
  });
});
