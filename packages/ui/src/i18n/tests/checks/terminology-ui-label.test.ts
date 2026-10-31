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

  // The website's French docs paths and tour-stage ids name `automations`,
  // the loanword `_avoid` reports in French text.
  it('reports a list item’s text but not its id or path', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'automations',
            category: 'feature',
            en: 'Automations',
            fr: 'Automatisations',
            _avoid: { fr: ['automations'] },
          },
        ],
        {
          fr: [
            'platformAutomations:',
            '  docs:',
            '    - label: Concepts des automations',
            '      path: /platform/automations/concepts',
            '  tour:',
            '    stages:',
            '      - id: automations',
            '        eyebrow: Automatisations',
          ].join('\n'),
        },
        'json',
      ),
    );
    expect(findings.map(({ key, rule }) => ({ key, rule }))).toEqual([
      { key: 'platformAutomations.docs.0.label', rule: 'ui-label-non-shipped' },
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

  // #4506: a bare "gel" also names ordinary freezes, so it is avoided only
  // inside a bracketed context.
  it('reports a bracketed name only inside its context', () => {
    const nonShipped = (name: string) =>
      `"${name}" is not the shipped name of UI-label term "Legal hold"`;
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'legalHold',
            category: 'feature',
            en: 'Legal hold',
            fr: 'Conservation légale',
            _avoid: { fr: ['gel juridique', 'sous [gel]', '[gel] actif'] },
          },
        ],
        {
          fr: 'Sous gel, gel actif, sous gel juridique, dessous gel, gel actifs, gel.',
        },
      ),
    );
    expect(findings.map(({ column, detail }) => ({ column, detail }))).toEqual([
      { column: 27, detail: nonShipped('gel juridique') },
      { column: 6, detail: nonShipped('gel') },
      { column: 11, detail: nonShipped('gel') },
    ]);
  });

  // #4483: the German app names these areas Agenten and Richtlinien, the
  // French one Gouvernance; the German website said Agents and Governance.
  const shippedAreaNames = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) =>
        /UI-label term "(?:Agents|Governance)"/.test(detail),
      )
      .map(({ locale, line, suggest }) => ({ locale, line, suggest }));

  it('rejects the English names of the agents and governance areas', () => {
    expect(
      shippedAreaNames({
        de: [
          'Was sind Agents in Tale?',
          'Die Orchestrierungsebene für KI-Agents',
          'Verbindungen der Coding-Agents',
          'FAQ zu Governance',
          'KI-Governance, Genehmigungen und Nutzungslimits',
        ].join('\n'),
        'de-CH':
          'Wie arbeiten Agents an Projektaufgaben?\nWas steuert die Governance?',
        fr: 'Que couvre la Governance ?',
      }),
    ).toEqual([
      { locale: 'de', line: 1, suggest: 'use "Agenten"' },
      { locale: 'de', line: 2, suggest: 'use "Agenten"' },
      { locale: 'de', line: 3, suggest: 'use "Agenten"' },
      { locale: 'de', line: 4, suggest: 'use "Richtlinien"' },
      { locale: 'de', line: 5, suggest: 'use "Richtlinien"' },
      { locale: 'de-CH', line: 1, suggest: 'use "Agenten"' },
      { locale: 'de-CH', line: 2, suggest: 'use "Richtlinien"' },
      { locale: 'fr', line: 1, suggest: 'use "Gouvernance"' },
    ]);
  });

  it('keeps the shipped names, the singular Agent and French Agents', () => {
    expect(
      shippedAreaNames({
        de: [
          'Agenten & Connectors',
          'Die Orchestrierungsebene für KI-Agenten',
          'Verbindungen der Coding-Agenten, Zugriff eines Coding-Agenten',
          'Ein Agent arbeitet in seiner Sandbox: Agent-Laufzeit, Agent-Delegation.',
          'Was umfassen die Richtlinien? KI-Richtlinien und Genehmigungsrichtlinien.',
        ].join('\n'),
        fr: 'Agents & connectors\nQue couvre la gouvernance ? Gouvernance IA.',
      }),
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

  it('rejects a bare French "gel" where it names a legal hold', () => {
    const gel = '"gel" is not the shipped name of UI-label term "Legal hold"';
    expect(
      shippedLegalHold({
        fr: [
          '## Placer un gel',
          'Un admin peut placer un gel.',
          'Libérer un gel exige deux personnes.',
          'Les données sous gel restent protégées.',
          'Sur le gel actif, choisis Demander la libération.',
        ].join('\n'),
      }),
    ).toEqual([
      { locale: 'fr', line: 1, detail: gel },
      { locale: 'fr', line: 2, detail: gel },
      { locale: 'fr', line: 3, detail: gel },
      { locale: 'fr', line: 4, detail: gel },
      { locale: 'fr', line: 5, detail: gel },
    ]);
  });

  it('keeps ordinary French freezes', () => {
    expect(
      shippedLegalHold({
        fr: [
          'Le gel du code commence demain.',
          'Les gels de version sont annoncés deux semaines avant.',
          'Le dépôt reste gelé pendant la migration.',
          'Le gel du code reste actif ; les branches gelées attendent sa fin.',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  const shippedTwoFactor = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) =>
        detail.includes('UI-label term "Two-factor authentication"'),
      )
      .map(({ locale, line, detail, suggest }) => ({
        locale,
        line,
        detail,
        suggest,
      }));

  it('rejects the French two-factor names that #4350 replaced', () => {
    const nonShipped = (name: string) =>
      `"${name}" is not the shipped name of UI-label term "Two-factor authentication"`;
    const french = 'use "Authentification à double facteur"';
    expect(
      shippedTwoFactor({
        fr: [
          'Authentification à deux facteurs activée',
          '#### Connexion à deux facteurs imposée',
          'Il se peut que tu doives reconfigurer la double authentification.',
          'Double authentification exigée',
          'Active une double authentification pour chaque compte.',
          'Two-factor authentication',
        ].join('\n'),
        de: 'Two-factor authentication ist aktiv.',
      }),
    ).toEqual([
      {
        locale: 'de',
        line: 1,
        detail:
          'UI-label term "Two-factor authentication" must match shipped string',
        suggest: 'use "Zwei-Faktor-Authentifizierung"',
      },
      {
        locale: 'fr',
        line: 1,
        detail: nonShipped('à deux facteurs'),
        suggest: french,
      },
      {
        locale: 'fr',
        line: 2,
        detail: nonShipped('à deux facteurs'),
        suggest: french,
      },
      {
        locale: 'fr',
        line: 3,
        detail: nonShipped('double authentification'),
        suggest: french,
      },
      {
        locale: 'fr',
        line: 4,
        detail: nonShipped('Double authentification'),
        suggest: french,
      },
      {
        locale: 'fr',
        line: 5,
        detail: nonShipped('double authentification'),
        suggest: french,
      },
      {
        locale: 'fr',
        line: 6,
        detail:
          'UI-label term "Two-factor authentication" must match shipped string',
        suggest: french,
      },
    ]);
  });

  it('keeps the shipped two-factor names and ordinary French factors', () => {
    expect(
      shippedTwoFactor({
        fr: [
          'Authentification à double facteur',
          'Active le double facteur pour ton compte.',
          'Un compte sans aucun des deux facteurs est renvoyé vers la configuration.',
          'Les deux facteurs restent liés au compte.',
          'L’URL est déjà signée et le stockage refuse une double authentification.',
        ].join('\n'),
        de: 'Die Zwei-Faktor-Authentifizierung ist aktiv.',
      }),
    ).toEqual([]);
  });

  // #4484: Google's product and a chat app's workspace keep the English
  // word, while a Tale workspace is an `Arbeitsbereich`.
  it('skips a match inside an allowed name of its locale only', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'workspace',
            category: 'feature',
            en: 'Workspace',
            de: 'Arbeitsbereich',
            fr: 'Espace de travail',
            _allow: { de: ['Google Workspace', 'Chat-Workspace'] },
          },
        ],
        {
          de: [
            'Melde dich bei Google Workspace an und verbinde einen Chat-Workspace.',
            'Der Workspace-Administrator verwaltet Google Workspace und den Workspace.',
          ].join('\n'),
          fr: 'Un administrateur Google Workspace.',
        },
      ),
    );
    expect(
      findings.map(({ locale, line, column }) => ({ locale, line, column })),
    ).toEqual([
      { locale: 'de', line: 2, column: 5 },
      { locale: 'de', line: 2, column: 64 },
      { locale: 'fr', line: 1, column: 26 },
    ]);
  });

  it('skips a non-shipped name inside an allowed name', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'workspace',
            category: 'feature',
            en: 'Workspace',
            de: 'Arbeitsbereich',
            _avoid: { de: ['workspace'] },
            _allow: { de: ['Google Workspace'] },
          },
        ],
        { de: 'Ein Google Workspace ist kein workspace.' },
      ),
    );
    expect(findings.map(({ column, rule }) => ({ column, rule }))).toEqual([
      { column: 31, rule: 'ui-label-non-shipped' },
    ]);
  });

  const shippedWorkspace = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) => detail.includes('UI-label term "Workspace"'))
      .map(({ locale, line, column }) => ({ locale, line, column }));

  it('keeps the Google Workspace and chat workspace names that ship', () => {
    expect(
      shippedWorkspace({
        de: [
          'Die Synchronisierung benötigt einen Google-Workspace-Administrator.',
          'Melde dich mit deinem Konto bei Google Workspace an.',
          'Verbinde ein Postfach, ein Repository oder einen Chat-Workspace.',
        ].join('\n'),
        'de-CH':
          'Die Synchronisierung benötigt einen Google-Workspace-Administrator.',
        fr: 'Elle nécessite un administrateur Google Workspace.',
      }),
    ).toEqual([]);
  });

  it('rejects a Tale workspace under its English name', () => {
    expect(
      shippedWorkspace({
        de: [
          'Dieser Workspace existiert nicht.',
          'Bitte einen Workspace-Administrator um Zugriff.',
        ].join('\n'),
        fr: 'Ce Workspace n’existe pas.',
      }),
    ).toEqual([
      { locale: 'de', line: 1, column: 8 },
      { locale: 'de', line: 2, column: 13 },
      { locale: 'fr', line: 1, column: 4 },
    ]);
  });

  // Every German string with `ß` needs a Swiss copy, so the Swiss copy of a
  // string German may write must pass as well.
  it('judges Swiss German by the German settings unless it has its own', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'editor',
            category: 'role',
            en: 'Editor',
            de: 'Redakteur',
            _lintExclude: { de: true },
          },
          {
            key: 'source',
            category: 'feature',
            en: 'Source',
            de: 'Quelltext',
            _lintExclude: { de: true, 'de-CH': false },
          },
          {
            key: 'workspace',
            category: 'feature',
            en: 'Workspace',
            de: 'Arbeitsbereich',
            _avoid: { de: ['Arbeitsfläche'] },
            _allow: { de: ['Google-Workspace'] },
          },
        ],
        {
          'de-CH': [
            'Schalte sie im Editor live.',
            'Ein Google-Workspace-Administrator verwaltet die Arbeitsfläche.',
            'Öffne die Source.',
          ].join('\n'),
        },
      ),
    );
    expect(
      findings.map(({ locale, line, column, rule }) => ({
        locale,
        line,
        column,
        rule,
      })),
    ).toEqual([
      { locale: 'de-CH', line: 2, column: 50, rule: 'ui-label-non-shipped' },
      { locale: 'de-CH', line: 3, column: 11, rule: 'ui-label-mismatch' },
    ]);
  });

  it('keeps the Swiss sentence that names the automation editor', () => {
    expect(
      terminologyUiLabel
        .run(
          context(null, {
            'de-CH':
              'Die Automatisierung wurde angelegt, aber v1 liess sich nicht live schalten. Schalte sie im Editor live.',
          }),
        )
        .filter(({ detail }) => detail.includes('UI-label term "Editor"')),
    ).toEqual([]);
  });

  // A component's `href` and a video's `src`, `poster` and `captions` hold a
  // path, as a link's URL does; the words of its `title` are prose.
  it('skips the paths in the URL attributes of a Markdown component', () => {
    const findings = terminologyUiLabel.run(
      context(
        [{ key: 'task', category: 'feature', en: 'Task', de: 'Aufgabe' }],
        {
          de: [
            '<Card title="Task" href="/de/Task">',
            '<Video src=\'/videos/Task.mp4\' poster="/Task.webp" captions="/Task.vtt" title="Task" />',
          ].join('\n'),
        },
      ),
    );
    expect(findings.map(({ line, column }) => ({ line, column }))).toEqual([
      { line: 1, column: 14 },
      { line: 2, column: 79 },
    ]);
  });

  const shippedAutomation = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) => /UI-label term "Automations?"/.test(detail))
      .map(({ locale, line, detail }) => ({ locale, line, detail }));

  // #4513: the French guides wrote the lowercase loanword, which the
  // case-sensitive `en` form never matched.
  it('rejects the French automation names that #4513 replaced', () => {
    const nonShipped = (name: string, term: string) =>
      `"${name}" is not the shipped name of UI-label term "${term}"`;
    expect(
      shippedAutomation({
        fr: [
          'Déclencher une automation par webhook',
          'Les exécutions d’automations restent visibles.',
          'Installe l’automation dans le projet.',
        ].join('\n'),
      }),
    ).toEqual([
      { locale: 'fr', line: 1, detail: nonShipped('automation', 'Automation') },
      {
        locale: 'fr',
        line: 2,
        detail: nonShipped('automations', 'Automations'),
      },
      { locale: 'fr', line: 3, detail: nonShipped('automation', 'Automation') },
    ]);
  });

  it('keeps the shipped French name, the pack file and paths', () => {
    expect(
      shippedAutomation({
        fr: [
          'Une automatisation déployée ; les automatisations du projet.',
          'Téléverse workflow.yml (plus automation.yml), ou une .zip du pack.',
          'Lis les [concepts](/fr/platform/automations/concepts) et ![Le modèle](/images/platform/automation-templates.webp).',
          '<Card title="Automatisations" icon="workflow" href="/fr/platform/automations/concepts">',
          '<Video src="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.mp4" poster="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.webp" captions="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.vtt" title="Épisode 5 — Automatisations" />',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  // #4513: names of other things that only contain a UI label.
  it('keeps the names the German and French guides keep', () => {
    const terms = /UI-label term "(Workspace|Home|Vendor|Approval)"/;
    expect(
      terminologyUiLabel
        .run(
          context(null, {
            de: [
              'Slack verbindet pro Slack-Workspace genau einen Satz Zugangsdaten.',
              'Die Organisation **Dev Workspace** entsteht lokal.',
              'Bei einer Workspace-Bereitstellung ändert `tale update` die Workspace-CLI.',
              'Die Rollen eines Workspace-Deployments; bei einem Workspace-Deployment.',
              'Sitzungs-Pods und Workspace-Claims; der Workspace-Claim einer Session.',
              'Prüfe Workspace-Mounts und passende Workspace-Pfade.',
              'Wähle **Teilen > Zum Home-Bildschirm**.',
              'Registriere die Callback-URL in der Vendor-App.',
              'Öffne **Approval check** in der Liste.',
            ].join('\n'),
            fr: 'L’organisation **Dev Workspace** et **Approval check**.',
          }),
        )
        .filter(({ detail }) => terms.test(detail)),
    ).toEqual([]);
  });

  it('rejects a Tale workspace beside a Slack workspace', () => {
    expect(
      shippedWorkspace({
        de: 'Ein Slack-Workspace ist kein Workspace eines Agenten.',
      }),
    ).toEqual([{ locale: 'de', line: 1, column: 30 }]);
  });

  const nonShippedNode = (name: string) =>
    `"${name}" is not the shipped name of UI-label term "Node"`;

  // #4537: German keeps `Node`, so only its retired `Knoten` is reported, in
  // any word a `*` lets it go on into.
  it('reports only the avoided names of a locale that keeps the en form', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'node',
            category: 'feature',
            en: 'Node',
            fr: 'Nœud',
            _avoid: { de: ['*knoten*'] },
          },
        ],
        {
          de: [
            'Die Node, ein Knoten und ein Agent-Knoten.',
            'Agentenknoten, Knotentypen, KNOTENS; Node-Typ.',
          ].join('\n'),
          'de-CH': 'Der Knoten.',
          fr: 'Un Node, un knoten.',
        },
      ),
    );
    expect(
      findings.map(({ locale, line, column, rule, detail }) => ({
        locale,
        line,
        column,
        rule,
        detail,
      })),
    ).toEqual([
      {
        locale: 'de',
        line: 1,
        column: 15,
        rule: 'ui-label-non-shipped',
        detail: nonShippedNode('Knoten'),
      },
      {
        locale: 'de',
        line: 1,
        column: 36,
        rule: 'ui-label-non-shipped',
        detail: nonShippedNode('Knoten'),
      },
      {
        locale: 'de',
        line: 2,
        column: 1,
        rule: 'ui-label-non-shipped',
        detail: nonShippedNode('Agentenknoten'),
      },
      {
        locale: 'de',
        line: 2,
        column: 16,
        rule: 'ui-label-non-shipped',
        detail: nonShippedNode('Knotentypen'),
      },
      {
        locale: 'de',
        line: 2,
        column: 29,
        rule: 'ui-label-non-shipped',
        detail: nonShippedNode('KNOTENS'),
      },
      {
        locale: 'de-CH',
        line: 1,
        column: 5,
        rule: 'ui-label-non-shipped',
        detail: nonShippedNode('Knoten'),
      },
      {
        locale: 'fr',
        line: 1,
        column: 4,
        rule: 'ui-label-mismatch',
        detail: 'UI-label term "Node" must match shipped string',
      },
    ]);
  });

  it('keeps the avoided names of such a locale behind its exclusion', () => {
    expect(
      terminologyUiLabel.run(
        context(
          [
            {
              key: 'node',
              category: 'feature',
              en: 'Node',
              _lintExclude: { de: true },
              _avoid: { de: ['*knoten*'] },
            },
          ],
          { de: 'Ein Agent-Knoten.', 'de-CH': 'Ein Agentenknoten.' },
        ),
      ),
    ).toEqual([]);
  });

  it('lets a listed name go on only at an end marked with a star', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'node',
            category: 'feature',
            en: 'Node',
            // A name that is empty without its stars would match everywhere.
            _avoid: { de: ['*knoten', 'knoten*', '*', '**', 'Agent [*]'] },
          },
        ],
        { de: 'Startknoten, Knotentyp, Knoten, Startknotentyp, Agent Node.' },
      ),
    );
    expect(findings.map(({ column, detail }) => ({ column, detail }))).toEqual([
      { column: 1, detail: nonShippedNode('Startknoten') },
      { column: 25, detail: nonShippedNode('Knoten') },
      { column: 14, detail: nonShippedNode('Knotentyp') },
    ]);
  });

  it('skips an avoided name inside an allowed name that goes on', () => {
    const findings = terminologyUiLabel.run(
      context(
        [
          {
            key: 'node',
            category: 'feature',
            en: 'Node',
            _avoid: { de: ['*knoten*'] },
            _allow: { de: ['Swarm-Knoten*'] },
          },
        ],
        {
          de: 'Jeder Swarm-Knoten steht in der Swarm-Knotenliste; ein Agent-Knoten nicht.',
        },
      ),
    );
    expect(findings.map(({ column, detail }) => ({ column, detail }))).toEqual([
      { column: 62, detail: nonShippedNode('Knoten') },
    ]);
  });

  const shippedNode = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) => detail.includes('UI-label term "Node"'))
      .map(({ locale, line, detail }) => ({ locale, line, detail }));

  // #4537: the German app and guides said `Knoten` beside the shipped `Node`.
  it('rejects the German Knoten names that #4537 replaced', () => {
    expect(
      shippedNode({
        de: [
          'Wiederverwendbare Anleitungspakete für Projekt-Agenten und Agent-Knoten in Automatisierungen.',
          'Prüfe den betroffenen Knoten und die Ablaufspur.',
          'Die Frage eines Agentenknotens beantworten',
          'Unterstützte Knotentypen auflisten',
          'Der Automatisierungseditor zeigt die Einstellungen des ausgewählten Knotens.',
        ].join('\n'),
        'de-CH':
          'Genehmigungspflichtige Connector-Schreibaktionen laufen über Automatisierungsknoten.',
      }),
    ).toEqual([
      { locale: 'de', line: 1, detail: nonShippedNode('Knoten') },
      { locale: 'de', line: 2, detail: nonShippedNode('Knoten') },
      { locale: 'de', line: 3, detail: nonShippedNode('Agentenknotens') },
      { locale: 'de', line: 4, detail: nonShippedNode('Knotentypen') },
      { locale: 'de', line: 5, detail: nonShippedNode('Knotens') },
      {
        locale: 'de-CH',
        line: 1,
        detail: nonShippedNode('Automatisierungsknoten'),
      },
    ]);
  });

  it('keeps the German Node, its compounds and a Docker Swarm node', () => {
    expect(
      shippedNode({
        de: [
          'Wiederverwendbare Anleitungspakete für Projekt-Agenten und Agent-Nodes in Automatisierungen.',
          'Prüfe die betroffene Node und die Ablaufspur.',
          'Die Frage einer Agent-Node beantworten',
          'Unbekannter Node-Typ; unterstützte Node-Typen auflisten',
          'Plane Daemon-Neustarts auf einem Swarm-Knoten stattdessen als Wartung ein.',
        ].join('\n'),
        'de-CH':
          'Genehmigungspflichtige Connector-Schreibaktionen laufen über Automatisierungs-Nodes.',
      }),
    ).toEqual([]);
  });

  // #5192: the register grants Rights (the `tale:*` platform capabilities) and
  // Qualifications; German says Rechte and Qualifikationen, French Droits and
  // Qualifications, the same word as English.
  const shippedGrantKinds = (texts: Record<string, string>) =>
    terminologyUiLabel
      .run(context(null, texts))
      .filter(({ detail }) =>
        /UI-label term "(?:Rights|Qualifications)"/.test(detail),
      )
      .map(({ locale, line, rule, suggest }) => ({
        locale,
        line,
        rule,
        suggest,
      }));

  it('rejects the English and the retired names of rights and qualifications', () => {
    const mismatch = 'ui-label-mismatch';
    const nonShipped = 'ui-label-non-shipped';
    expect(
      shippedGrantKinds({
        de: [
          'Rights',
          'Qualifications',
          'Weise eine Plattform-Berechtigung zu.',
          'Plattform-Berechtigungen',
        ].join('\n'),
        'de-CH': 'Rights und Qualifications',
        fr: [
          'Rights',
          'Attribue une capacité de la plateforme.',
          'Capacités de la plateforme',
        ].join('\n'),
      }),
    ).toEqual([
      { locale: 'de', line: 1, rule: mismatch, suggest: 'use "Rechte"' },
      {
        locale: 'de',
        line: 2,
        rule: mismatch,
        suggest: 'use "Qualifikationen"',
      },
      { locale: 'de', line: 3, rule: nonShipped, suggest: 'use "Rechte"' },
      { locale: 'de', line: 4, rule: nonShipped, suggest: 'use "Rechte"' },
      { locale: 'de-CH', line: 1, rule: mismatch, suggest: 'use "Rechte"' },
      {
        locale: 'de-CH',
        line: 1,
        rule: mismatch,
        suggest: 'use "Qualifikationen"',
      },
      { locale: 'fr', line: 1, rule: mismatch, suggest: 'use "Droits"' },
      { locale: 'fr', line: 2, rule: nonShipped, suggest: 'use "Droits"' },
      { locale: 'fr', line: 3, rule: nonShipped, suggest: 'use "Droits"' },
    ]);
  });

  it('keeps the shipped names, a permission and the French Qualifications', () => {
    expect(
      shippedGrantKinds({
        de: [
          'Rechte und Qualifikationen',
          'Weise einem Mitglied ein Recht oder eine Qualifikation zu.',
          'Die Berechtigung fehlt; Administratorrechte genügen.',
        ].join('\n'),
        'de-CH': 'Rechte und Qualifikationen',
        fr: [
          'Droits et qualifications',
          'Attribue un droit ou une qualification. Qualifications',
          'Les capacités du modèle restent celles de la plateforme.',
        ].join('\n'),
      }),
    ).toEqual([]);
  });
});
