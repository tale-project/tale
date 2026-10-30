import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  totpClientNameSchema,
  totpEnvironmentSchema,
} from './authenticator-name';

/**
 * The environment reference
 * (`docs/{en,de,fr}/self-hosted/configuration/environment-reference.md`)
 * states, in its `TOTP_CLIENT_NAME` and `TOTP_ENVIRONMENT` rows, every rule of
 * `totpClientNameSchema` and `totpEnvironmentSchema` that stops the backend
 * when broken (`backend/env.ts` parses both at startup). The rows are written
 * by hand, and they once named the allowed characters alone, so an empty
 * `TOTP_CLIENT_NAME=` line or a name that opened with `&` stopped a backend
 * set up by the book (#4427). Each rule below pairs a probe of its schema with
 * the words each locale's row states it in: a schema that changes a rule fails
 * the probe, and a row that drops one fails the words. The pages are outside
 * this workspace: `services/platform/turbo.json` hashes them for this suite.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const LOCALES = ['en', 'de', 'fr'] as const;

type Locale = (typeof LOCALES)[number];

interface Rule {
  /** The rule, as the tests name it. */
  rule: string;
  /** Holds while the schema keeps the rule. */
  probe: () => void;
  /** The words each locale's row states the rule in. */
  words: Record<Locale, string>;
}

interface Schema {
  safeParse(value: unknown): { success: boolean };
}

function accepts(schema: Schema, value: string | undefined): boolean {
  return schema.safeParse(value).success;
}

/** Every printable ASCII character but the letters and digits, space included. */
const ASCII_SYMBOLS = Array.from({ length: 0x7f - 0x20 }, (_, index) =>
  String.fromCodePoint(0x20 + index),
).filter((char) => !/[a-z0-9]/i.test(char));

const ROWS: { variable: string; rules: Rule[] }[] = [
  {
    variable: 'TOTP_CLIENT_NAME',
    rules: [
      {
        rule: 'surrounding whitespace is trimmed and inner runs collapse to one space',
        probe: () => {
          expect(totpClientNameSchema.parse(' \tAcme \u00a0\t & Co\n')).toBe(
            'Acme & Co',
          );
        },
        words: {
          en: 'Surrounding whitespace is trimmed and inner runs of whitespace collapse to one space',
          de: 'Leerzeichen am Rand werden entfernt, mehrere Leerzeichen hintereinander zu einem zusammengefasst',
          fr: 'Les espaces aux extrémités sont supprimés et les espaces consécutifs à l’intérieur du nom sont réduits à un seul',
        },
      },
      {
        rule: "it holds 1 to 40 letters, digits, spaces or & ' . + -",
        probe: () => {
          expect(accepts(totpClientNameSchema, 'A')).toBe(true);
          expect(accepts(totpClientNameSchema, 'A'.repeat(40))).toBe(true);
          expect(accepts(totpClientNameSchema, 'A'.repeat(41))).toBe(false);
          // Letters and digits of any script count.
          expect(accepts(totpClientNameSchema, 'Zürich 東京 ٤٢')).toBe(true);
          for (const symbol of ASCII_SYMBOLS) {
            expect(
              accepts(totpClientNameSchema, `Acme${symbol}Co`),
              `Acme${symbol}Co`,
            ).toBe(" &'.+-".includes(symbol));
          }
        },
        words: {
          en: "1–40 letters, digits, spaces or `&` `'` `.` `+` `-`",
          de: "1–40 Buchstaben, Ziffern, Leerzeichen oder `&` `'` `.` `+` `-`",
          fr: "1–40 lettres, chiffres, espaces ou `&` `'` `.` `+` `-`",
        },
      },
      {
        rule: 'it starts with a letter or digit',
        probe: () => {
          for (const symbol of "&'.+-") {
            expect(
              accepts(totpClientNameSchema, `${symbol} Co`),
              `${symbol} Co`,
            ).toBe(false);
          }
          expect(accepts(totpClientNameSchema, '3M')).toBe(true);
        },
        words: {
          en: 'starting with a letter or digit',
          de: 'mit einem Buchstaben oder einer Ziffer beginnen',
          fr: 'commencer par une lettre ou un chiffre',
        },
      },
      {
        rule: 'an empty value is refused, an unset one is not',
        probe: () => {
          expect(accepts(totpClientNameSchema, undefined)).toBe(true);
          expect(accepts(totpClientNameSchema, '')).toBe(false);
          expect(accepts(totpClientNameSchema, ' \t')).toBe(false);
        },
        words: {
          en: 'Leave the variable unset rather than empty: an empty or invalid name prevents backend startup',
          de: 'Lass die Variable weg, statt sie leer zu lassen: Ein leerer oder ungültiger Name verhindert den Backend-Start',
          // French sets a no-break space before the colon.
          fr: 'Omets la variable plutôt que de la laisser vide\u00a0: un nom vide ou invalide empêche le backend de démarrer',
        },
      },
    ],
  },
  {
    variable: 'TOTP_ENVIRONMENT',
    rules: [
      {
        rule: 'surrounding whitespace is trimmed',
        probe: () => {
          expect(totpEnvironmentSchema.parse(' \tte\n')).toBe('TE');
        },
        words: {
          en: 'Surrounding whitespace is trimmed',
          de: 'Leerzeichen am Rand werden entfernt',
          fr: 'Les espaces aux extrémités sont supprimés',
        },
      },
      {
        rule: 'it holds 1 to 32 ASCII letters, digits, underscores or hyphens',
        probe: () => {
          expect(accepts(totpEnvironmentSchema, 'a')).toBe(true);
          expect(accepts(totpEnvironmentSchema, 'a'.repeat(32))).toBe(true);
          expect(accepts(totpEnvironmentSchema, 'a'.repeat(33))).toBe(false);
          // Letters outside ASCII do not count.
          expect(accepts(totpEnvironmentSchema, 'prüf')).toBe(false);
          for (const symbol of ASCII_SYMBOLS) {
            expect(
              accepts(totpEnvironmentSchema, `te${symbol}1`),
              `te${symbol}1`,
            ).toBe('_-'.includes(symbol));
          }
        },
        words: {
          en: '1–32 ASCII letters, digits, underscores or hyphens',
          de: '1–32 ASCII-Buchstaben, Ziffern, Unterstrichen oder Bindestrichen',
          fr: '1–32 lettres ASCII, chiffres, tirets bas ou traits d’union',
        },
      },
      {
        rule: 'it starts with a letter or digit',
        probe: () => {
          for (const symbol of '_-') {
            expect(
              accepts(totpEnvironmentSchema, `${symbol}te`),
              `${symbol}te`,
            ).toBe(false);
          }
          expect(accepts(totpEnvironmentSchema, '2nd')).toBe(true);
        },
        words: {
          en: 'starting with a letter or digit',
          de: 'mit einem Buchstaben oder einer Ziffer beginnen',
          fr: 'commencer par une lettre ou un chiffre',
        },
      },
      {
        rule: 'its letters are uppercased',
        probe: () => {
          expect(totpEnvironmentSchema.parse('Preview-42')).toBe('PREVIEW-42');
        },
        words: {
          en: 'and is then uppercased',
          de: 'die Buchstaben werden anschließend großgeschrieben',
          fr: 'les lettres passent ensuite en majuscules',
        },
      },
      {
        rule: 'an empty value is refused, an unset one is not',
        probe: () => {
          expect(accepts(totpEnvironmentSchema, undefined)).toBe(true);
          expect(accepts(totpEnvironmentSchema, '')).toBe(false);
          expect(accepts(totpEnvironmentSchema, ' \t')).toBe(false);
        },
        words: {
          en: 'Leave the variable unset rather than empty: an empty or invalid label prevents backend startup',
          de: 'Lass die Variable weg, statt sie leer zu lassen: Ein leerer oder ungültiger Wert verhindert den Backend-Start',
          // French sets a no-break space before the colon.
          fr: 'Omets la variable plutôt que de la laisser vide\u00a0: une valeur vide ou invalide empêche le backend de démarrer',
        },
      },
    ],
  },
];

/** The row of `locale`'s environment reference that documents `variable`. */
function referenceRow(locale: Locale, variable: string): string {
  const page = readFileSync(
    path.join(
      REPO_ROOT,
      'docs',
      locale,
      'self-hosted/configuration/environment-reference.md',
    ),
    'utf8',
  );
  const rows = page
    .split('\n')
    .filter((line) => line.startsWith(`| \`${variable}\` |`));
  expect(rows, `docs/${locale} documents ${variable} in one row`).toHaveLength(
    1,
  );
  return rows[0] ?? '';
}

for (const { variable, rules } of ROWS) {
  describe(`the ${variable} row of the environment reference`, () => {
    for (const { rule, probe, words } of rules) {
      describe(rule, () => {
        it('holds in the schema', probe);

        it.each(LOCALES)('is stated in docs/%s', (locale) => {
          expect(
            referenceRow(locale, variable),
            `docs/${locale} no longer states that ${rule}`,
          ).toContain(words[locale]);
        });
      });
    }
  });
}
