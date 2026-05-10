/**
 * Map a thrown error from a data-subject-requests mutation into
 * operator-facing strings. Mirrors the legal-hold pattern (duck-type
 * `ConvexError.data` because Vite chunk-splitting can produce multiple
 * `ConvexError` class copies that break `instanceof`).
 *
 * `LEGAL_HOLD_BLOCKS_ERASURE` does NOT toast — the file-request dialog
 * renders an inline panel showing the held thread / document ids so the
 * admin can route to /legal-hold and decide whether to release. The
 * `requestId` on the error payload points at the row that was inserted
 * before the hold gate, so the caller can hydrate the full block context
 * via `getErasureRequest`.
 */

type Translator = (key: string, options?: Record<string, unknown>) => string;

interface DsrErrorMapping {
  title: string;
  description: string;
  /** When set, render an inline LegalHoldBlockPanel instead of toasting.
   *  Carries the row id so the caller can hydrate the full block detail. */
  legalHoldBlock?: {
    requestId: string;
    orgHeld: boolean;
    userCustodianHeld: boolean;
  };
  /** Existing pending/running/blocked request that the admin can route
   *  to instead of starting a new one. */
  existingRequestId?: string;
}

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

function pickString(
  data: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!data) return undefined;
  const v = data[key];
  return typeof v === 'string' ? v : undefined;
}

function pickBoolean(
  data: Record<string, unknown> | undefined,
  key: string,
): boolean {
  if (!data) return false;
  const v = data[key];
  return v === true;
}

export function mapDsrError(err: unknown, t: Translator): DsrErrorMapping {
  const data = readConvexErrorData(err);
  const code = pickString(data, 'code');
  const fallbackTitle = t('dataSubjectRequests.errors.generic.title');
  const fallbackDescription =
    pickString(data, 'message') ??
    t('dataSubjectRequests.errors.generic.description');

  switch (code) {
    case 'unauthenticated':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.unauthenticated'),
      };
    case 'forbidden':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.forbidden'),
      };
    case 'validation':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.validation'),
      };
    case 'not_found':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.notFound'),
      };
    case 'ALREADY_PENDING':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.alreadyPending'),
        existingRequestId: pickString(data, 'requestId'),
      };
    case 'LEGAL_HOLD_BLOCKS_ERASURE': {
      const requestId = pickString(data, 'requestId');
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.legalHoldBlocked'),
        legalHoldBlock: requestId
          ? {
              requestId,
              orgHeld: pickBoolean(data, 'orgHeld'),
              userCustodianHeld: pickBoolean(data, 'userCustodianHeld'),
            }
          : undefined,
      };
    }
    case 'NOT_RETRIABLE':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.notRetriable'),
      };
    case 'NOT_EXTENDABLE':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.notExtendable'),
      };
    case 'ALREADY_EXTENDED':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.alreadyExtended'),
      };
    case 'DEADLINE_LAPSED':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.deadlineLapsed'),
      };
    case 'NOT_CANCELLABLE':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.notCancellable'),
      };
    case 'cannotCancelAfterCooldown':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.cannotCancelAfterCooldown'),
      };
    case 'rate_limited':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.rateLimited'),
      };
    case 'dualApprovalRequired':
      return {
        title: fallbackTitle,
        description: t('dataSubjectRequests.errors.dualApprovalRequired'),
      };
    default:
      return {
        title: fallbackTitle,
        description: fallbackDescription,
      };
  }
}

export type { DsrErrorMapping };
