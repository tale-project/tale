/**
 * Project-secret name rule, enforced at the Convex write boundary
 * (`convex/projects/secrets/actions.ts`).
 *
 * A secret name is an environment-variable key an agent resolves: it must start
 * with an uppercase letter and contain only `A–Z`, `0–9` and underscores, up to
 * 64 characters total.
 */
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
