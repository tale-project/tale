import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ICU from 'i18next-icu';
import enMessages from '@/messages/en.json';
import globalMessages from '@/messages/global.json';
import { defaultLocale } from './config';

i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        ...enMessages,
        ...globalMessages,
      },
    },
    lng: defaultLocale,
    fallbackLng: defaultLocale,
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
