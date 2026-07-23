import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';

import deMessages from '@/messages/de.yml';
import enMessages from '@/messages/en.yml';
import frMessages from '@/messages/fr.yml';
import globalMessages from '@/messages/global.yml';

type Bundle = Record<string, Record<string, unknown>>;

export const i18n = initServiceI18n({
  bundles: { en: enMessages, de: deMessages, fr: frMessages },
  // Vite requires the glob pattern to be a literal at the call site.
  regional: import.meta.glob<Bundle>('../../messages/*-*.yml', {
    eager: true,
    import: 'default',
  }),
  global: globalMessages,
  packages: [uiMessages],
});
