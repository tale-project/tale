import { initI18n } from '@tale/webui/i18n/init';

import deAtMessages from '@/messages/de-AT.json';
import deChMessages from '@/messages/de-CH.json';
import deMessages from '@/messages/de.json';
import enMessages from '@/messages/en.json';
import frChMessages from '@/messages/fr-CH.json';
import frMessages from '@/messages/fr.json';
import globalMessages from '@/messages/global.json';

export const i18n = initI18n({
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
    'de-AT': deAtMessages,
    'de-CH': deChMessages,
    'fr-CH': frChMessages,
  },
  global: globalMessages,
});
