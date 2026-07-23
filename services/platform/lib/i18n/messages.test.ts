/**
 * i18n tests for `services/platform/messages/*.json`.
 *
 * One call into the centralized framework registers every applicable check.
 * `parity` and `usage` run in `enforce` mode (they have always been clean);
 * the other checks default to `report` mode for the rollout window — the
 * end-of-run summary surfaces findings without failing the build (e.g. the
 * verified 35 `Wird ...` passive-present strings in de.json). Flip a check
 * to `enforce` in this file once the corresponding cleanup PR has landed.
 *
 * Doctrine: `.agents/translation/AGENTS.md` and the per-locale files under
 * `.agents/translation/locales/`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineI18nTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
  allowlistDisplayPath: 'services/platform/lib/i18n/keys-dynamic.yml',
  modes: {
    // Referenced-but-missing keys (raw-key rendering, the #2414 bug class).
    // Report during rollout: the known dangling refs are fixed, but flip to
    // `enforce` only once the in-flight settings/agents rework lands (its
    // half-edited states would otherwise fail unrelated PRs).
    'usage-missing': 'report',
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
