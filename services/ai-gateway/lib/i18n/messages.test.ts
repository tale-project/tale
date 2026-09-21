/**
 * i18n tests for a newly-generated service. One call into the centralized
 * framework registers every applicable check.
 *
 * Parity + usage run in `enforce` mode (an empty bundle is trivially green
 * since `usage` only checks keys defined in `en.yml`). Every other check
 * starts in `report` mode — the end-of-run summary surfaces findings without
 * failing the build. Flip a check to `enforce` once its findings are cleared.
 *
 * Doctrine: `.agents/translation/AGENTS.md`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
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
