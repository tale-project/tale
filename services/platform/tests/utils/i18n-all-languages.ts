import { loadLocale } from '@tale/ui/i18n/load-locale';

import { i18n } from '../../lib/i18n/i18n';

// The app fetches German and French on first use (`lazyBundles` in
// `lib/i18n/i18n.ts`). A test that reads them directly, through
// `i18n.changeLanguage('de')` or `i18n.getFixedT('fr')`, imports the
// instance from here, with every catalog in the store.
await Promise.all(['de', 'fr'].map((locale) => loadLocale(i18n, locale)));

export { i18n };
