/**
 * Map a thrown error from a per-org data-residency action (knowledge DB,
 * embedding model, object storage, blob backfill) into an admin-facing
 * message. Duck-types `BackendError.data` because Vite chunk splitting can
 * produce multiple `BackendError` class copies that break `instanceof` — same
 * rationale as `deployment-errors.ts`, which this sits beside (the code set
 * differs: these actions gate on org membership and validate a single
 * connection, not the deployment file).
 */

import {
  pickString,
  readBackendErrorData,
} from '../governance/backend-error-data';

type Translator = (key: string, options?: Record<string, unknown>) => string;

/** Duck-typed `BackendError.data.code` of an org data-residency failure. */
export function orgResidencyErrorCode(err: unknown): string | undefined {
  return pickString(readBackendErrorData(err), 'code');
}

/** Admin-facing message for an org data-residency action failure. */
export function mapOrgResidencyError(err: unknown, t: Translator): string {
  const data = readBackendErrorData(err);
  const code = pickString(data, 'code');
  const serverMessage = pickString(data, 'message');
  const fallback =
    serverMessage ?? (err instanceof Error ? err.message : String(err));

  switch (code) {
    case 'UNAUTHENTICATED':
    case 'ORG_ID_REQUIRED':
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
    case 'INVALID_EMBEDDING':
      // Like INVALID_CONNECTION: the server message carries the Zod issues.
      return serverMessage ?? t('dataResidency.orgEmbedding.errors.invalid');
    case 'CREDENTIAL_NOT_FOUND':
      return t('dataResidency.orgEmbedding.errors.credentialNotFound');
    case 'CREDENTIAL_PROVIDER_MISMATCH':
      return t('dataResidency.orgEmbedding.errors.credentialMismatch');
    case 'CREDENTIAL_DISABLED':
      return t('dataResidency.orgEmbedding.errors.credentialDisabled');
    case 'NOT_CONFIGURED':
      return t('dataResidency.orgStorage.backfill.errors.notConfigured');
    case 'BACKFILL_ALREADY_RUNNING':
      return t('dataResidency.orgStorage.backfill.errors.alreadyRunning');
    default:
      return fallback;
  }
}
