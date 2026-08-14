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
 * provider failures get a sanitized description. */
export function turnRefusalToastContent(
  reason: string | undefined,
  t: ChatT,
): TurnToastContent {
  const keys = classifyRefusal(reason);
  const description =
    keys.titleKey === 'toast.sendFailed'
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
