import { classifyRefusal } from './classify-refusal';
import { sanitizeChatError } from './sanitize-chat-error';

export type ChatT = (
  key: string,
  params?: Record<string, string | number | undefined>,
) => string;

export interface TurnToastContent {
  readonly titleKey: string;
  readonly description?: string;
}

/**
 * Localized toast description for a failed turn. Provider and model errors
 * get the same hint as {@link ChatErrorDisplay}; only unclassified failures
 * may surface a cleaned one-line excerpt — never raw provider JSON.
 */
export function turnErrorToastDescription(
  reason: string | undefined,
  t: ChatT,
): string | undefined {
  if (reason === undefined || reason.length === 0) return undefined;
  const sanitized = sanitizeChatError(reason);
  if (sanitized.code !== 'generic') {
    return t(sanitized.i18nKey, sanitized.params);
  }
  return sanitized.rawSummary;
}

/** Toast copy for a refused send / arena turn — guardrail titles stay as-is,
 * a refusal classified with its own description (a reached budget cap, by
 * its `code`) gets that, and provider failures get a sanitized one. */
export function turnRefusalToastContent(
  reason: string | undefined,
  t: ChatT,
  code?: string,
): TurnToastContent {
  const keys = classifyRefusal(reason, code);
  const description =
    keys.descriptionKey !== undefined
      ? t(keys.descriptionKey)
      : keys.titleKey === 'toast.sendFailed'
        ? turnErrorToastDescription(reason, t)
        : undefined;
  return {
    titleKey: keys.titleKey,
    ...(description !== undefined ? { description } : {}),
  };
}

/** Toast copy for a named turn failure (regenerate, etc.). */
export function turnNamedFailureToastContent(
  reason: string | undefined,
  titleKey: string,
  t: ChatT,
): TurnToastContent {
  const description = turnErrorToastDescription(reason, t);
  return {
    titleKey,
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * Toast copy for a regenerate that produced no reply. A refused turn's reason
 * can be a provider's raw error, so it is sanitized like any named turn
 * failure; a request the door refused outright — `persisted` absent, whether
 * the turn landed unknown — carries the platform's own words (its sentence,
 * else its code), shown as they are: a provider-error reading would misname
 * them (`RBAC_FORBIDDEN` is no provider's rejected key).
 */
export function regenerateFailureToastContent(
  outcome: { readonly reason?: string; readonly persisted?: boolean },
  t: ChatT,
): TurnToastContent {
  if (outcome.persisted === undefined) {
    return {
      titleKey: 'regenerateFailed',
      ...(outcome.reason !== undefined ? { description: outcome.reason } : {}),
    };
  }
  return turnNamedFailureToastContent(outcome.reason, 'regenerateFailed', t);
}
