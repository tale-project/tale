/**
 * Map a turn refusal to the localized toast the 0.3 page showed — a
 * guardrail block, a budget stop, or a model-access denial each get
 * purpose-written copy instead of a generic "Send failed" carrying the raw
 * English sentence.
 *
 * A refusal the server names with a stable code is classified by that code:
 * a reached budget cap answers `BUDGET_EXCEEDED` on every chat door. Any
 * other refusal carries only a reason string, so classification matches on
 * the known phrasings; an unrecognized reason falls back to the generic
 * title with the server text as the description, exactly like the
 * unclassified path before this map.
 */

/** Whether a refusal's code says a budget cap that binds the sender is
 * reached. */
export function isBudgetRefusalCode(code: string | undefined): boolean {
  return code === 'BUDGET_EXCEEDED';
}

/** i18n keys under the `chat` namespace; `descriptionKey` wins over the raw
 * server reason when set. */
export interface RefusalToastKeys {
  titleKey: string;
  descriptionKey?: string;
  /** Keep the server's own sentence as the description. */
  serverReason?: string;
}

export function classifyRefusal(
  reason: string | undefined,
  code?: string,
): RefusalToastKeys {
  // The cap's own copy says where to see it and that it resets — the
  // English sentence would only repeat that, untranslated.
  if (isBudgetRefusalCode(code)) {
    return {
      titleKey: 'toast.budgetExceeded',
      descriptionKey: 'errorHintBudgetExceeded',
    };
  }
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
