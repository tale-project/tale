/**
 * Map a turn refusal's server reason to the localized toast the 0.3 page
 * showed — a guardrail block, a budget stop, or a model-access denial each
 * get purpose-written copy instead of a generic "Send failed" carrying the
 * raw English sentence.
 *
 * The backend hands the frontend only a reason STRING (the turn outcome
 * carries no code), so classification matches on the known phrasings; an
 * unrecognized reason falls back to the generic title with the server text
 * as the description, exactly like the unclassified path before this map.
 */

/** i18n keys under the `chat` namespace; `descriptionKey` wins over the raw
 * server reason when set. */
export interface RefusalToastKeys {
  titleKey: string;
  descriptionKey?: string;
  /** Keep the server's own sentence as the description. */
  serverReason?: string;
}

export function classifyRefusal(reason: string | undefined): RefusalToastKeys {
  if (reason === undefined || reason.length === 0) {
    return { titleKey: 'toast.sendFailed' };
  }
  const lower = reason.toLowerCase();
  if (lower.includes('pii')) {
    return { titleKey: 'toast.piiBlocked', serverReason: reason };
  }
  if (
    lower.includes('chat filter') ||
    lower.includes('content policy') ||
    lower.includes('moderation') ||
    lower.includes('blocked')
  ) {
    return { titleKey: 'toast.policyViolation', serverReason: reason };
  }
  if (lower.includes('budget') || lower.includes('usage limit')) {
    return { titleKey: 'toast.budgetExceeded', serverReason: reason };
  }
  if (
    lower.includes('model access') ||
    lower.includes('not available for your account') ||
    lower.includes('access to the selected model')
  ) {
    return { titleKey: 'toast.modelAccessDenied', serverReason: reason };
  }
  if (lower.includes('does not exist')) {
    // A deleted/foreign thread: the not-found screen is the real surface;
    // the toast still names the cause instead of "Send failed".
    return { titleKey: 'notFound' };
  }
  return { titleKey: 'toast.sendFailed', serverReason: reason };
}
