/**
 * What a failed credential or catalog call says to the admin, on either the
 * connectors or the AI-providers surface, in the admin's language.
 *
 * The credential doors answer a coded refusal with an English sentence for
 * API clients and logs ("A credential named … already exists for this
 * provider — pick a different name."). Shown verbatim it read as English in
 * every locale (#4831), so each code these surfaces meet has a sentence of
 * its own in the catalog. Anything else reads through `failureDetail`, the
 * app's rule for a failure: the words of a refusal this list does not know,
 * a lapsed session and a lost connection as localized sentences, and
 * nothing for a fault — a 5xx or a runtime error is never the admin's to
 * read, so the caller says only that it failed.
 *
 * Codes are duck-typed off `AppError.data`, never `instanceof`: Vite chunk
 * splitting can produce several `AppError` class copies.
 */

import { failureDetail } from '@/app/lib/backend/adapters';
import { i18n } from '@/lib/i18n/i18n';
import { backendErrorCode } from '@/lib/utils/backend-error';

/**
 * The localized reason a credential or catalog call failed, or `undefined`
 * when there is nothing worth reading beside the caller's own sentence (a
 * fault). For a notice that already says what failed.
 */
export function credentialFailureDetail(err: unknown): string | undefined {
  switch (backendErrorCode(err)) {
    case 'CREDENTIAL_NAME_TAKEN':
      return i18n.t('credentials.errors.nameTaken', { ns: 'settings' });
    case 'CREDENTIAL_NAME_INVALID':
      return i18n.t('credentials.errors.nameInvalid', { ns: 'settings' });
    case 'CREDENTIAL_NOT_FOUND':
      return i18n.t('credentials.deletedInAnotherSession', { ns: 'settings' });
    // The providers' door and the connectors' door name the same refusal
    // differently: a disabled credential cannot become the default.
    case 'CREDENTIAL_DISABLED_DEFAULT':
    case 'CREDENTIAL_DISABLED':
      return i18n.t('credentials.errors.disabledDefault', { ns: 'settings' });
    case 'CREDENTIAL_DEFAULT_CONFLICT':
      return i18n.t('credentials.errors.defaultConflict', { ns: 'settings' });
    case 'CREDENTIAL_PATCH_EMPTY':
      return i18n.t('credentials.errors.nothingChanged', { ns: 'settings' });
    // The credentials door names the capability; the provider settings door
    // (`/providers/*`, the catalog listing among them) answers the bare code.
    case 'FORBIDDEN_DEVELOPER_SETTINGS':
    case 'FORBIDDEN':
      return i18n.t('credentials.errors.forbidden', { ns: 'settings' });
    // An insert that wrote nothing is the server's fault, not a refusal.
    case 'CREDENTIAL_CREATE_FAILED':
      return undefined;
    default:
      return failureDetail(err);
  }
}

/**
 * The sentence a dialog or a toast shows for a failed credential call: the
 * localized reason, else the app's generic one — never the server's text.
 */
export function mapCredentialError(err: unknown): string {
  return (
    credentialFailureDetail(err) ?? i18n.t('errors.generic', { ns: 'common' })
  );
}
