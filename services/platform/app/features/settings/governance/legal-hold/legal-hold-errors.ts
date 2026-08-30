/**
 * Map a thrown error from a legal-hold mutation into operator-facing
 * strings. Uses duck-typing for `BackendError.data` since Vite's chunk
 * splitting can produce multiple `BackendError` class copies which
 * breaks `instanceof` (see retention-edit-drawer.tsx for context).
 *
 * Error codes that should appear inline next to a form field (e.g. the
 * approve dialog's countdown) populate `fieldError`; everything else is
 * a toast.
 */

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
  /** When set, points back at an existing record so the UI can offer a
   *  "View existing" link. */
  existingHoldId?: string;
  existingRequestId?: string;
}

function pickNumber(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!data) return undefined;
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function formatRemaining(ms: number): string {
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
  const fallbackTitle = t('legalHold.errors.generic.title');
  const fallbackDescription =
    pickString(data, 'message') ?? t('legalHold.errors.generic.description');

  switch (code) {
    case 'unauthenticated':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.unauthenticated'),
      };
    case 'forbidden':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.forbidden'),
      };
    case 'validation':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.validation'),
      };
    case 'not_found':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.notFound'),
      };
    case 'LEGAL_HOLD_ALREADY_ACTIVE':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.alreadyActive'),
        existingHoldId: pickString(data, 'existingHoldId'),
      };
    case 'MATTER_NOT_FOUND':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.matterNotFound'),
      };
    case 'TARGET_NOT_IN_ORG':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.targetNotInOrg'),
      };
    case 'TARGET_ORG_MISMATCH':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.targetOrgMismatch'),
      };
    case 'LEGAL_HOLD_ALREADY_RELEASED':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.alreadyReleased'),
      };
    case 'LEGAL_HOLD_RELEASE_ALREADY_PENDING':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.releaseAlreadyPending'),
        existingRequestId: pickString(data, 'existingRequestId'),
      };
    case 'LEGAL_HOLD_RELEASE_NOT_PENDING':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.releaseNotPending'),
      };
    case 'SELF_APPROVAL_BLOCKED': {
      const description = t('legalHold.errors.selfApprovalBlocked');
      return {
        title: fallbackTitle,
        description,
        fieldError: description,
      };
    }
    case 'APPROVAL_TOO_SOON': {
      const remainingMs = pickNumber(data, 'remainingMs') ?? 0;
      const countdown = formatRemaining(remainingMs);
      const description = t('legalHold.errors.approvalTooSoon', { countdown });
      return {
        title: fallbackTitle,
        description,
        fieldError: description,
        remainingMs,
      };
    }
    case 'REQUESTER_NO_LONGER_ADMIN': {
      const description = t('legalHold.errors.requesterNoLongerAdmin');
      return {
        title: fallbackTitle,
        description,
        fieldError: description,
      };
    }
    case 'BULK_HOLD_TOO_LARGE':
      return {
        title: fallbackTitle,
        description: t('legalHold.errors.bulkTooLarge'),
      };
    default:
      return {
        title: fallbackTitle,
        description: fallbackDescription,
      };
  }
}

export type { LegalHoldErrorMapping };
