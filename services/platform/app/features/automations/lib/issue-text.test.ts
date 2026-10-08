import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadLocale } from '@tale/ui/i18n/load-locale';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { CODE_META, type IssueCode } from '@/lib/engine/core/errors';
import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  ISSUE_DERIVED_PARAMS,
  issueLevelLabel,
  issueParamsForText,
  issueText,
  type IssueTextContext,
  type WireIssue,
} from './issue-text';

/**
 * Every issue the engine's golden corpus pins, rendered in every language
 * the app ships. The corpus covers every code the engine can emit (its own
 * test holds it to that), so a sentence that reads a param its code never
 * carries, or a translation whose ICU does not format, fails here.
 */
const GOLDEN = join(
  import.meta.dirname,
  '../../../../lib/engine/core/validate/golden-errors.yml',
);

function goldenIssues(): Array<{ fixture: string; issue: WireIssue }> {
  const corpus = parse(readFileSync(GOLDEN, 'utf8')) as Record<
    string,
    { errors: WireIssue[]; warnings: WireIssue[] }
  >;
  return Object.entries(corpus).flatMap(([fixture, { errors, warnings }]) =>
    [
      ...errors.map((issue) => ({ ...issue, level: 'error' as const })),
      ...warnings.map((issue) => ({ ...issue, level: 'warning' as const })),
    ].map((issue) => ({ fixture, issue })),
  );
}

const LOCALES = ['en', 'de', 'fr', 'de-CH'] as const;

function context(locale: string): IssueTextContext {
  return { locale, t: i18n.getFixedT(locale, 'automationIssues') };
}

interface IcuFormat {
  options: { parseErrorHandler: (error: unknown) => unknown };
}

// The ICU formatter answers a message it cannot format with the raw message;
// here it throws, so a missing value or a malformed translation fails.
let restore: ((error: unknown) => unknown) | undefined;
beforeAll(async () => {
  await loadLocale(i18n, 'de-CH');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- i18next-icu registers itself as the instance's i18nFormat service
  const format = (i18n.services as unknown as { i18nFormat: IcuFormat })
    .i18nFormat;
  restore = format.options.parseErrorHandler;
  format.options.parseErrorHandler = (error) => {
    throw error;
  };
});
afterAll(() => {
  if (restore === undefined) return;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
  (
    i18n.services as unknown as { i18nFormat: IcuFormat }
  ).i18nFormat.options.parseErrorHandler = restore;
});

describe('the test harness', () => {
  it('fails a message whose argument is missing instead of printing it', () => {
    expect(() =>
      context('en').t('reasons.else', { ns: 'automationIssues' }),
    ).toThrow();
  });
});

describe('issueText — every golden issue in every language', () => {
  const issues = goldenIssues();

  it('the corpus names every code the catalog describes', () => {
    const codes = new Set(issues.map(({ issue }) => issue.code));
    expect([...codes].sort()).toEqual(Object.keys(CODE_META).sort());
  });

  for (const locale of LOCALES) {
    it(`${locale}: renders title, explanation, cause and fix`, () => {
      for (const { fixture, issue } of issues) {
        const text = issueText(issue, context(locale));
        const where = `${fixture} ${issue.code}`;
        expect(text.known, where).toBe(true);
        for (const part of [
          text.title,
          text.explanation,
          text.cause,
          text.fix,
        ]) {
          expect(part.trim(), where).not.toBe('');
          // A key that did not resolve, or an argument left in the text.
          expect(part, where).not.toMatch(/codes\.|\{[a-zA-Z]+\}/);
          expect(part, where).not.toContain('NaN');
        }
        // The engine's English never stands in for a translation.
        if (locale !== 'en') {
          expect(text.cause, where).not.toBe(issue.message);
        }
      }
    });
  }
});

describe('issueParamsForText', () => {
  const issues = goldenIssues();

  it('gives each code exactly its own params and the derived ones', () => {
    for (const { fixture, issue } of issues) {
      const code = issue.code as IssueCode;
      const meta = CODE_META[code];
      const technical = new Set(meta.technical ?? []);
      const own = meta.params
        .map((p) => p.replace(/\?$/, ''))
        .filter((p) => !technical.has(p));
      const values = issueParamsForText(issue, context('en'));
      const allowed = new Set([...own, ...ISSUE_DERIVED_PARAMS[code]]);
      for (const key of Object.keys(values)) {
        expect(allowed.has(key), `${fixture}: ${key}`).toBe(true);
      }
      for (const key of ISSUE_DERIVED_PARAMS[code]) {
        expect(values, `${fixture}: derived ${key}`).toHaveProperty(key);
      }
    }
  });

  it('never hands a technical param to a sentence', () => {
    const values = issueParamsForText(
      {
        level: 'error',
        code: 'CODE_SYNTAX',
        message: 'node "main": JavaScript syntax error in "code": Unexpected',
        params: { node: 'main', detail: "Unexpected token ';'" },
      },
      context('en'),
    );
    expect(values).not.toHaveProperty('detail');
    expect(values.nodeLabel).toBe('"main"');
  });

  it('names nodes the way the canvas does, in the language’s quotes', () => {
    const issue: WireIssue = {
      level: 'warning',
      code: 'UNUSED_NODE',
      message: '',
      params: { node: 'fetch_orders', reason: 'unread' },
    };
    expect(issueParamsForText(issue, context('en')).nodeLabel).toBe(
      '"fetch orders"',
    );
    expect(issueParamsForText(issue, context('de')).nodeLabel).toBe(
      '„fetch orders“',
    );
    expect(issueParamsForText(issue, context('de-CH')).nodeLabel).toBe(
      '«fetch orders»',
    );
    expect(issueParamsForText(issue, context('fr')).nodeLabel).toBe(
      '« fetch orders »',
    );
  });

  it('camel-cases what a sentence selects on, and marks an absent optional param', () => {
    const values = issueParamsForText(
      {
        level: 'warning',
        code: 'UNREACHABLE',
        message: '',
        params: { node: 'never', cause: 'else-partner-always-runs' },
      },
      context('en'),
    );
    expect(values.cause).toBe('elsePartnerAlwaysRuns');
    expect(values.partner).toBe('none');
    expect(values.partnerLabel).toBe('none');
  });

  it('names at most six entries of a list and counts the rest', () => {
    const allowed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const issue: WireIssue = {
      level: 'error',
      code: 'UNKNOWN_TOP_FIELD',
      message: '',
      params: { field: 'extra', allowed },
    };
    const en = issueParamsForText(issue, context('en'));
    expect(en.allowedCount).toBe(8);
    expect(en.allowedList).toBe('"a", "b", "c", "d", "e", "f", and 2 more');
    expect(issueParamsForText(issue, context('de')).allowedList).toBe(
      '„a“, „b“, „c“, „d“, „e“, „f“ und noch 2',
    );
    expect(issueParamsForText(issue, context('fr')).allowedList).toBe(
      ['a', 'b', 'c', 'd', 'e'].map((x) => `«\u00a0${x}\u00a0», `).join('') +
        '«\u00a0f\u00a0» et 2 autres',
    );
  });

  it('draws a cycle as the path it takes', () => {
    const values = issueParamsForText(
      {
        level: 'error',
        code: 'REF_CYCLE',
        message: '',
        params: { cycle: ['a', 'b_c', 'a'] },
      },
      context('en'),
    );
    expect(values.cycleList).toBe('"a" → "b c" → "a"');
    expect(values.cycleCount).toBe(3);
  });
});

describe('issueText — what a person reads', () => {
  it('says where a read is, what it reads and when that node is skipped', () => {
    const issue: WireIssue = {
      level: 'warning',
      code: 'MAYBE_NULL',
      message: 'output: nodes.check.output.ok reads "check", …',
      params: {
        field: 'output',
        ref: 'nodes.check.output.ok',
        source: 'check',
        reasons: ['when', 'upstream'],
        via: 'load_rows',
        suggestion: 'nodes.check.output?.ok ?? null',
      },
    };
    expect(issueText(issue, context('en'))).toEqual({
      title: 'Reads a node that may be skipped',
      explanation:
        "A condition or the output reads a node that doesn't always run. When that node is skipped, its output is empty, so reading a field of it fails, and so does placing it inside text.",
      cause:
        'In the automation output, nodes.check.output.ok reads "check", which is skipped when its own condition is false or when "load rows" is skipped.',
      fix: 'Guard the read, for example nodes.check.output?.ok ?? null. Or add an alternative node with "Else of".',
      known: true,
    });
    expect(issueText(issue, context('de')).cause).toBe(
      'In der Ausgabe der Automatisierung liest nodes.check.output.ok aus „check“, die übersprungen wird, wenn ihre eigene Bedingung falsch ist oder wenn „load rows“ übersprungen wird.',
    );
    expect(issueText(issue, context('fr')).cause).toBe(
      'Dans la sortie de l’automatisation, nodes.check.output.ok lit « check », qui est ignoré quand sa propre condition est fausse ou quand « load rows » est ignoré.',
    );
  });

  it('labels a field the way the inspector does', () => {
    const issue: WireIssue = {
      level: 'error',
      code: 'ITEM_OUT_OF_SCOPE',
      message: '',
      params: { node: 'each', field: 'when', name: 'item' },
    };
    expect(issueText(issue, context('en')).cause).toBe(
      'In "When" of "each", "item" is used.',
    );
    expect(issueText(issue, context('de')).cause).toBe(
      'Im Feld „Wenn“ von „each“ wird „item“ verwendet.',
    );
    expect(issueText(issue, context('de-CH')).cause).toBe(
      'Im Feld «Wenn» von «each» wird «item» verwendet.',
    );
  });

  it('keeps literal braces in a fix', () => {
    const { fix } = issueText(
      {
        level: 'warning',
        code: 'OUTPUT_MISSING',
        message: '',
        params: {},
      },
      context('en'),
    );
    expect(fix).toBe(
      'Add an output that reads the results you need, such as {{ nodes.summary.output.text }}.',
    );
  });

  it('reads a code this build does not know as words, never as a key', () => {
    const text = issueText(
      {
        level: 'warning',
        code: 'SOMETHING_NEWER',
        message: 'node "x": something the server learned later',
        hint: 'do the newer thing',
        params: { node: 'x' },
      },
      context('fr'),
    );
    // The engine's English belongs to the technical details, never to the
    // cause a French reader takes for the app's own words.
    expect(text).toEqual({
      title: 'Problème sans description',
      explanation:
        'Cette version de l’application ne décrit pas encore ce problème. Les détails techniques montrent le message du moteur lui-même.',
      cause: '',
      fix: '',
      known: false,
    });
  });

  it('says a type in words, not in the engine’s type syntax', () => {
    const scalar: WireIssue = {
      level: 'warning',
      code: 'TYPE_MISMATCH',
      message: '',
      params: {
        node: 'weather',
        consumer: 'connector',
        property: 'city',
        expr: '{{ nodes.calc.output.count }}',
        expected: 'string',
        actual: 'number | null',
      },
    };
    expect(issueText(scalar, context('en'))).toMatchObject({
      cause:
        'The input "city" of "weather" needs text, but {{ nodes.calc.output.count }} is a number or null.',
      fix: 'Pass text here.',
    });
    expect(issueText(scalar, context('de')).cause).toBe(
      'Die Eingabe „city“ von „weather“ braucht Text, aber {{ nodes.calc.output.count }} ist eine Zahl oder null.',
    );
    expect(issueText(scalar, context('fr')).fix).toBe('Passe ici du texte.');
    const compound: WireIssue = {
      level: 'warning',
      code: 'TYPE_MISMATCH',
      message: '',
      params: {
        node: 'each',
        consumer: 'forEach',
        expr: '{{ nodes.load.output }}',
        expected: 'array',
        actual: '{ items: Array<number> }',
        suggestion: 'items',
      },
    };
    expect(issueText(compound, context('de')).cause).toBe(
      '„Für jedes“ von „each“ braucht eine Liste, aber {{ nodes.load.output }} ist ein Objekt.',
    );
    const test: WireIssue = {
      level: 'warning',
      code: 'TESTS_EXPECT_TYPE',
      message: '',
      params: {
        test: 0,
        name: 'counts',
        property: 'count',
        expected: 'number',
        actual: 'Array<string>',
      },
    };
    expect(issueText(test, context('fr')).cause).toBe(
      'Le test «\u00a0counts\u00a0» attend que output.count soit un nombre, mais l’automatisation y renvoie une liste.',
    );
  });

  it('names the level', () => {
    expect(issueLevelLabel('error', context('de').t)).toBe('Fehler');
    expect(issueLevelLabel('warning', context('fr').t)).toBe('Avertissement');
  });
});
