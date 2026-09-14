/**
 * i18n tests for `services/web/messages/*.json`. See
 * `services/platform/lib/i18n/messages.test.ts` for design rationale.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
  allowlistDisplayPath: 'services/web/lib/i18n/keys-dynamic.yml',
  // The design-system catalogs the site merges at runtime
  // (`initServiceI18n({ packages })`): the app language's shared vocabulary
  // and the marketing language's own strings (the demo-window chrome).
  packageCatalogs: [
    path.resolve(HERE, '../../../../packages/ui/src/i18n/messages'),
    path.resolve(HERE, '../../../../packages/marketing-ui/src/i18n/messages'),
  ],
  modes: {
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
