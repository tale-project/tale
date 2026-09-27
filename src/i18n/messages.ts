// The `*.yml` module typing travels with this file so a consumer that installs
// the package from GitHub type-checks the catalog imports without declaring
// the module shape itself (its tsconfig never includes our `.d.ts`).
// oxlint-disable-next-line typescript/triple-slash-reference -- an ambient `declare module` file has no import form; a path reference is the only way to carry it into a consumer's program
/// <reference path="../yaml-modules.d.ts" />

import type { PackageMessages } from './init-service';
import deChMessages from './messages/de-CH.yml';
import deMessages from './messages/de.yml';
import enMessages from './messages/en.yml';
import frMessages from './messages/fr.yml';
import globalMessages from './messages/global.yml';

/**
 * Translation bundles shipped by `@tale/ui` — every string a component in
 * this package renders (form controls, data tables, dialogs, the search
 * palette, the language and theme switchers, …). A host service merges
 * them into its i18n instance via `initServiceI18n({ packages: [uiMessages] })`,
 * so a component can call `useT(...)` without the consuming app duplicating
 * the keys in its own `messages/*.yml`.
 *
 * Keys keep the namespaces the components use (`common.actions.*`,
 * `common.aria.*`, `search.*`, …); the service merge is a deep merge, so a
 * host that redeclares a key wins per key, not per namespace.
 *
 * Locale-neutral keys (entries that read the same in every language) live in
 * `global.yml` and fold into every base locale. `de-CH.yml` is a sparse
 * regional override (Swiss spelling) layered over `de`.
 */
export const uiMessages: PackageMessages = {
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
    'de-CH': deChMessages,
  },
  global: globalMessages,
};
