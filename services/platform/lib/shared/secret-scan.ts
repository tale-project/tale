/**
 * Credentials where none belongs, found by one detector with two tiers.
 *
 * The refusal tier (`credentialKind`, `findSecrets`) is what a document or
 * a request is refused for: the automation engine's `SECRET_IN_DOCUMENT`
 * and its checks of what an HTTP step sends. It is deliberately
 * conservative — well-known token shapes, bearer headers, opaque values
 * under credential-named keys — so ordinary prose and templated text never
 * fail a save.
 *
 * The withhold tier (`looksLikeCredential`, `secretMemberName` and the one
 * walker `withholdSecrets`) is what a reader is never shown: the run
 * recorder keeps nothing of it, and the MCP settings tools mask it in what
 * they answer and refuse it in what they take (`SECRET_ARGUMENT_REFUSED`).
 * What is kept is shown to people, so a value that only might be a
 * credential is better left out than shown.
 *
 * Pure and runtime-neutral (the engine's purity guard scans it): no I/O, no
 * host APIs. A hit names the KIND of credential and where it sits, never
 * the value.
 */

import { isRecord } from '../utils/type-utils';
import { isSensitiveKey } from './audit-redaction';

/** Shapes that are a credential wherever they appear, with the label a
 * refusal names. */
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

/** One credential found in a value: where it sits, as a dotted path
 * (`nodes[2].config.apiKey`, `''` for the value itself) and as an RFC 6901
 * pointer, and what kind of credential it looks like. */
export interface SecretHit {
  readonly path: string;
  readonly pointer: string;
  readonly label: string;
}

/** Escape one RFC 6901 reference token. */
function token(part: string | number): string {
  return `/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/**
 * The kind of credential `value` holds, such as `GitHub token`, or
 * `undefined` when it holds none: one of the known shapes, or an opaque word
 * under a key that names a credential. `key` is the member name the string
 * sits under, when it sits under one. The label names the kind, never the
 * value.
 */
export function credentialKind(
  value: string,
  key?: string,
): string | undefined {
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(value)) return label;
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

/**
 * Every credential-looking string in a JSON value, in document order: each
 * string is checked against the known shapes, and an opaque word also by
 * the name of the member it sits under. A string holds at most one hit.
 */
export function findSecrets(value: unknown): SecretHit[] {
  const hits: SecretHit[] = [];
  const walk = (
    current: unknown,
    path: string,
    pointer: string,
    key?: string,
  ): void => {
    if (typeof current === 'string') {
      const label = credentialKind(current, key);
      if (label !== undefined) hits.push({ path, pointer, label });
    } else if (Array.isArray(current)) {
      for (const [index, item] of current.entries()) {
        walk(item, `${path}[${index}]`, pointer + token(index));
      }
    } else if (isRecord(current)) {
      for (const [name, item] of Object.entries(current)) {
        walk(
          item,
          path === '' ? name : `${path}.${name}`,
          pointer + token(name),
          name,
        );
      }
    }
  };
  walk(value, '', '');
  return hits;
}

// ------------------------------------------------------------ withholding

/**
 * Shapes a reader is never shown, beyond the ones the refusal tier knows,
 * with the label a refusal names. Every one is linear in the text it reads
 * — they run on whatever a run receives, a webhook body included: a JSON
 * web token is only looked for where a run of token characters starts (not
 * at every `eyJ` inside one, which scanned a long run once per start), and
 * a URL scheme is at most 32 characters.
 */
const WITHHELD_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/, 'payment key'],
  [/\bgh[opsur]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, 'GitLab token'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    'web token (JWT)',
  ],
  [
    /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^/\s:@]+:[^/\s@]+@/i,
    'password in an address',
  ],
  [
    /[?&](?:api[_-]?key|access[_-]?token|token|secret|password|sig|signature)=[^&\s]{8,}/i,
    'key in an address',
  ],
];

/**
 * The kind of credential a reader is never shown in `value`, or
 * `undefined`: what the refusal tier finds (`credentialKind`), and more
 * shapes besides — live payment keys, more GitHub token kinds, GitLab and
 * Google API keys, JSON web tokens, a password in an address or a key in
 * its query.
 */
export function withheldCredentialKind(
  value: string,
  key?: string,
): string | undefined {
  const refused = credentialKind(value, key);
  if (refused !== undefined) return refused;
  for (const [pattern, label] of WITHHELD_PATTERNS) {
    if (pattern.test(value)) return label;
  }
  return undefined;
}

/** Whether a reader is never shown `value` (see `withheldCredentialKind`). */
export function looksLikeCredential(value: string, key?: string): boolean {
  return withheldCredentialKind(value, key) !== undefined;
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

/** Name parts that mark a secret whatever its form — `subscriptionkey` the
 * header Azure services read a key from (`Ocp-Apim-Subscription-Key`). */
const SECRET_NAME_PARTS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'privatekey',
  'credential',
  'totp',
  'backupcode',
  'subscriptionkey',
];

/** Names that read like a count or a setting of tokens rather than one. */
const TOKEN_COUNT_NAME_RE =
  /tokens$|tokenizer|tokencount|tokensdetails|tokenusage|tokenlimit|tokentype|tokensused|tokensleft|tokensremaining/;

const EXACT_TOKEN_NAMES = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'oauthtoken',
  'authtoken',
  'bearertoken',
]);

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
  return EXACT_TOKEN_NAMES.has(plain) ? 'strong' : 'weak';
}

/**
 * A text made only of template references — `{{secret}}`, optionally after
 * an auth scheme such as `Bearer` — names a secret Tale fills in when it
 * sends a request; it is not one.
 */
const SECRET_REFERENCE_RE =
  /^\s*(?:[A-Za-z][A-Za-z-]{1,15}\s+)?(?:\{\{[^{}]*\}\}\s*)+$/;

/** Whether the member `name` holding `item` is withheld whole. */
function withholdsMember(name: string, item: unknown): boolean {
  if (item === null || item === undefined || typeof item === 'boolean') {
    return false;
  }
  if (typeof item === 'string' && SECRET_REFERENCE_RE.test(item)) return false;
  const kind = secretMemberName(name);
  if (kind === 'strong') return true;
  return kind === 'weak' && typeof item === 'string';
}

/** Plain JSON, as a withheld copy is built. */
export type PlainJson =
  | null
  | boolean
  | number
  | string
  | PlainJson[]
  | { [key: string]: PlainJson };

/** Why a place is withheld: its text looks like a credential (`pattern`),
 * the name of the member holding it marks a secret (`key`), or a member of
 * the object there is named like a credential, or longer than any reader
 * needs, and is left out (`name`). */
export type WithheldReason = 'pattern' | 'key' | 'name';

/** One place `withholdSecrets` withholds: an RFC 6901 pointer (for `name`,
 * the object the member was left out of), why, and the kind of secret it
 * looks like — never the value. */
export interface WithheldPlace {
  readonly pointer: string;
  readonly why: WithheldReason;
  readonly label: string;
}

/** What a walk is told about the value it reads. */
export interface WithholdOptions {
  /** Member names whose meaning a schema declares — a setting's own
   * fields, such as a provider's `auth` methods or the `credentialId` an
   * embedding model resolves: their values are judged by their text alone,
   * never by their names. A map's keys (a header's name) are no schema's,
   * and are judged by name. */
  readonly declaredNames?: ReadonlySet<string>;
}

/** Member names longer than this are left out: no reader needs the name
 * whole, and it would ride along in every pointer below it. */
const MAX_MEMBER_NAME = 256;

/** Set `key` on `target` as its own member, `__proto__` included. */
function setOwn(
  target: { [key: string]: PlainJson },
  key: string,
  value: PlainJson,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * `value` as plain JSON with every secret withheld, each place it withholds
 * passed to `onWithheld` in document order:
 *  - a member whose name marks a secret outright (`password`, `apiKey`,
 *    `pin`, …) holds `null` unless it held a flag, nothing, or a text that
 *    only names a secret Tale fills in (`Bearer {{secret}}`) — a numeric
 *    PIN is a secret too;
 *  - a member whose name only mentions a token (`nextPageToken`) holds
 *    `null` when it held text, and is read member by member otherwise
 *    (`prompt_tokens_details`); a count such as `inputTokens` stays;
 *  - text that looks like a credential is `null`, wherever it sits;
 *  - a member whose name looks like a credential, or is longer than any
 *    reader needs, is left out.
 * Anything that is not JSON reads as `null`.
 */
export function withholdSecrets(
  value: unknown,
  onWithheld: (place: WithheldPlace) => void,
  options: WithholdOptions = {},
): PlainJson {
  const path: string[] = [];
  const here = (): string => path.join('');
  const judged = (name: string | undefined): string | undefined =>
    name === undefined || options.declaredNames?.has(name) === true
      ? undefined
      : name;
  const walk = (entry: unknown, key?: string): PlainJson => {
    if (typeof entry === 'string') {
      const label = withheldCredentialKind(entry, judged(key));
      if (label === undefined) return entry;
      onWithheld({ pointer: here(), why: 'pattern', label });
      return null;
    }
    if (
      entry === null ||
      typeof entry === 'boolean' ||
      typeof entry === 'number'
    ) {
      return entry;
    }
    if (Array.isArray(entry)) {
      return entry.map((item, index) => {
        path.push(token(index));
        const out = walk(item);
        path.pop();
        return out;
      });
    }
    if (!isRecord(entry)) return null;
    const out: { [key: string]: PlainJson } = {};
    let leftOut = false;
    for (const [member, item] of Object.entries(entry)) {
      if (member.length > MAX_MEMBER_NAME || looksLikeCredential(member)) {
        leftOut = true;
        continue;
      }
      path.push(token(member));
      const name = judged(member);
      if (name !== undefined && withholdsMember(name, item)) {
        onWithheld({
          pointer: here(),
          why: 'key',
          label: `a secret under "${member}"`,
        });
        setOwn(out, member, null);
      } else {
        setOwn(out, member, walk(item, member));
      }
      path.pop();
    }
    if (leftOut) {
      onWithheld({
        pointer: here(),
        why: 'name',
        label: 'a member named like a credential',
      });
    }
    return out;
  };
  return walk(value);
}

/** Every place `withholdSecrets` withholds in `value`, in document order. */
export function findWithheld(
  value: unknown,
  options: WithholdOptions = {},
): WithheldPlace[] {
  const places: WithheldPlace[] = [];
  withholdSecrets(value, (place) => places.push(place), options);
  return places;
}
