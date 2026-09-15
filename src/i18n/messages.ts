// The `*.yml` module typing travels with this file so a consumer that installs
// the package from GitHub type-checks the catalog imports without declaring
// the module shape itself (its tsconfig never includes our `.d.ts`).
// oxlint-disable-next-line typescript/triple-slash-reference -- an ambient `declare module` file has no import form; a path reference is the only way to carry it into a consumer's program
/// <reference path="../yaml-modules.d.ts" />

import type { PackageMessages } from '@tale/ui/i18n/init-service';

import deMessages from './messages/de.yml';
import enMessages from './messages/en.yml';
import frMessages from './messages/fr.yml';
import globalMessages from './messages/global.yml';

/**
 * Translation bundles shipped by `@tale/marketing-ui` — every string a
 * component in this package renders on its own (today: the product-window
 * chrome inside `DemoShell`). Site copy — nav labels, footer columns, demo
 * scenarios — is the host's and arrives through props. A host merges these
 * into its i18n instance via
 * `initServiceI18n({ packages: [uiMessages, marketingUiMessages] })`, so a
 * component can call `useT(...)` without the consuming site duplicating the
 * keys in its own `messages/*.yml`.
 *
 * Namespaces are package-scoped (`demo.*`) so they never collide with a
 * service's own; the merge is deep, so a host that redeclares a key wins per
 * key. Locale-neutral keys would live in `global.yml` and fold into every base
 * locale.
 */
export const marketingUiMessages: PackageMessages = {
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
  },
  global: globalMessages,
};
