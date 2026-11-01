import { loadLocale } from '@tale/ui/i18n/load-locale';
import { createInstance } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CronProblem, CronProblemKind } from '@/lib/automations/cron';
import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  cronInvalidText,
  type CronProblemTextContext,
} from './cron-problem-text';

beforeAll(async () => {
  await loadLocale(i18n, 'de-CH');
});

function context(locale: string): CronProblemTextContext {
  return { t: i18n.getFixedT(locale, 'automations'), locale };
}

type Locale = 'en' | 'de' | 'fr' | 'de-CH';

/** Every kind the parser refuses with, and how each locale words it. Keyed
 * by kind: a kind the parser gains fails typecheck here until it has its
 * sentences. */
const SENTENCES: {
  [K in CronProblemKind]: {
    problem: Extract<CronProblem, { kind: K }>;
    sentences: Record<Locale, string>;
  };
} = {
  field_count: {
    problem: { kind: 'field_count', count: 4 },
    sentences: {
      en: 'That cron expression is not valid: it has 4 fields instead of 5 (minute hour day month weekday).',
      de: 'Dieser Cron-Ausdruck ist ungültig: Er hat 4 Felder statt 5 (Minute Stunde Tag Monat Wochentag).',
      fr: 'Cette expression cron n’est pas valide\u00a0: elle a 4 champs au lieu de 5 (minute heure jour mois jour-semaine).',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Er hat 4 Felder statt 5 (Minute Stunde Tag Monat Wochentag).',
    },
  },
  empty_entry: {
    problem: { kind: 'empty_entry', field: 'minute', token: '1,,2' },
    sentences: {
      en: 'That cron expression is not valid: in the minute field, "1,,2" has a comma with no value next to it.',
      de: 'Dieser Cron-Ausdruck ist ungültig: Im Feld „Minute“ steht in „1,,2“ ein Komma ohne Wert daneben.',
      fr: 'Cette expression cron n’est pas valide\u00a0: dans le champ «\u00a0minute\u00a0», «\u00a01,,2\u00a0» contient une virgule sans valeur à côté.',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Im Feld «Minute» steht in «1,,2» ein Komma ohne Wert daneben.',
    },
  },
  invalid_step: {
    problem: { kind: 'invalid_step', field: 'minute', token: '*/0' },
    sentences: {
      en: 'That cron expression is not valid: in the minute field, the step in "*/0" is not a whole number of 1 or more.',
      de: 'Dieser Cron-Ausdruck ist ungültig: Im Feld „Minute“ ist die Schrittweite in „*/0“ keine ganze Zahl ab 1.',
      fr: 'Cette expression cron n’est pas valide\u00a0: dans le champ «\u00a0minute\u00a0», le pas de «\u00a0*/0\u00a0» n’est pas un nombre entier d’au moins 1.',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Im Feld «Minute» ist die Schrittweite in «*/0» keine ganze Zahl ab 1.',
    },
  },
  not_a_range: {
    problem: { kind: 'not_a_range', field: 'hour', token: '5-' },
    sentences: {
      en: 'That cron expression is not valid: in the hour field, "5-" is not a range — write it as "from-to".',
      de: 'Dieser Cron-Ausdruck ist ungültig: Im Feld „Stunde“ ist „5-“ kein Bereich — schreib ihn als „von-bis“.',
      fr: 'Cette expression cron n’est pas valide\u00a0: dans le champ «\u00a0heure\u00a0», «\u00a05-\u00a0» n’est pas une plage — écris-la sous la forme «\u00a0début-fin\u00a0».',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Im Feld «Stunde» ist «5-» kein Bereich — schreib ihn als «von-bis».',
    },
  },
  out_of_range: {
    problem: {
      kind: 'out_of_range',
      field: 'dayOfWeek',
      token: 'MON',
      min: 0,
      max: 7,
    },
    sentences: {
      en: 'That cron expression is not valid: in the weekday field, "MON" is out of range — use whole numbers from 0 to 7.',
      de: 'Dieser Cron-Ausdruck ist ungültig: Im Feld „Wochentag“ liegt „MON“ außerhalb des Bereichs — erlaubt sind ganze Zahlen von 0 bis 7.',
      fr: 'Cette expression cron n’est pas valide\u00a0: dans le champ «\u00a0jour-semaine\u00a0», «\u00a0MON\u00a0» est hors limites — utilise des nombres entiers de 0 à 7.',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Im Feld «Wochentag» liegt «MON» ausserhalb des Bereichs — erlaubt sind ganze Zahlen von 0 bis 7.',
    },
  },
  matches_nothing: {
    problem: { kind: 'matches_nothing', field: 'dayOfMonth', token: '*/99' },
    sentences: {
      en: 'That cron expression is not valid: in the day field, "*/99" matches no value.',
      de: 'Dieser Cron-Ausdruck ist ungültig: Im Feld „Tag“ trifft „*/99“ keinen Wert.',
      fr: 'Cette expression cron n’est pas valide\u00a0: dans le champ «\u00a0jour\u00a0», «\u00a0*/99\u00a0» ne correspond à aucune valeur.',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Im Feld «Tag» trifft «*/99» keinen Wert.',
    },
  },
  impossible_date: {
    problem: { kind: 'impossible_date', days: [31], months: [4, 6] },
    sentences: {
      en: 'That cron expression is not valid: there is no day 31 in April or June.',
      de: 'Dieser Cron-Ausdruck ist ungültig: Tag 31 kommt im April oder Juni nie vor.',
      fr: 'Cette expression cron n’est pas valide\u00a0: il n’y a pas de jour 31 en avril ou juin.',
      'de-CH':
        'Dieser Cron-Ausdruck ist ungültig: Tag 31 kommt im April oder Juni nie vor.',
    },
  },
};

const CASES = Object.values(SENTENCES).flatMap(({ problem, sentences }) =>
  Object.entries(sentences).map(([locale, sentence]) => ({
    kind: problem.kind,
    locale,
    problem,
    sentence,
  })),
);

describe('cronInvalidText', () => {
  it.each(CASES)(
    'says $kind in $locale, with what was written and what is allowed',
    ({ locale, problem, sentence }) => {
      expect(cronInvalidText(problem, context(locale))).toBe(sentence);
    },
  );

  it('counts one field as one, and lists every day it cannot place', () => {
    expect(
      cronInvalidText({ kind: 'field_count', count: 1 }, context('en')),
    ).toBe(
      'That cron expression is not valid: it has 1 field instead of 5 (minute hour day month weekday).',
    );
    expect(
      cronInvalidText(
        { kind: 'impossible_date', days: [30, 31], months: [2] },
        context('fr'),
      ),
    ).toBe(
      'Cette expression cron n’est pas valide\u00a0: il n’y a pas de jour 30 ou 31 en février.',
    );
  });

  it('reads as the plain refusal without a problem', () => {
    expect(cronInvalidText(null, context('de'))).toBe(
      'Dieser Cron-Ausdruck ist ungültig.',
    );
  });

  it('reads as the plain refusal when the catalog has no words for the kind', async () => {
    const bare = createInstance();
    await bare.init({
      lng: 'en',
      resources: {
        en: {
          automations: {
            trigger: {
              cronInvalid: 'That cron expression is not valid.',
              cronInvalidReason: 'That cron expression is not valid: {reason}.',
              cronFields: { minute: 'minute' },
            },
          },
        },
      },
    });
    expect(
      cronInvalidText(SENTENCES.invalid_step.problem, {
        t: bare.getFixedT('en', 'automations'),
        locale: 'en',
      }),
    ).toBe('That cron expression is not valid.');
  });

  it('reads as the plain refusal for a kind it does not know', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a kind from a newer parser than this editor
    const unknown = { kind: 'seconds_field' } as unknown as CronProblem;
    expect(cronInvalidText(unknown, context('fr'))).toBe(
      'Cette expression cron n’est pas valide.',
    );
  });
});
