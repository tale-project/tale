/**
 * Labels for the directions content safety filters, as the editor's Apply to
 * row names them. The Guardrails overview's content-safety card lists the
 * configured directions with the same labels.
 */

import type { ChatFilterConfig } from '@tale/shared/schemas/governance';
import type { TFunction } from 'i18next';

/**
 * The label of a direction content safety filters. The caller passes the
 * i18next `t` function bound to the `governance` namespace.
 */
export function contentSafetyTargetLabel(
  target: ChatFilterConfig['appliesTo'][number],
  t: TFunction,
): string {
  return target === 'input'
    ? t('contentSafety.userInput')
    : t('contentSafety.modelOutput');
}
