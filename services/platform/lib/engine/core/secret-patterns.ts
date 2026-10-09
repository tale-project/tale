/**
 * What a credential looks like, in one place: the document check refuses a
 * document that carries one (`validate/document.ts`), and the run recorder
 * withholds one from what it stores of a step's values (`record/value.ts`).
 *
 * The document check is deliberately conservative — well-known token
 * shapes, bearer headers, and opaque values under credential-named keys —
 * so ordinary prose and templated text never fail a save. The recorder
 * withholds more: what it keeps is shown to people, so a value that only
 * might be a credential is better left out than shown.
 */

import { isSensitiveKey } from '../../shared/audit-redaction';

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

/** Shapes the recorder withholds beyond the document check's. */
const RECORDED_SECRET_PATTERNS: readonly RegExp[] = [
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bgh[opsur]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /[?&](?:api[_-]?key|access[_-]?token|token|secret|password|sig|signature)=[^&\s]{8,}/i,
];

/**
 * Whether the recorder withholds `value` as a credential: what the document
 * check refuses, and more shapes besides (live payment keys, more GitHub
 * token kinds, Google API keys, JSON web tokens, a password in a URL or a
 * key in its query).
 */
export function looksLikeCredential(value: string, key?: string): boolean {
  return (
    credentialKind(value, key) !== undefined ||
    RECORDED_SECRET_PATTERNS.some((re) => re.test(value))
  );
}

/** Member names that hold a secret whatever its form, beyond the audit
 * list's (compared lowercased, without `-`, `_`, `.` or spaces). */
const SECRET_NAMES = new Set([
  'passwd',
  'pwd',
  'pass',
  'passphrase',
  'cookie',
  'setcookie',
  'xapikey',
  'proxyauthorization',
  'privatekey',
  'idtoken',
  'otp',
  'pin',
  'cvv',
  'cvc',
  'sid',
  'sessionid',
]);

/** Name parts that mark a secret whatever its form. */
const SECRET_NAME_PARTS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'privatekey',
  'credential',
  'totp',
  'backupcode',
];

/** Names that read like a count or a setting of tokens rather than one. */
const TOKEN_COUNT_NAME_RE =
  /tokens$|tokenizer|tokencount|tokensdetails|tokenusage|tokenlimit|tokentype|tokensused|tokensleft|tokensremaining/;

/**
 * How a member named `name` holds a secret: `strong` — any value but a flag
 * or nothing is withheld (a password, an API key, a PIN even when it is a
 * number); `weak` — only text is withheld and anything else is read member
 * by member (`nextPageToken` is withheld, `prompt_tokens_details` is read);
 * `undefined` — the name says nothing (`inputTokens`, `maxTokens`).
 */
export function secretMemberName(name: string): 'strong' | 'weak' | undefined {
  const plain = name.toLowerCase().replaceAll(/[-_.\s]/g, '');
  if (SECRET_NAMES.has(plain)) return 'strong';
  if (SECRET_NAME_PARTS.some((part) => plain.includes(part))) return 'strong';
  if (!isSensitiveKey(plain)) return undefined;
  if (!plain.includes('token')) return 'strong';
  if (TOKEN_COUNT_NAME_RE.test(plain)) return undefined;
  // `token`, `accesstoken`, `sessiontoken`: the audit list names these
  // exactly, and they hold a secret whatever its form.
  return isSensitiveKeyExactly(plain) ? 'strong' : 'weak';
}

const EXACT_TOKEN_NAMES = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'oauthtoken',
  'authtoken',
  'bearertoken',
]);

function isSensitiveKeyExactly(plain: string): boolean {
  return EXACT_TOKEN_NAMES.has(plain);
}
