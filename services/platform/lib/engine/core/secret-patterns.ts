/**
 * What a credential looks like, in one place: the document check refuses a
 * document that carries one (`validate/document.ts`), and the run recorder
 * withholds one from what it stores of a step's values (`record/value.ts`).
 *
 * Deliberately conservative: well-known token shapes, bearer headers, and
 * opaque values under credential-named keys. Ordinary prose never matches.
 */

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'API key (sk-…)'],
  [/\bAKIA[0-9A-Z]{12,}/, 'AWS access key'],
  [/\bxox[bap]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key material'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/, 'bearer token'],
];

/** Key names that mark their value as a credential when it looks opaque. */
const CREDENTIAL_KEY_RE =
  /^(?:api[_-]?key|apikey|secret|token|access[_-]?key|password|passwd|authorization|auth[_-]?token)$/i;

/** A long single opaque word — no spaces, no template braces. */
const OPAQUE_VALUE_RE = /^[A-Za-z0-9+/=_.-]{16,}$/;

/**
 * The kind of credential `value` holds, such as `GitHub token`, or
 * `undefined` when it holds none. `key` is the member name the string sits
 * under, when it sits under one. The label names the kind, never the value.
 */
export function credentialKind(
  value: string,
  key?: string,
): string | undefined {
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(value)) return label;
  }
  if (
    key !== undefined &&
    CREDENTIAL_KEY_RE.test(key) &&
    OPAQUE_VALUE_RE.test(value)
  ) {
    return `credential-looking value under "${key}"`;
  }
  return undefined;
}
