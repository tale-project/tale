/**
 * Credentials pasted where none belongs: the one detector the automation
 * engine refuses a document with (`SECRET_IN_DOCUMENT`) and the MCP settings
 * tools refuse a change with (`SECRET_ARGUMENT_REFUSED`), so a key a person
 * or an agent pastes into a field is caught the same way on both doors. The
 * run recorder withholds what it finds too, and more shapes besides
 * (`lib/engine/core/secret-patterns.ts`).
 *
 * Pure and runtime-neutral (the engine's purity guard scans it): no I/O, no
 * host APIs. A hit names the KIND of credential and where it sits, never
 * the value.
 */

import { isRecord } from '../utils/type-utils';

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
