/**
 * Map a refused competence grant or revocation onto the admin's language.
 * The register (`backend/domains/governance/competence.ts`) answers
 * `{ error: <code>, message }`; the adapter turns that into an `AppError`
 * whose `data.code` is read here — the backend `message` is developer-facing
 * English and never shown.
 */

import { pickString, readBackendErrorData } from '../backend-error-data';

type Translator = (key: string, options?: Record<string, unknown>) => string;

/** `holder` names whom a refused grant was for, so a duplicate reads as the
 * team's when the grant named a team. */
export function mapCompetenceError(
  err: unknown,
  t: Translator,
  holder: 'member' | 'team' = 'member',
): string {
  switch (pickString(readBackendErrorData(err), 'code')) {
    case 'COMPETENCE_ALREADY_GRANTED':
      return holder === 'team'
        ? t('competences.errors.alreadyGrantedTeam')
        : t('competences.errors.alreadyGranted');
    case 'COMPETENCE_USER_NOT_MEMBER':
    case 'COMPETENCE_USER_REQUIRED':
      return t('competences.errors.notMember');
    case 'COMPETENCE_FORBIDDEN':
      return t('competences.errors.forbidden');
    case 'COMPETENCE_CAPABILITY_UNKNOWN':
      return t('competences.errors.capabilityUnknown');
    case 'COMPETENCE_EXPIRY_IN_PAST':
      return t('competences.errors.expiryInPast');
    case 'COMPETENCE_EVIDENCE_TOO_LONG':
      return t('competences.errors.evidenceTooLong');
    case 'COMPETENCE_INVALID':
      return t('competences.errors.invalid');
    case 'COMPETENCE_NOT_FOUND':
      return t('competences.errors.notFound');
    case 'COMPETENCE_ALREADY_REVOKED':
      return t('competences.errors.alreadyRevoked');
    case 'COMPETENCE_TEAM_CAPABILITY_ONLY':
      return t('competences.errors.teamCapabilityOnly');
    case 'COMPETENCE_TEAM_NOT_FOUND':
      return t('competences.errors.teamNotFound');
    case 'COMPETENCE_TEAM_SYNCED':
      return t('competences.errors.teamSynced');
    default:
      return t('competences.errors.generic');
  }
}
