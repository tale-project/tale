/**
 * Map a thrown error from `saveGovernancePolicy` into a localized,
 * user-facing message.
 *
 * On a backend rejection the Convex client re-throws a `BackendError` whose
 * `.message` is a dev-facing hybrid stacktrace (the `[CONVEX A(...)]` prefix
 * + the stringified `{code, message}` payload + "Called by client"). Because
 * `BackendError extends Error`, the old `error instanceof Error ? error.message`
 * guard always took the `.message` branch and surfaced that raw string to the
 * user. Instead we read the structured `BackendError.data.code` (duck-typed,
 * since Vite chunk-splitting can produce multiple `BackendError` class copies
 * that break `instanceof`) and translate it.
 *
 * Codes come from `convex/governance/file_actions.ts`: `validation`,
 * `use_special_action`, `ORG_FORBIDDEN`. Their backend `message` strings are
 * developer-facing English (and never localized), so we never surface them.
 * Unknown codes / non-Convex errors fall back to the editor's own
 * `*.saveFailed` string via `fallback`. Mirrors the legal-hold / DSAR error
 * mappers in this directory.
 */

import { pickString, readBackendErrorData } from './backend-error-data';

type Translator = (key: string, options?: Record<string, unknown>) => string;

export function mapGovernanceSaveError(
  err: unknown,
  t: Translator,
  fallback: string,
): string {
  const data = readBackendErrorData(err);
  const code = pickString(data, 'code');

  switch (code) {
    case 'ORG_FORBIDDEN':
      return t('errors.saveForbidden');
    default:
      return fallback;
  }
}
