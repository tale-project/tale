export interface PiiPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

/**
 * Built-in PII detection patterns covering common personal data types.
 */
export const BUILT_IN_PII_PATTERNS: PiiPattern[] = [
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL]',
  },
  {
    name: 'phone',
    regex: /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    replacement: '[PHONE]',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN]',
  },
  {
    name: 'creditCard',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: '[CREDIT_CARD]',
  },
  {
    // Context-anchored: bare 3-4 digit numbers are intentionally NOT detected
    // (would false-positive on ages, room numbers, error codes). Microsoft
    // Presidio, AWS Comprehend, and Cloudflare WAF all skip CVV detection
    // for the same reason. This catches the labeled cases only.
    name: 'cvc',
    regex:
      /\b(?:cvc|cvv|cv2|card[\s-]?security[\s-]?code)\b(?:\s+is)?\s*[:=]?\s*\d{3,4}\b/gi,
    replacement: '[CVC]',
  },
  {
    name: 'ipAddress',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[IP_ADDRESS]',
  },
  {
    name: 'dateOfBirth',
    regex: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/g,
    replacement: '[DATE_OF_BIRTH]',
  },
  {
    name: 'address',
    regex:
      /\b\d{1,5}\s+[\w\s]{1,30}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)\b/gi,
    replacement: '[ADDRESS]',
  },
  {
    name: 'iban',
    regex:
      /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}[\s-]?(?:[\dA-Z]{4}[\s-]?){2,7}[\dA-Z]{1,4}\b/g,
    replacement: '[IBAN]',
  },
  {
    name: 'germanId',
    regex: /\b[CFGHJKLMNPRTVWXYZ][CFGHJKLMNPRTVWXYZ\d]{8}\b/g,
    replacement: '[GERMAN_ID]',
  },
];

/**
 * Return only the built-in patterns whose names appear in the enabled list.
 */
export function getEnabledPatterns(enabledNames: string[]): PiiPattern[] {
  const nameSet = new Set(enabledNames);
  return BUILT_IN_PII_PATTERNS.filter((p) => nameSet.has(p.name));
}
