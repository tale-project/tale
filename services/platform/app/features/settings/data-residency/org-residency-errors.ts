/**
 * Map a thrown error from a per-org object-storage action into an admin-facing
 * message. Duck-types `ConvexError.data` because Vite chunk splitting can
 * produce multiple `ConvexError` class copies that break `instanceof` — same
 * rationale as `deployment-errors.ts`, which this sits beside (the code set
 * differs: these actions gate on org membership and validate a single
 * connection, not the deployment file).
 */

type Translator = (key: string, options?: Record<string, unknown>) => string;

function readConvexErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = (err as { data: unknown }).data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-checked above
  return data as Record<string, unknown>;
}

function pickString(data: unknown, key: string): string | undefined {
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-checked above
  const v = (data as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/** Admin-facing message for an org object-storage action failure. */
export function mapOrgResidencyError(err: unknown, t: Translator): string {
  const data = readConvexErrorData(err);
  const code = pickString(data, 'code');
  const serverMessage = pickString(data, 'message');
  const fallback =
    serverMessage ?? (err instanceof Error ? err.message : String(err));

  switch (code) {
    case 'UNAUTHENTICATED':
    case 'ORG_NOT_FOUND':
    case 'ORG_FORBIDDEN':
      return t('dataResidency.orgStorage.errors.forbidden');
    case 'INVALID_CONNECTION':
      // The server message carries the per-field Zod issues — more actionable
      // than a generic sentence, so surface it when present.
      return (
        serverMessage ?? t('dataResidency.orgStorage.errors.invalidConnection')
      );
    case 'INVALID_CREDENTIALS':
      return t('dataResidency.orgStorage.errors.credentialsPair');
    case 'CREDENTIALS_REQUIRED':
      return t('dataResidency.orgStorage.errors.credentialsRequired');
    default:
      return fallback;
  }
}
