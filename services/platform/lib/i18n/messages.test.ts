/**
 * i18n tests for the platform's catalogs (`services/platform/messages/<locale>/<topic>.yml`).
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
import { describe, expect, it } from 'vitest';

import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defineI18nTests({
  serviceRoot: path.resolve(HERE, '../..'),
  allowlistDisplayPath: 'services/platform/lib/i18n/keys-dynamic.yml',
  // The shared vocabulary (`common.actions.*`, `common.aria.*`, …) ships
  // with the design system; platform code may reference those keys without
  // redeclaring them here.
  packageCatalogs: [
    path.resolve(HERE, '../../../../packages/ui/src/i18n/messages'),
  ],
  modes: {
    // Referenced-but-missing keys (raw-key rendering, the #2414 bug class).
    // Enforced since the 2026-07-27 sweep restored the last dangling refs
    // (the `common.upload.*` subtree) — a `t('literal')` without a catalog
    // key now fails the suite instead of shipping a raw key.
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

// #4441: runtime selectors, provider status and metrics name the same concept.
// Inspect values only: `harness` keys and ICU arguments remain API contracts.
describe('agent runtime terminology', () => {
  for (const [locale, messages, label, plural] of [
    ['en', enMessages, 'Agent runtime', 'Agent runtimes'],
    ['de', deMessages, 'Agent-Laufzeit', 'Agent-Laufzeiten'],
    ['fr', frMessages, "Environnement d'agent", "Environnements d'agent"],
  ] as const) {
    it(`${locale}: uses one name across selectors, providers and analytics`, () => {
      expect(messages.projects.agents.harnessLabel).toBe(label);
      expect(messages.governance.standardAgent.harnessLabel).toBe(label);
      expect(messages.automations.editor.fields.harness).toBe(label);
      expect(messages.analytics.externalTurns.byHarness.harness).toBe(label);
      expect(messages.settings.providers.harnesses.title).toBe(plural);
      expect(messages.metrics.groups['external-turns']).toBe(
        messages.analytics.externalTurns.title,
      );
    });

    it(`${locale}: does not expose the old runtime synonyms in messages`, () => {
      const inspect = (value: unknown): void => {
        if (typeof value === 'string') {
          expect(value.replace(/\{[^{}]*\}/g, '')).not.toMatch(
            /\bharness(?:es)?\b|\bagent types?\b|\bAgenten?-?typ\b|\btype d['’]agent\b/i,
          );
        } else if (value !== null && typeof value === 'object') {
          for (const child of Object.values(value)) inspect(child);
        }
      };
      inspect(messages);
    });
  }
});
