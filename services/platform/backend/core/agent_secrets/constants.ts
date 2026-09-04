// Pure constants + validators for org agent secrets. Shared by the V8
// mutations/queries, the Node actions, and unit tests. No Convex or Node
// imports so it stays trivially unit-testable.

/** The name IS the env var name: letters/digits/underscore, not starting with
 * a digit. */
export const AGENT_SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_AGENT_SECRET_NAME_LEN = 128;
/** Generous ceiling — OAuth tokens / PEM-ish secrets can be long. */
export const MAX_AGENT_SECRET_VALUE_LEN = 8192;
export const MAX_AGENT_SECRET_DESCRIPTION_LEN = 300;
/** Per-org guardrail on the number of stored secrets. */
export const MAX_AGENT_SECRETS_PER_ORG = 200;

export type Validation = { ok: true } | { ok: false; reason: string };

export function validateAgentSecretName(name: string): Validation {
  if (name.length === 0) {
    return { ok: false, reason: 'Name must not be empty.' };
  }
  if (name.length > MAX_AGENT_SECRET_NAME_LEN) {
    return {
      ok: false,
      reason: `Name exceeds ${MAX_AGENT_SECRET_NAME_LEN} characters.`,
    };
  }
  if (!AGENT_SECRET_NAME_RE.test(name)) {
    return {
      ok: false,
      reason:
        'Name must match ^[A-Za-z_][A-Za-z0-9_]*$ (letters, digits, ' +
        'underscore; not starting with a digit) — it is used verbatim as the ' +
        'environment variable name.',
    };
  }
  return { ok: true };
}

export function validateAgentSecretValue(value: string): Validation {
  if (value.length === 0) {
    return { ok: false, reason: 'Secret value must not be empty.' };
  }
  if (value.length > MAX_AGENT_SECRET_VALUE_LEN) {
    return {
      ok: false,
      reason: `Value exceeds ${MAX_AGENT_SECRET_VALUE_LEN} characters.`,
    };
  }
  return { ok: true };
}

/**
 * A recognizable, low-leak preview of a secret for the manager UI: the first
 * and last few characters with a fixed-width masked middle (e.g. `ghp_••••b3f`)
 * — the same affordance the connector-credential UI uses. Reveals
 * a tiny edge slice; for a secret too short to reveal safely it returns
 * `undefined` (the caller shows a full mask), and the masked middle is a
 * constant width so the true length never leaks. Pure.
 */
export function maskAgentSecretPreview(plaintext: string): string | undefined {
  const FIRST = 4;
  const LAST = 3;
  if (plaintext.length < FIRST + LAST + 4) return undefined;
  return `${plaintext.slice(0, FIRST)}••••${plaintext.slice(-LAST)}`;
}

/**
 * True when the value contains whitespace AFTER trimming its ends — an
 * interior space, tab, or line break. Credentials never contain these; the
 * usual cause is a token that wrapped across terminal lines on paste (a
 * silent → 401). The editor warns; it does NOT block, since PEM keys carry
 * interior newlines legitimately.
 */
export function hasInteriorWhitespace(value: string): boolean {
  return /\s/.test(value.trim());
}
