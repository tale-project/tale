/**
 * Message-key mapping for PII pattern type labels.
 *
 * Every pattern name the detector emits maps to an i18n key under the
 * `piiTypes` namespace owned by this package (`packages/ui/src/messages/
 * <locale>.json`). Variants:
 *
 *   - Universal patterns (`email`, `phone`, …) get one key each.
 *   - National-ID specs use their stable spec id (`uk-nino`,
 *     `de-personalausweis`) — the message-bundle author adds those
 *     translations as new countries' IDs ship.
 *   - Unknown pattern names route to `piiTypes._unknown` so a future
 *     built-in still has *some* label before its translation lands.
 */

import type { TFunction } from 'i18next';

/**
 * Resolve a label for a pattern name via the package's i18n bundle. The
 * caller passes the i18next `t` function bound to the `piiTypes`
 * namespace (typically obtained via `useT('piiTypes')` inside a
 * component). When the bundle is missing a specific spec id, i18next
 * returns the input key — we treat that as a miss and fall back to
 * `_unknown` so the UI never shows a raw pattern name to the user.
 */
export function piiTypeLabel(patternName: string, t: TFunction): string {
  const value = t(patternName);
  if (typeof value === 'string' && value !== patternName) return value;
  return t('_unknown');
}
