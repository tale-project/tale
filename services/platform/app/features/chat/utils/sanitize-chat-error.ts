type ErrorCategory =
  | 'creditExhausted'
  | 'tokenLimit'
  | 'rateLimited'
  | 'contentFilter'
  | 'contextLength'
  | 'toolFailure'
  | 'generic';

interface SanitizedError {
  category: ErrorCategory;
  i18nKey: string;
  rawMessage?: string;
}

const ERROR_PATTERNS: { pattern: RegExp; category: ErrorCategory }[] = [
  {
    pattern:
      /more credits|can only afford|credit.*insufficient|credit.*limit|credit.*reached|\b402\b/i,
    category: 'creditExhausted',
  },
  {
    pattern: /fewer max_tokens|token.*limit|max_tokens/i,
    category: 'tokenLimit',
  },
  {
    pattern: /context.?length|context.?window|maximum context/i,
    category: 'contextLength',
  },
  {
    pattern: /rate.?limit|too many requests|429/i,
    category: 'rateLimited',
  },
  {
    pattern: /content.?filter|content.?policy|moderation/i,
    category: 'contentFilter',
  },
  {
    pattern: /tool.*error|tool.*fail|unable to complete/i,
    category: 'toolFailure',
  },
];

const CATEGORY_I18N_KEY: Record<ErrorCategory, string> = {
  creditExhausted: 'errorHintCreditExhausted',
  tokenLimit: 'errorHintTokenLimit',
  rateLimited: 'errorHintRateLimited',
  contentFilter: 'errorHintContentFilter',
  contextLength: 'errorHintContextLength',
  toolFailure: 'errorHintToolFailure',
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
      return {
        category,
        i18nKey: CATEGORY_I18N_KEY[category],
        rawMessage: rawError,
      };
    }
  }

  return {
    category: 'generic',
    i18nKey: CATEGORY_I18N_KEY.generic,
    rawMessage: rawError,
  };
}
