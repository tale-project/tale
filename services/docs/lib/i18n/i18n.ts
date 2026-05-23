import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';

import deMessages from '@/messages/de.json';
import enMessages from '@/messages/en.json';
import frMessages from '@/messages/fr.json';
import globalMessages from '@/messages/global.json';

type Bundle = Record<string, Record<string, unknown>>;

export const i18n = initServiceI18n({
  bundles: { en: enMessages, de: deMessages, fr: frMessages },
  // Vite requires the glob pattern to be a literal at the call site.
  regional: import.meta.glob<Bundle>('../../messages/*-*.json', {
    eager: true,
    import: 'default',
  }),
  global: globalMessages,
  packages: [uiMessages],
});
