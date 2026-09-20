/**
 * i18n tests for the package's own catalog (`src/i18n/messages/*.yml`).
 *
 * Every string a `@tale/ui` component renders lives here, so this catalog is
 * gated exactly like a service's: locale parity, no orphan keys, and no
 * `t('literal')` in `src/` that resolves to nothing (the raw-key bug class).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from './tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
  messagesDir: path.resolve(HERE, 'messages'),
  scanRoots: ['src'],
  allowlistPath: path.resolve(HERE, 'keys-dynamic.yml'),
  allowlistDisplayPath: 'packages/ui/src/i18n/keys-dynamic.yml',
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
