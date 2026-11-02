import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { uiMessages } from '@tale/ui/i18n/messages';
import { catalogsByLocale } from '@tale/ui/i18n/topic-catalogs';

import globalMessages from '@/messages/global.yml';

type Bundle = Record<string, Record<string, unknown>>;

// Every catalog is a directory of topic files, one namespace each
// (`messages/<locale>/<topic>.yml`), the same topics in every locale. Vite
// requires the glob pattern to be a literal at the call site.
const catalogs = catalogsByLocale(
  import.meta.glob<Record<string, unknown>>('../../messages/*/*.yml', {
    eager: true,
    import: 'default',
  }),
);

// `packages` layers the shared component library's message bundle
// under this service's own keys.
export const i18n = initServiceI18n({
  bundles: {
    en: catalogs.en ?? {},
    de: catalogs.de ?? {},
    fr: catalogs.fr ?? {},
  },
  // Vite requires the glob pattern to be a literal at the call site.
  regional: import.meta.glob<Bundle>('../../messages/*-*.yml', {
    eager: true,
    import: 'default',
  }),
  global: globalMessages,
  packages: [uiMessages],
});
