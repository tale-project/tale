/**
 * i18n gates for the design-system docs. One call into the centralized
 * framework registers every applicable check.
 *
 * `packageCatalogs` names the two catalogs this service merges at runtime
 * (`initServiceI18n({ packages })`), so a `@tale/ui` or `@tale/marketing-ui`
 * key referenced from here counts as defined without being duplicated.
 *
 * Doctrine: `.agents/skills/write-translations/SKILL.md`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
  allowlistDisplayPath: 'services/ui-docs/lib/i18n/keys-dynamic.yml',
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
    'icu-placeholder-parity': 'report',
    'icu-plural-rules': 'report',
    'status-chatter': 'report',
    'prose-exclamation': 'report',
  },
});
