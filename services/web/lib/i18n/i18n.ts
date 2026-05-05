import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import deAtMessages from '@/messages/de-AT.json';
import deChMessages from '@/messages/de-CH.json';
import deMessages from '@/messages/de.json';
import enMessages from '@/messages/en.json';
import frChMessages from '@/messages/fr-CH.json';
import frMessages from '@/messages/fr.json';
import globalMessages from '@/messages/global.json';

const defaultLocale = 'en';

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      de: {
        ...deMessages,
        ...globalMessages,
      },
      'de-AT': {
        ...deAtMessages,
      },
      'de-CH': {
        ...deChMessages,
      },
      en: {
        ...enMessages,
        ...globalMessages,
      },
      fr: {
        ...frMessages,
        ...globalMessages,
      },
      'fr-CH': {
        ...frChMessages,
      },
    },
    lng: typeof navigator !== 'undefined' ? navigator.language : defaultLocale,
    fallbackLng: {
      'de-CH': ['de', defaultLocale],
      'de-AT': ['de', defaultLocale],
      'fr-CH': ['fr', defaultLocale],
      fr: [defaultLocale],
      default: [defaultLocale],
    },
    interpolation: {
      escapeValue: false,
      prefix: '{',
      suffix: '}',
    },
    react: {
      useSuspense: false,
    },
  });

export { i18n };
