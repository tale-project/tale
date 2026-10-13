import { de } from 'date-fns/locale/de';
import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import { describe, expect, it } from 'vitest';

import { dateFnsLocaleFor } from './use-date-fns-locale';

describe('dateFnsLocaleFor', () => {
  it.each([
    ['en', enUS],
    ['en-US', enUS],
    ['en-GB', enUS],
    ['de', de],
    ['de-DE', de],
    ['de-CH', de],
    ['fr', fr],
    ['fr-CH', fr],
    ['FR_fr', fr],
  ])('maps %s onto its base language', (language, locale) => {
    expect(dateFnsLocaleFor(language)).toBe(locale);
  });

  it.each([['es'], ['zh-TW'], [''], [undefined]])(
    'falls back to US English for %s, like the UI text',
    (language) => {
      expect(dateFnsLocaleFor(language)).toBe(enUS);
    },
  );
});
