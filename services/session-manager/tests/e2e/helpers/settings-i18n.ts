import { createI18n } from '@tale/e2e/i18n';

/**
 * The catalogs of the languages the app offers, for the specs that switch
 * language: `helpers/i18n.ts` resolves English only. Each resolver is built as
 * the app builds its own catalog: the shared component library's, with the
 * service's laid over it.
 */

export type Language = 'en' | 'de' | 'fr';

export const LANGUAGES: readonly Language[] = ['en', 'de', 'fr'];

const UI_MESSAGES = new URL(
  '../../../../../packages/ui/src/i18n/messages/',
  import.meta.url,
);
const SERVICE_MESSAGES = new URL('../../../messages/', import.meta.url);

function resolverFor(language: Language): (key: string) => string {
  return createI18n(new URL(`${language}/`, SERVICE_MESSAGES), {
    packages: [
      new URL('global.yml', UI_MESSAGES),
      new URL(`${language}.yml`, UI_MESSAGES),
    ],
  }).t;
}

/** `tIn.de('navigation.sections.sessions')`: a label in that language. */
export const tIn: Record<Language, (key: string) => string> = {
  en: resolverFor('en'),
  de: resolverFor('de'),
  fr: resolverFor('fr'),
};

/** The service's own, untranslated strings (`messages/global.yml`): the app's name. */
const globalMessages = createI18n(SERVICE_MESSAGES).t;
export const APP_NAME = globalMessages('global.common.appName');

/**
 * The text of a browser tab: the page's name, then the app's, joined with a
 * hyphen as the platform's pages are titled (a page with no name of its own is
 * titled by the app alone).
 */
export function tabTitle(pageName?: string): string {
  return pageName === undefined ? APP_NAME : `${pageName} - ${APP_NAME}`;
}

/** The name a language goes by in the language menu: the same in every language. */
export function languageName(language: Language): string {
  return tIn.en(`languageSwitcher.locales.${language}`);
}

/**
 * A message with `{name, plural, one {...} other {...}}` parts for counts, the
 * way the language words it (`t()` does not interpolate): `#` is the count.
 */
export function formatPlurals(
  message: string,
  counts: Record<string, number>,
  language: Language = 'en',
): string {
  const rules = new Intl.PluralRules(language);
  return message.replaceAll(
    /\{(\w+),\s*plural,((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_whole, name: string, body: string) => {
      const count = counts[name];
      if (count === undefined) throw new Error(`No count for ${name}`);
      const forms = new Map<string, string>();
      for (const match of body.matchAll(/(\w+)\s*\{([^{}]*)\}/g)) {
        const [, form = '', text = ''] = match;
        forms.set(form, text);
      }
      const text = forms.get(rules.select(count)) ?? forms.get('other');
      if (text === undefined) throw new Error(`No plural form in: ${message}`);
      return text.replaceAll('#', String(count));
    },
  );
}

/** A `{count, plural, one {# tool} other {# tools}}` message for a count. */
export function plural(
  message: string,
  count: number,
  language: Language = 'en',
): string {
  return formatPlurals(message, { count }, language);
}
