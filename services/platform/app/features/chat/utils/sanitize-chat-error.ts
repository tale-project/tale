type ErrorCategory =
  | 'creditLimit'
  | 'rateLimited'
  | 'contentFilter'
  | 'generic';

interface SanitizedError {
  category: ErrorCategory;
  i18nKey: string;
}

const ERROR_PATTERNS: { pattern: RegExp; category: ErrorCategory }[] = [
  {
    pattern: /more credits|fewer max_tokens|can only afford|token.*limit/i,
    category: 'creditLimit',
  },
  {
    pattern: /rate.?limit|too many requests|429/i,
    category: 'rateLimited',
  },
  {
    pattern: /content.?filter|content.?policy|moderation/i,
    category: 'contentFilter',
  },
];

const CATEGORY_I18N_KEY: Record<ErrorCategory, string> = {
  creditLimit: 'errorHintCreditLimit',
  rateLimited: 'errorHintRateLimited',
  contentFilter: 'errorHintContentFilter',
  generic: 'errorGeneratingDescription',
};

/**
 * Classify a raw error string from the AI provider into a user-friendly
 * i18n key. Stack traces and internal paths are never surfaced.
 */
export function sanitizeChatError(
  rawError: string | undefined,
): SanitizedError {
  if (!rawError) {
    return { category: 'generic', i18nKey: CATEGORY_I18N_KEY.generic };
  }

  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(rawError)) {
      return { category, i18nKey: CATEGORY_I18N_KEY[category] };
    }
  }

  return { category: 'generic', i18nKey: CATEGORY_I18N_KEY.generic };
}
