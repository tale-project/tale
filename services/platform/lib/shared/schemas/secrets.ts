/**
 * Project-secret name rules, shared between the Convex write boundary
 * (`convex/projects/secrets/actions.ts`) and the client form
 * (`app/features/projects/components/project-secrets-tab.tsx`) so the UI can
 * reject an invalid name inline before submit instead of round-tripping to a
 * generic error toast.
 *
 * A secret name is an environment-variable key an agent resolves: it must start
 * with an uppercase letter and contain only `A–Z`, `0–9` and underscores, up to
 * `SECRET_NAME_MAX` characters total.
 */
export const SECRET_NAME_MAX = 64;
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
