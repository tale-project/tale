/**
 * i18n tests for a newly-generated service. One call into the centralized
 * framework registers every applicable check.
 *
 * Parity, usage and the ICU checks run in `enforce` mode (an empty bundle is
 * trivially green since `usage` only checks keys defined in `en.yml`, and
 * the ICU checks compare each translation with it). Every other check
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
    // An ICU argument a translation renames, drops or adds, and a count
    // worded without its language's plural forms, de-CH overrides
    // included (#4435).
    'icu-placeholder-parity': 'enforce',
    'icu-plural-rules': 'enforce',
    'status-chatter': 'report',
    'prose-exclamation': 'report',
  },
});
