/**
 * i18n tests for `services/docs/messages/*.yml`. See
 * `services/platform/lib/i18n/messages.test.ts` for design rationale.
 *
 * `packageCatalogs` names the catalog this service merges at runtime
 * (`initServiceI18n({ packages })`): the shared docs frame owns its copy in
 * `@tale/ui`, so a `docs.*` key referenced here counts as defined there
 * without being duplicated.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
  packageCatalogs: [
    path.resolve(HERE, '../../../../packages/ui/src/i18n/messages'),
    path.resolve(HERE, '../../../../packages/marketing-ui/src/i18n/messages'),
  ],
  modes: {
    'usage-missing': 'enforce',
    'pronouns-formal': 'report',
    'terminology-loanword': 'report',
    'terminology-half-compound': 'report',
    'terminology-ui-label': 'report',
    'voice-strikes': 'report',
    'voice-drift': 'report',
    'grammar-articles': 'report',
    'style-ss': 'report',
    // An ICU argument a translation renames, drops or adds, and a count
    // worded without its language's plural forms, de-CH overrides
    // included (#4435).
    'icu-placeholder-parity': 'enforce',
    'icu-plural-rules': 'enforce',
    'status-chatter': 'report',
    'prose-exclamation': 'report',
  },
});
