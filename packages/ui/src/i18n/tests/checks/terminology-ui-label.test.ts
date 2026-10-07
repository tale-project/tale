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

function context(
  terms: readonly Term[],
  texts: Record<string, string>,
  kind: Source['kind'] = 'markdown',
): CheckContext {
  const glossaryPath = path.join(root, 'glossary.yml');
  fs.writeFileSync(glossaryPath, JSON.stringify({ terms }));
  const glossary = loadGlossary(glossaryPath);
  const sources: Source[] = Object.entries(texts).map(([locale, text]) => {
    const filePath = path.join(
      root,
      `${locale}.${kind === 'json' ? 'yml' : 'md'}`,
    );
    fs.writeFileSync(filePath, text);
    return { kind, path: filePath, locale };
  });
  return {
    locales: LOCALE_REGISTRY.filter((locale) => locale.id in texts),
    glossary: () => glossary,
    scanner: createScanner(sources, root),
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
});
