/**
 * i18n tests for a shared library's messages. Parity and the ICU checks run
 * in `enforce`; `usage` is `off` because library messages have no
 * in-package source-walk surface (runtime consumers reference the keys).
 * Other checks start in `report` mode — flip to `enforce` per check as
 * content lands.
 *
 * Doctrine: `.agents/translation/AGENTS.md`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '..'),
  messagesDir: HERE,
  modes: {
    usage: 'off',
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
