// Pure constants + validators for user-level sandbox env/secrets. Shared by the
// V8 mutations/queries, the Node upsert action, and unit tests. No Convex or
// Node imports so it stays trivially unit-testable.

/** Env var name: letters/digits/underscore, not starting with a digit. */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_ENV_KEY_LEN = 128;
/** Generous ceiling — OAuth tokens / PEM-ish secrets can be long. */
export const MAX_ENV_VALUE_LEN = 8192;
/** Per-user guardrail on the number of env/secret entries. */
export const MAX_ENV_VARS_PER_USER = 100;

export type Validation = { ok: true } | { ok: false; reason: string };

export function validateEnvKey(key: string): Validation {
  if (key.length === 0) return { ok: false, reason: 'Key must not be empty.' };
  if (key.length > MAX_ENV_KEY_LEN) {
    return { ok: false, reason: `Key exceeds ${MAX_ENV_KEY_LEN} characters.` };
  }
  if (!ENV_KEY_RE.test(key)) {
    return {
      ok: false,
      reason:
        'Key must match ^[A-Za-z_][A-Za-z0-9_]*$ (letters, digits, underscore; not starting with a digit).',
    };
  }
  return { ok: true };
}

export function validateEnvValue(value: string): Validation {
  if (value.length > MAX_ENV_VALUE_LEN) {
    return {
      ok: false,
      reason: `Value exceeds ${MAX_ENV_VALUE_LEN} characters.`,
    };
  }
  return { ok: true };
}

/** Fixed mask shown for secrets in the read API (plaintext is never exposed). */
export const SECRET_MASK = '••••••••';
