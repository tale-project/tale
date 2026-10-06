import { catalogsByLocale } from '@tale/ui/i18n/topic-catalogs';

import type { Messages } from '../../lib/i18n/types';

/**
 * The platform's catalogs as one tree per locale, for tests that read the
 * text they expect (`enMessages.chat.send`). The app keeps them one file per
 * topic (`messages/<locale>/<topic>.yml`); typed as loosely as the YAML
 * imports themselves.
 */
const catalogs = catalogsByLocale(
  import.meta.glob<Record<string, unknown>>('../../messages/*/*.yml', {
    eager: true,
    import: 'default',
  }),
);

export const enMessages: Messages = catalogs.en ?? {};
export const deMessages: Messages = catalogs.de ?? {};
export const frMessages: Messages = catalogs.fr ?? {};
