/**
 * Labels for the PII modes, as the panel's Mode row names them.
 *
 * The Guardrails overview's PII card names the configured mode with the same
 * label, so the mapping lives outside the panel: the overview imports it
 * without pulling the lazily loaded panel chunk into its own.
 */

import type { PiiConfig } from '@tale/shared/schemas/pii';
import type { TFunction } from 'i18next';

/**
 * The label of a PII mode. The caller passes the i18next `t` function bound
 * to the `piiConfigPanel` namespace (`useT('piiConfigPanel')`).
 */
export function piiModeLabel(
  mode: PiiConfig['mode'],
  tPiiConfigPanel: TFunction,
): string {
  if (mode === 'tokenize') return tPiiConfigPanel('modeTokenize');
  if (mode === 'mask') return tPiiConfigPanel('modeMask');
  return tPiiConfigPanel('modeBlock');
}
