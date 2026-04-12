type ErrorCategory =
  | 'creditExhausted'
  | 'authError'
  | 'modelNotFound'
  | 'tokenLimit'
  | 'rateLimited'
  | 'contentFilter'
  | 'contextLength'
  | 'toolFailure'
  | 'providerError'
  | 'generic';

interface SanitizedError {
  category: ErrorCategory;
  i18nKey: string;
  rawMessage?: string;
}

const ERROR_PATTERNS: { pattern: RegExp; category: ErrorCategory }[] = [
  {
    pattern:
      /more credits|can only afford|credit.*insufficient|insufficient.*credit|never purchased credits|credit.*limit|credit.*reached|\b402\b/i,
    category: 'creditExhausted',
  },
  {
    pattern:
      /\b401\b|\b403\b|invalid.*key|expired.*key|api.?key.*invalid|unauthorized|forbidden|authentication.*fail|user not found|missing.*authentication/i,
    category: 'authError',
  },
  {
    pattern: /model.*not found|model.*not available|invalid model|\b404\b/i,
    category: 'modelNotFound',
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
  {
    pattern:
      /\b5\d{2}\b|server error|overloaded|capacity|service.*unavailable|internal.*error/i,
    category: 'providerError',
  },
];

const CATEGORY_I18N_KEY: Record<ErrorCategory, string> = {
  creditExhausted: 'errorHintCreditExhausted',
  authError: 'errorHintAuthError',
  modelNotFound: 'errorHintModelNotFound',
  tokenLimit: 'errorHintTokenLimit',
  rateLimited: 'errorHintRateLimited',
  contentFilter: 'errorHintContentFilter',
  contextLength: 'errorHintContextLength',
  toolFailure: 'errorHintToolFailure',
  providerError: 'errorHintProviderError',
  generic: 'errorGeneratingDescription',
};

/**
 * Classify a raw error string from the AI provider into a user-friendly
 * i18n key. For known error types, only the i18n message is shown.
 * For unknown errors, the raw message is preserved so users have context.
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
      };
    }
  }

  return {
    category: 'generic',
    i18nKey: CATEGORY_I18N_KEY.generic,
    rawMessage: rawError,
  };
}
