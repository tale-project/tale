/**
 * Every shipped connector action is named for people in every language the
 * app ships: an English `title` plus German and French overrides, written the
 * way the rest of the product writes labels. The automation canvas shows a
 * connector node as "{connector} · {title}" ("GitHub · List issues"), so an
 * action without its titles would put a raw `github.list_issues` (or an
 * English phrase in a German canvas) in front of the reader.
 *
 * The connectors themselves are named the same way: a brand ("GitHub") keeps
 * its name everywhere, and a connector named with ordinary words ("Tasks")
 * carries its German and French display names. Each shipped connector is one
 * or the other, so a new one has to be classified when it lands.
 *
 * A connector's settings (`configFields`) are worded the same way: the
 * credential form shows each one's label, its help and the options of a
 * select in the reader's language, so every one of those texts carries its
 * German and French — a setting that lands in English only would show
 * "IMAP server" or a raw `starttls` to a German administrator.
 */

import path from 'node:path';

import type { Connector } from '@tale/shared/schemas/connectors';
import { describe, expect, it } from 'vitest';

import { loadConnectorDefinitions } from './catalog';

const SYSTEM_ROOT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../configs/platform/system',
);

/** The full locales beside English, each of which every title must carry. */
const REQUIRED_LOCALES = ['de', 'fr'] as const;

/** Every locale an override may name: the full ones and the sparse Swiss
 * German overlay. A key outside it would be text nobody can ever read. */
const KNOWN_LOCALES = new Set(['de', 'fr', 'de-CH']);

/** Connectors named after a product: the name is the same in every
 * language, so they carry no display-name overrides. */
const BRAND_CONNECTORS = new Set([
  'confluence',
  'discord',
  'forgejo',
  'github',
  'glitchtip',
  'gmail',
  'google-drive',
  'outlook',
  'shopify',
  'slack',
  'tavily',
  'teams',
  'twilio',
]);

/** A title's casing in English and French: the first letter upper case, every
 * later word lower case unless it is an acronym ("Send SMS"). German is left
 * out — its nouns are capitalised. */
function sentenceCaseProblem(title: string): string | undefined {
  const words = title.split(/\s+/);
  const first = words[0] ?? '';
  if (first.charAt(0) !== first.charAt(0).toLocaleUpperCase()) {
    return 'does not start with a capital letter';
  }
  for (const word of words.slice(1)) {
    const letters = word.replaceAll(/[^\p{L}]/gu, '');
    const isAcronym = letters.length >= 2 && letters === letters.toUpperCase();
    if (!isAcronym && word.charAt(0) !== word.charAt(0).toLocaleLowerCase()) {
      return `is not sentence case ("${word}")`;
    }
  }
  return undefined;
}

/** What is wrong with one title in one language, or undefined. */
function titleProblem(title: string, locale: string): string | undefined {
  if (title !== title.trim()) return 'has surrounding whitespace';
  if (/[.:;!?]$/.test(title)) return 'ends in punctuation';
  if (locale === 'fr' && title.includes("'")) {
    return 'uses a straight apostrophe (French titles use ’)';
  }
  if (locale === 'en' || locale === 'fr') return sentenceCaseProblem(title);
  const first = title.charAt(0);
  return first === first.toLocaleUpperCase()
    ? undefined
    : 'does not start with a capital letter';
}

/** Every problem with one connector's display data, as readable lines. */
function displayProblems(connector: Connector): string[] {
  const problems: string[] = [];
  const titles = new Map<string, Map<string, string>>();
  const note = (locale: string, action: string, title: string) => {
    const seen = titles.get(locale) ?? new Map<string, string>();
    const other = seen.get(title);
    if (other !== undefined) {
      problems.push(
        `${connector.name}.${action}: ${locale} title "${title}" is also ${other}'s`,
      );
    }
    seen.set(title, action);
    titles.set(locale, seen);
  };

  for (const action of connector.actions) {
    const at = `${connector.name}.${action.name}`;
    if (action.title === undefined) {
      problems.push(`${at}: has no title`);
    } else {
      const problem = titleProblem(action.title, 'en');
      if (problem !== undefined) problems.push(`${at}: en title ${problem}`);
      note('en', action.name, action.title);
    }
    for (const locale of Object.keys(action.i18n ?? {})) {
      if (!KNOWN_LOCALES.has(locale)) {
        problems.push(
          `${at}: names a locale the app does not ship (${locale})`,
        );
      }
    }
    for (const locale of REQUIRED_LOCALES) {
      const title = action.i18n?.[locale]?.title;
      if (title === undefined) {
        problems.push(`${at}: has no ${locale} title`);
        continue;
      }
      const problem = titleProblem(title, locale);
      if (problem !== undefined)
        problems.push(`${at}: ${locale} title ${problem}`);
      note(locale, action.name, title);
    }
    // Swiss German writes ss for ß: a German title that needs one carries
    // its de-CH override.
    const german = action.i18n?.de?.title;
    const swiss = action.i18n?.['de-CH']?.title;
    if (
      german?.includes('ß') === true &&
      (swiss === undefined || swiss.includes('ß'))
    ) {
      problems.push(`${at}: de title has ß but no de-CH title without it`);
    }
  }

  if (BRAND_CONNECTORS.has(connector.name)) {
    if (connector.i18n !== undefined) {
      problems.push(
        `${connector.name}: a brand keeps its name, yet it carries display-name overrides`,
      );
    }
  } else {
    for (const locale of REQUIRED_LOCALES) {
      if (connector.i18n?.[locale]?.displayName === undefined) {
        problems.push(
          `${connector.name}: is not a listed brand and has no ${locale} display name`,
        );
      }
    }
  }
  return problems;
}

type ConfigField = Connector['configFields'][number];
type ConfigFieldText = NonNullable<ConfigField['i18n']>[string];

/** The texts the credential form shows for one setting: its label, its help
 * when it has one, and the label of each option of a select — each read in
 * English and in one language's overrides. */
function settingTexts(field: ConfigField): Array<{
  name: string;
  en: string | undefined;
  translated: (text: ConfigFieldText | undefined) => string | undefined;
}> {
  return [
    { name: 'label', en: field.label, translated: (text) => text?.label },
    ...(field.description === undefined
      ? []
      : [
          {
            name: 'description',
            en: field.description,
            translated: (text: ConfigFieldText | undefined) =>
              text?.description,
          },
        ]),
    ...(field.enum ?? []).map((option) => ({
      name: `label for option "${option}"`,
      en: field.optionLabels?.[option],
      translated: (text: ConfigFieldText | undefined) =>
        text?.optionLabels?.[option],
    })),
  ];
}

/** Every problem with one connector's settings texts, as readable lines. */
function settingProblems(connector: Connector): string[] {
  const problems: string[] = [];
  for (const field of connector.configFields) {
    const at = `${connector.name}.configFields.${field.key}`;
    for (const locale of Object.keys(field.i18n ?? {})) {
      if (!KNOWN_LOCALES.has(locale)) {
        problems.push(
          `${at}: names a locale the app does not ship (${locale})`,
        );
      }
    }
    for (const text of settingTexts(field)) {
      if (text.en === undefined) problems.push(`${at}: has no ${text.name}`);
      for (const locale of REQUIRED_LOCALES) {
        if (text.translated(field.i18n?.[locale]) === undefined) {
          problems.push(`${at}: has no ${locale} ${text.name}`);
        }
      }
      // Swiss German writes ss for ß, as for an action's title.
      const swiss = text.translated(field.i18n?.['de-CH']);
      if (
        text.translated(field.i18n?.de)?.includes('ß') === true &&
        (swiss === undefined || swiss.includes('ß'))
      ) {
        problems.push(
          `${at}: de ${text.name} has ß but no de-CH ${text.name} without it`,
        );
      }
    }
  }
  return problems;
}

const shipped = loadConnectorDefinitions({ root: SYSTEM_ROOT });

describe('connector display data', () => {
  it('names every shipped action in English, German and French, as labels are written', () => {
    expect(shipped.flatMap(displayProblems)).toEqual([]);
    // The guard read the whole catalog, not an empty directory.
    expect(shipped.flatMap((c) => c.actions).length).toBeGreaterThan(100);
  });

  it('names every shipped connector for its readers: a brand as itself, the rest translated', () => {
    for (const connector of shipped) {
      const named =
        BRAND_CONNECTORS.has(connector.name) ||
        REQUIRED_LOCALES.every(
          (locale) => connector.i18n?.[locale]?.displayName !== undefined,
        );
      expect(named, connector.name).toBe(true);
    }
  });

  it('bites: an action that lands without its titles, or with a sloppy one, is named', () => {
    const github = shipped.find((c) => c.name === 'github');
    if (github === undefined) throw new Error('github ships with the platform');
    const [first, second] = github.actions;
    if (first === undefined || second === undefined) {
      throw new Error('github ships more than one action');
    }
    const broken: Connector = {
      ...github,
      actions: [
        { ...first, title: undefined, i18n: undefined },
        {
          ...second,
          title: 'Get A repository.',
          i18n: {
            de: { title: 'Repository abrufen' },
            fr: { title: "Récupérer l'issue" },
            'de-AT': { title: 'Repository abrufen' },
          },
        },
      ],
    };
    expect(displayProblems(broken)).toEqual([
      `github.${first.name}: has no title`,
      `github.${first.name}: has no de title`,
      `github.${first.name}: has no fr title`,
      `github.${second.name}: en title ends in punctuation`,
      `github.${second.name}: names a locale the app does not ship (de-AT)`,
      `github.${second.name}: fr title uses a straight apostrophe (French titles use ’)`,
    ]);
  });

  it('bites: duplicate titles, a lowercase start, a word in title case, a ß without its Swiss form', () => {
    const github = shipped.find((c) => c.name === 'github');
    if (github === undefined) throw new Error('github ships with the platform');
    const [first, second] = github.actions;
    if (first === undefined || second === undefined) {
      throw new Error('github ships more than one action');
    }
    const broken: Connector = {
      ...github,
      actions: [
        {
          ...first,
          title: 'List Issues',
          i18n: {
            de: { title: 'issues auflisten' },
            fr: { title: 'Lister les issues' },
          },
        },
        {
          ...second,
          title: 'Get issue',
          i18n: {
            de: { title: 'Issue schließen' },
            fr: { title: 'Lister les issues' },
          },
        },
      ],
    };
    expect(displayProblems(broken)).toEqual([
      `github.${first.name}: en title is not sentence case ("Issues")`,
      `github.${first.name}: de title does not start with a capital letter`,
      `github.${second.name}: fr title "Lister les issues" is also ${first.name}'s`,
      `github.${second.name}: de title has ß but no de-CH title without it`,
    ]);
  });

  it('bites: a new connector that is neither a listed brand nor translated', () => {
    const task = shipped.find((c) => c.name === 'task');
    if (task === undefined) throw new Error('task ships with the platform');
    expect(
      displayProblems({ ...task, name: 'calendar', i18n: undefined }),
    ).toEqual([
      'calendar: is not a listed brand and has no de display name',
      'calendar: is not a listed brand and has no fr display name',
    ]);
  });

  it('words every shipped setting in English, German and French: label, help and options', () => {
    expect(shipped.flatMap(settingProblems)).toEqual([]);
    // The guard read the settings, a select among them, not an empty list.
    const fields = shipped.flatMap((c) => c.configFields);
    expect(fields.length).toBeGreaterThan(5);
    expect(fields.some((field) => field.enum !== undefined)).toBe(true);
  });

  it('bites: a setting that lands in English only, an option without its labels, a ß without its Swiss form', () => {
    const mailbox = shipped.find((c) => c.name === 'imap-smtp');
    const imapHost = mailbox?.configFields.find((f) => f.key === 'imapHost');
    const security = mailbox?.configFields.find((f) => f.key === 'security');
    if (
      mailbox === undefined ||
      imapHost === undefined ||
      security === undefined
    ) {
      throw new Error('imap-smtp ships with its server and security settings');
    }
    const broken: Connector = {
      ...mailbox,
      configFields: [
        { ...imapHost, i18n: undefined },
        {
          ...security,
          optionLabels: { tls: 'Implicit TLS' },
          i18n: {
            de: {
              label: 'Verbindungssicherheit',
              description: 'Für Ports außerhalb des Standards.',
              optionLabels: { tls: 'Implizites TLS', starttls: 'STARTTLS' },
            },
            fr: {
              label: 'Sécurité de la connexion',
              optionLabels: { starttls: 'STARTTLS' },
            },
            'de-AT': { label: 'Verbindungssicherheit' },
          },
        },
      ],
    };
    expect(settingProblems(broken)).toEqual([
      'imap-smtp.configFields.imapHost: has no de label',
      'imap-smtp.configFields.imapHost: has no fr label',
      'imap-smtp.configFields.imapHost: has no de description',
      'imap-smtp.configFields.imapHost: has no fr description',
      'imap-smtp.configFields.security: names a locale the app does not ship (de-AT)',
      'imap-smtp.configFields.security: has no fr description',
      'imap-smtp.configFields.security: de description has ß but no de-CH description without it',
      'imap-smtp.configFields.security: has no fr label for option "tls"',
      'imap-smtp.configFields.security: has no label for option "starttls"',
    ]);
  });
});
