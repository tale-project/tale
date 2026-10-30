/**
 * Word a refused Trash restore for the description under the page's
 * "Couldn't restore" title.
 *
 * The restore door (`POST /api/app/governance/trash/restore`) answers a bare
 * code: its own (`backend/domains/governance/trash.ts`), a contact's
 * (`restoreContact` re-runs the directory's uniqueness rule, so a restored
 * contact cannot take an email or external ID another contact holds now)
 * or the admin check's `FORBIDDEN`. Each reads as catalog text; a code this
 * map does not know reads as the page's own line, never as the code.
 */

import {
  backendErrorCode,
  backendUserMessage,
} from '@/lib/utils/backend-error';

type Translator = (key: string, options?: Record<string, unknown>) => string;

export interface TrashRestoreFailure {
  description: string;
  /** The row has left the trash since the list was read — another admin
   *  restored it, or it was deleted for good — so there is nothing left to
   *  restore. */
  rowGone: boolean;
}

/** `t` reads `governance`, `tContacts` reads `contacts`. */
export function mapTrashRestoreError(
  err: unknown,
  t: Translator,
  tContacts: Translator,
): TrashRestoreFailure {
  switch (backendErrorCode(err)) {
    case 'ROW_NOT_FOUND':
    case 'CONTACT_NOT_FOUND':
      return { description: t('trash.restore.gone'), rowGone: true };
    case 'CONTACT_DUPLICATE_EMAIL':
      return {
        description: tContacts('import.errorCodes.duplicate_email'),
        rowGone: false,
      };
    case 'CONTACT_DUPLICATE_EXTERNAL_ID':
      return {
        description: tContacts('import.errorCodes.duplicate_external_id'),
        rowGone: false,
      };
    case 'RESOURCE_TYPE_UNSUPPORTED':
      return { description: t('trash.restore.unsupported'), rowGone: false };
    case 'FORBIDDEN':
      return { description: t('trash.restore.forbidden'), rowGone: false };
    default:
      // A lapsed session keeps the localized sentence it carries as its
      // `userMessage`.
      return {
        description: backendUserMessage(
          err,
          t('trash.restore.failedDescription'),
        ),
        rowGone: false,
      };
  }
}
