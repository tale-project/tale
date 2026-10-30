/**
 * Map a thrown error from a legal-hold mutation into operator-facing
 * strings. Reads `AppError.data` by shape (see `../backend-error-data.ts`
 * for why not `instanceof`).
 *
 * The codes are the ones the legal-hold doors answer: the service's
 * (`backend/domains/legal_holds/service.ts`), the matters'
 * (`backend/domains/governance/settings-tail.ts`) and the routes' own
 * `FORBIDDEN` and `invalid body`. Each reads as catalog text. A door's
 * `message` is English, written for API clients, so it never reaches the
 * UI: a code this map does not know reads as the generic line. A code added
 * to the service's `LegalHoldErrorCode` fails the typecheck until
 * `legal-hold-errors.test.ts` lists it, and that test until this map words
 * it.
 *
 * Error codes that should appear inline next to a form field (e.g. the
 * approve dialog's countdown) populate `fieldError`; everything else is
 * a toast.
 */

import { backendUserMessage } from '@/lib/utils/backend-error';

import { pickString, readBackendErrorData } from '../backend-error-data';

type Translator = (key: string, options?: Record<string, unknown>) => string;

interface LegalHoldErrorMapping {
  title: string;
  description: string;
  /** When set, surface inline rather than via toast. */
  fieldError?: string;
  /** Raw remaining ms for APPROVAL_TOO_SOON; lets the caller drive a
   *  client-side countdown until the inline error clears itself. */
  remainingMs?: number;
}

function pickNumber(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!data) return undefined;
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function mapLegalHoldError(
  err: unknown,
  t: Translator,
): LegalHoldErrorMapping {
  const data = readBackendErrorData(err);
  const code = pickString(data, 'code');
  const title = t('legalHold.errors.generic.title');
  const generic = t('legalHold.errors.generic.description');
  const asToast = (description: string): LegalHoldErrorMapping => ({
    title,
    description,
  });
  const asFieldError = (description: string): LegalHoldErrorMapping => ({
    title,
    description,
    fieldError: description,
  });

  switch (code) {
    case 'FORBIDDEN':
      return asToast(t('legalHold.errors.forbidden'));
    // A body the form checks before sending: a blank reason or matter name,
    // or a field over the door's limit.
    case 'invalid body':
    case 'REASON_REQUIRED':
    case 'MATTER_NAME_INVALID':
      return asToast(t('legalHold.errors.validation'));
    case 'CROSS_ORG_TARGET':
      return asToast(t('legalHold.errors.targetOrgMismatch'));
    // The person picked is no longer a member of the organization.
    case 'TARGET_NOT_FOUND':
      return asToast(t('legalHold.errors.targetNotInOrg'));
    case 'MATTER_NOT_FOUND':
      return asToast(t('legalHold.errors.matterNotFound'));
    case 'MATTER_CREATE_FAILED':
      return asToast(generic);
    case 'LEGAL_HOLD_ALREADY_ACTIVE':
      return asToast(t('legalHold.errors.alreadyActive'));
    case 'HOLD_NOT_FOUND':
      return asToast(t('legalHold.errors.holdNotFound'));
    case 'LEGAL_HOLD_ALREADY_RELEASED':
      return asToast(t('legalHold.errors.alreadyReleased'));
    case 'LEGAL_HOLD_RELEASE_ALREADY_PENDING':
      return asToast(t('legalHold.errors.releaseAlreadyPending'));
    case 'REQUEST_NOT_FOUND':
      return asToast(t('legalHold.errors.requestNotFound'));
    // Another admin approved or rejected the request first.
    case 'REQUEST_NOT_PENDING':
      return asToast(t('legalHold.errors.releaseNotPending'));
    case 'SELF_APPROVAL_BLOCKED':
      return asFieldError(t('legalHold.errors.selfApprovalBlocked'));
    case 'APPROVAL_TOO_SOON': {
      const remainingMs = pickNumber(data, 'remainingMs');
      if (remainingMs === undefined) return asFieldError(generic);
      const countdown = formatRemaining(remainingMs);
      return {
        ...asFieldError(t('legalHold.errors.approvalTooSoon', { countdown })),
        remainingMs,
      };
    }
    case 'REQUESTER_NO_LONGER_ADMIN':
      return asFieldError(t('legalHold.errors.requesterNoLongerAdmin'));
    default:
      // A lapsed session keeps the localized sentence it carries as its
      // `userMessage`; anything else this map does not know (a fault, no
      // answer) reads as the generic line.
      return asToast(backendUserMessage(err, generic));
  }
}

export type { LegalHoldErrorMapping };
